const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
let records;
let sequence;
let createIdempotencyMiddleware;

function installMiddlewareWithDatabaseStub() {
  records = new Map();
  sequence = 1;
  const pool = {
    async query(sql, values) {
      if (sql.startsWith('INSERT INTO sync_idempotency')) {
        const [key, moduleName, tableName, operation, response, status] = values;
        if (records.has(key)) {
          const error = new Error('Duplicate idempotency key');
          error.code = 'ER_DUP_ENTRY';
          throw error;
        }
        records.set(key, {
          id: sequence++,
          idempotency_key: key,
          module_name: moduleName,
          table_name: tableName,
          operation,
          server_record_id: null,
          response: JSON.parse(response),
          status,
        });
      } else if (sql.startsWith('UPDATE sync_idempotency')) {
        const [serverRecordId, response, status, key] = values;
        const record = records.get(key);
        if (record?.status === 'PENDING') {
          record.server_record_id = serverRecordId;
          record.response = JSON.parse(response);
          record.status = status;
        }
      } else {
        throw new Error(`Unexpected SQL in idempotency middleware test: ${sql}`);
      }
      return [{ affectedRows: 1 }];
    },
  };
  Module._load = function load(request, parent, isMain) {
    if (request === '../config/database' && parent?.filename?.endsWith('\\middleware\\idempotency.js')) return pool;
    if (request === '../services/logger' && parent?.filename?.endsWith('\\middleware\\idempotency.js')) {
      return { error: () => {} };
    }
    if (request === '../services/syncService' && parent?.filename?.endsWith('\\middleware\\idempotency.js')) {
      return {
        ensureIdempotencyTable: async () => {},
        findIdempotency: async (key) => records.get(key) || null,
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[require.resolve('../src/middleware/idempotency')];
  createIdempotencyMiddleware = require('../src/middleware/idempotency');
  Module._load = originalLoad;
}

function createRequestResponse({ key, userId = 7 } = {}) {
  const req = {
    method: 'POST',
    baseUrl: '/api/residents',
    path: '/',
    body: { first_name: 'Test' },
    params: {},
    user: { user_id: userId },
    get: (name) => (name.toLowerCase() === 'x-idempotency-key' ? key : undefined),
  };
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return Promise.resolve(this);
    },
  };
  return { req, res };
}

test('caches successful responses by account and request fingerprint', async () => {
  installMiddlewareWithDatabaseStub();
  const key = '123e4567-e89b-42d3-a456-426614174000';
  const first = createRequestResponse({ key });
  let firstNextCalled = false;
  let firstResponse;
  await createIdempotencyMiddleware('residents', 'residents')(first.req, first.res, () => {
    firstNextCalled = true;
    firstResponse = first.res.status(201).json({ success: true, data: { resident_id: 42 } });
  });
  await firstResponse;

  const replay = createRequestResponse({ key });
  let replayNextCalled = false;
  await createIdempotencyMiddleware('residents', 'residents')(replay.req, replay.res, () => {
    replayNextCalled = true;
  });

  assert.equal(firstNextCalled, true);
  assert.equal(records.get(key).status, 'SUCCESS');
  assert.equal(records.get(key).server_record_id, 42);
  assert.equal(replayNextCalled, false);
  assert.deepEqual(replay.res.body, { success: true, data: { serverRecordId: 42, cached: true } });
});

test('blocks a different account from replaying another account key', async () => {
  installMiddlewareWithDatabaseStub();
  const key = '123e4567-e89b-42d3-a456-426614174000';
  const first = createRequestResponse({ key });
  let firstResponse;
  await createIdempotencyMiddleware('residents', 'residents')(first.req, first.res, () => {
    firstResponse = first.res.json({ success: true, data: { resident_id: 42 } });
  });
  await firstResponse;

  const foreign = createRequestResponse({ key, userId: 8 });
  let nextCalled = false;
  await createIdempotencyMiddleware('residents', 'residents')(foreign.req, foreign.res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(foreign.res.statusCode, 409);
  assert.equal(foreign.res.body.errorCode, 'IDEMPOTENCY_KEY_CONFLICT');
});

test('does not re-execute an operation whose server outcome remains unknown', async () => {
  installMiddlewareWithDatabaseStub();
  const key = '123e4567-e89b-42d3-a456-426614174000';
  const first = createRequestResponse({ key });
  let nextCalled = false;
  await createIdempotencyMiddleware('residents', 'residents')(first.req, first.res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);

  const replay = createRequestResponse({ key });
  let replayNextCalled = false;
  await createIdempotencyMiddleware('residents', 'residents')(replay.req, replay.res, () => {
    replayNextCalled = true;
  });

  assert.equal(replayNextCalled, false);
  assert.equal(replay.res.statusCode, 409);
  assert.equal(replay.res.body.errorCode, 'IDEMPOTENCY_OUTCOME_UNKNOWN');
});
