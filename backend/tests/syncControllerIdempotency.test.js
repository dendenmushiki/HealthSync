const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');

const originalLoad = Module._load;
let existingRecord;
let processOperation;
let handleSync;

function installController() {
  processOperation = async () => ({ fromCache: false, response: { serverRecordId: 91 } });
  Module._load = function load(request, parent, isMain) {
    if (request === '../services/syncService' && parent?.filename?.endsWith('\\controllers\\syncController.js')) {
      return {
        processOperation: (...args) => processOperation(...args),
        findIdempotency: async () => existingRecord,
      };
    }
    if (request === '../services/logger' && parent?.filename?.endsWith('\\controllers\\syncController.js')) {
      return { error: () => {} };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[require.resolve('../src/controllers/syncController')];
  handleSync = require('../src/controllers/syncController').handleSync;
  Module._load = originalLoad;
}

function createRequestResponse() {
  const req = {
    headers: { 'x-idempotency-key': 'shared-key' },
    body: {
      operation: 'CREATE',
      module: 'residents',
      table: 'residents',
      payload: { first_name: 'Test' },
    },
    user: { user_id: 7 },
    ip: '127.0.0.1',
    get: () => 'test-agent',
  };
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return { req, res };
}

function requestFingerprint(req) {
  const { operation, module, table, payload } = req.body;
  return crypto.createHash('sha256')
    .update(`${operation}|${module || ''}|${table}|${JSON.stringify(payload || {})}`)
    .digest('hex');
}

test('only returns a cached generic sync result to its owning account', async () => {
  installController();
  const { req, res } = createRequestResponse();
  existingRecord = {
    response: {
      ownerId: '8',
      requestFingerprint: requestFingerprint(req),
      outcome: 'SUCCESS',
      response: { serverRecordId: 55 },
    },
  };

  await handleSync(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.errorCode, 'IDEMPOTENCY_KEY_CONFLICT');
  assert.equal(res.body.data, undefined);
});

test('does not disclose cached results from legacy unscoped idempotency records', async () => {
  installController();
  const { req, res } = createRequestResponse();
  existingRecord = { response: { serverRecordId: 55 } };

  await handleSync(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.errorCode, 'IDEMPOTENCY_KEY_CONFLICT');
  assert.equal(res.body.data, undefined);
});

test('binds new generic sync results to the authenticated account and request', async () => {
  installController();
  existingRecord = null;
  const { req, res } = createRequestResponse();
  let operationArgs;
  processOperation = async (args) => {
    operationArgs = args;
    return { fromCache: false, response: { serverRecordId: 91 } };
  };

  await handleSync(req, res);

  assert.equal(operationArgs.userId, 7);
  assert.equal(operationArgs.requestFingerprint, requestFingerprint(req));
  assert.deepEqual(res.body, { success: true, data: { serverRecordId: 91 } });
});
