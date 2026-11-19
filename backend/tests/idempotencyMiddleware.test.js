const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
let records;
let sequence;
let createIdempotencyMiddleware;

function installMiddlewareWithDatabaseStub({ updateFailure = false } = {}) {
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
        if (updateFailure) throw new Error('Idempotency response storage failed.');
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

function installAtomicMiddlewareWithDatabaseStub({ commitFailure = null } = {}) {
  records = new Map();
  const bmiRecords = new Map();
  let sequence = 1;
  const pool = {
    async getConnection() {
      const transactionRecords = new Map();
      const transactionBmiRecords = new Map();
      return {
        async beginTransaction() {},
        async query(sql, values) {
          if (sql.startsWith('INSERT INTO sync_idempotency')) {
            const [key, moduleName, tableName, operation, response, status] = values;
            if (records.has(key)) {
              const error = new Error('Duplicate idempotency key');
              error.code = 'ER_DUP_ENTRY';
              throw error;
            }
            transactionRecords.set(key, {
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
          if (sql.startsWith('INSERT INTO adult_bmi_records')) {
            const id = sequence++;
            transactionBmiRecords.set(id, { bmi_id: id, ...values });
            return [{ insertId: id }];
          }
          if (sql.startsWith('UPDATE sync_idempotency')) {
            const [serverRecordId, response, status, key] = values;
            const record = transactionRecords.get(key);
            if (!record || record.status !== 'PENDING') return [{ affectedRows: 0 }];
            record.server_record_id = serverRecordId;
            record.response = JSON.parse(response);
            record.status = status;
            return [{ affectedRows: 1 }];
          }
          throw new Error(`Unexpected SQL in atomic idempotency test: ${sql}`);
        },
        async commit() {
          const failure = commitFailure;
          commitFailure = null;
          if (failure === 'before') throw new Error('Commit acknowledgement was lost before persistence.');
          for (const [key, value] of transactionRecords) records.set(key, value);
          for (const [key, value] of transactionBmiRecords) bmiRecords.set(key, value);
          if (failure === 'after') throw new Error('Commit acknowledgement was lost after persistence.');
        },
        async rollback() {
          transactionRecords.clear();
          transactionBmiRecords.clear();
        },
        release() {},
      };
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
  return { bmiRecords };
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

test('does not report success when the idempotency result cannot be persisted', async () => {
  installMiddlewareWithDatabaseStub({ updateFailure: true });
  const response = createRequestResponse({
    key: '123e4567-e89b-42d3-a456-426614174000',
  });
  let handlerResponse;
  await createIdempotencyMiddleware('residents', 'residents')(
    response.req,
    response.res,
    () => {
      handlerResponse = response.res.status(201).json({ success: true, data: { resident_id: 42 } });
    }
  );
  await handlerResponse;

  assert.equal(response.res.statusCode, 503);
  assert.equal(response.res.body.success, false);
  assert.equal(response.res.body.errorCode, 'IDEMPOTENCY_OUTCOME_UNKNOWN');
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

test('atomically replays an Adult BMI response after a lost response without inserting a duplicate', async () => {
  const { bmiRecords } = installAtomicMiddlewareWithDatabaseStub();
  const key = '123e4567-e89b-42d3-a456-426614174000';
  const first = createRequestResponse({ key });
  let response;
  await createIdempotencyMiddleware('adult_bmi', 'adult_bmi_records', { atomic: true })(
    first.req,
    first.res,
    async () => {
      const [insert] = await first.req.idempotencyConnection.query('INSERT INTO adult_bmi_records', [
        { resident_id: 15, weight_kg: 62, height_cm: 165, recorded_by: 7 },
      ]);
      response = first.res.status(201).json({
        success: true,
        data: { bmi_id: insert.insertId, resident_id: 15, bmi: 22.77, bmi_category: 'Normal' },
      });
      return response;
    }
  );
  await response;

  const replay = createRequestResponse({ key });
  let replayNextCalled = false;
  await createIdempotencyMiddleware('adult_bmi', 'adult_bmi_records', { atomic: true })(
    replay.req,
    replay.res,
    () => { replayNextCalled = true; }
  );

  assert.equal(replayNextCalled, false);
  assert.equal(records.get(key).status, 'SUCCESS');
  assert.equal(records.get(key).server_record_id, 1);
  assert.equal(bmiRecords.size, 1);
  assert.deepEqual(replay.res.body, first.res.body);
  assert.equal(replay.res.statusCode, 201);
});

test('rolls back Adult BMI and idempotency state on server failure so the same key can retry', async () => {
  const { bmiRecords } = installAtomicMiddlewareWithDatabaseStub();
  const key = '123e4567-e89b-42d3-a456-426614174000';
  const failed = createRequestResponse({ key });
  let failedResponse;
  await createIdempotencyMiddleware('adult_bmi', 'adult_bmi_records', { atomic: true })(
    failed.req,
    failed.res,
    async () => {
      await failed.req.idempotencyConnection.query('INSERT INTO adult_bmi_records', [{ resident_id: 15 }]);
      failedResponse = failed.res.status(500).json({ success: false });
      return failedResponse;
    }
  );
  await failedResponse;
  assert.equal(failed.res.body.errorCode, 'IDEMPOTENCY_RETRY_SAFE');
  assert.equal(records.has(key), false);
  assert.equal(bmiRecords.size, 0);

  const retry = createRequestResponse({ key });
  let retryResponse;
  await createIdempotencyMiddleware('adult_bmi', 'adult_bmi_records', { atomic: true })(
    retry.req,
    retry.res,
    async () => {
      const [insert] = await retry.req.idempotencyConnection.query('INSERT INTO adult_bmi_records', [{ resident_id: 15 }]);
      retryResponse = retry.res.status(201).json({
        success: true,
        data: { bmi_id: insert.insertId },
      });
      return retryResponse;
    }
  );
  await retryResponse;

  assert.equal(records.get(key).status, 'SUCCESS');
  assert.equal(bmiRecords.size, 1);
});

test('reports an unknown outcome when commit acknowledgement is lost and safely processes the same key if it did not commit', async () => {
  const { bmiRecords } = installAtomicMiddlewareWithDatabaseStub({ commitFailure: 'before' });
  const key = '123e4567-e89b-42d3-a456-426614174000';
  const uncertain = createRequestResponse({ key });
  await createIdempotencyMiddleware('adult_bmi', 'adult_bmi_records', { atomic: true })(
    uncertain.req,
    uncertain.res,
    async () => {
      await uncertain.req.idempotencyConnection.query('INSERT INTO adult_bmi_records', [{ resident_id: 15 }]);
      return uncertain.res.status(201).json({ success: true, data: { bmi_id: 1 } });
    }
  );
  assert.equal(uncertain.res.body.errorCode, 'IDEMPOTENCY_OUTCOME_UNKNOWN');
  assert.equal(records.has(key), false);
  assert.equal(bmiRecords.size, 0);

  const retry = createRequestResponse({ key });
  await createIdempotencyMiddleware('adult_bmi', 'adult_bmi_records', { atomic: true })(
    retry.req,
    retry.res,
    async () => {
      const [insert] = await retry.req.idempotencyConnection.query('INSERT INTO adult_bmi_records', [{ resident_id: 15 }]);
      return retry.res.status(201).json({ success: true, data: { bmi_id: insert.insertId } });
    }
  );

  assert.equal(records.get(key).status, 'SUCCESS');
  assert.equal(bmiRecords.size, 1);
});

test('replays the committed result when only the commit acknowledgement was lost', async () => {
  const { bmiRecords } = installAtomicMiddlewareWithDatabaseStub({ commitFailure: 'after' });
  const key = '123e4567-e89b-42d3-a456-426614174000';
  const uncertain = createRequestResponse({ key });
  await createIdempotencyMiddleware('adult_bmi', 'adult_bmi_records', { atomic: true })(
    uncertain.req,
    uncertain.res,
    async () => {
      const [insert] = await uncertain.req.idempotencyConnection.query('INSERT INTO adult_bmi_records', [{ resident_id: 15 }]);
      return uncertain.res.status(201).json({ success: true, data: { bmi_id: insert.insertId } });
    }
  );

  const replay = createRequestResponse({ key });
  let nextCalled = false;
  await createIdempotencyMiddleware('adult_bmi', 'adult_bmi_records', { atomic: true })(
    replay.req,
    replay.res,
    () => { nextCalled = true; }
  );

  assert.equal(uncertain.res.body.errorCode, 'IDEMPOTENCY_OUTCOME_UNKNOWN');
  assert.equal(nextCalled, false);
  assert.equal(replay.res.body.data.bmi_id, 1);
  assert.equal(bmiRecords.size, 1);
});
