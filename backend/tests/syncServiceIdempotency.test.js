const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
let records;
let insertCount;
let processOperation;

function installSyncService() {
  records = new Map();
  insertCount = 0;
  const pool = {
    async query(sql, values = []) {
      if (sql.startsWith('CREATE TABLE IF NOT EXISTS sync_idempotency')) return [{ affectedRows: 0 }];
      if (sql.startsWith('SELECT * FROM sync_idempotency')) {
        const record = records.get(values[0]);
        return [record ? [record] : []];
      }
      if (sql.startsWith('INSERT INTO sync_idempotency')) {
        const [key, moduleName, tableName, operation, response, status] = values;
        if (records.has(key)) {
          const error = new Error('Duplicate idempotency key');
          error.code = 'ER_DUP_ENTRY';
          throw error;
        }
        insertCount += 1;
        records.set(key, {
          idempotency_key: key,
          module_name: moduleName,
          table_name: tableName,
          operation,
          server_record_id: null,
          response: JSON.parse(response),
          status,
        });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL in sync service idempotency test: ${sql}`);
    },
  };
  Module._load = function load(request, parent, isMain) {
    const serviceFile = parent?.filename?.endsWith('\\services\\syncService.js');
    if (request === '../config/database' && serviceFile) return pool;
    if (request === './auditService' && serviceFile) return { writeAudit: async () => {} };
    if (request === './logger' && serviceFile) return { info: () => {}, error: () => {} };
    if (request === './residentSchemaService' && serviceFile) return { ensureResidentSchema: async () => {} };
    if (request === './psgcService' && serviceFile) return { resolveResidentLocation: async () => ({}) };
    if (request === './clinicalRecordValidation' && serviceFile) return { validateClinicalRecord: () => ({}) };
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[require.resolve('../src/services/syncService')];
  processOperation = require('../src/services/syncService').processOperation;
  Module._load = originalLoad;
}

function syncRequest(payload) {
  return {
    idempotencyKey: 'shared-sync-key',
    operation: 'CREATE',
    module: 'residents',
    table: 'residents',
    payload,
    userId: 7,
    requestFingerprint: 'request-fingerprint',
  };
}

test('claims generic sync keys before validation so an ambiguous retry cannot execute again', async () => {
  installSyncService();

  await assert.rejects(processOperation(syncRequest({})), { name: 'ValidationError' });
  const recordAfterValidation = records.get('shared-sync-key');
  const retry = await processOperation(syncRequest({ first_name: 'Retry', last_name: 'Blocked' }));

  assert.equal(insertCount, 1);
  assert.equal(recordAfterValidation.status, 'PENDING');
  assert.deepEqual(recordAfterValidation.response, {
    ownerId: '7',
    requestFingerprint: 'request-fingerprint',
    outcome: 'PENDING',
  });
  assert.equal(retry.fromCache, true);
  assert.equal(retry.record.status, 'PENDING');
});
