const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
const controllerPath = require.resolve('../src/controllers/userController');

function loadUserController(pool, auditCalls) {
  Module._load = function load(request, parent, isMain) {
    if (parent?.filename === controllerPath) {
      if (request === '../config/database') return pool;
      if (request === '../services/logger') return { error: () => {} };
      if (request === '../services/auditService') return { writeAudit: async (entry) => auditCalls.push(entry) };
      if (request === '../services/userManagementService') return { ensureUserManagementSchema: async () => {} };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[controllerPath];
  try {
    return require(controllerPath);
  } finally {
    Module._load = originalLoad;
  }
}

function createResponse() {
  return {
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
}

test('admin user updates reject name and username changes', async () => {
  const { updateUser } = loadUserController({}, []);
  const response = createResponse();

  await updateUser({
    params: { id: '2' },
    body: { full_name: 'Changed Name', username: 'changed.name', role: 'bhw' },
  }, response);

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.errorCode, 'PROFILE_OWNER_ONLY');
});

test('admin user updates change only the role and preserve role-change audit logging', async () => {
  const queries = [];
  const auditCalls = [];
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT * FROM users')) {
        return [[{ user_id: 2, full_name: 'Sample User', username: 'sample.user', role: 'bhw', is_active: 1 }]];
      }
      return [{ affectedRows: 1 }];
    },
  };
  const { updateUser } = loadUserController({ getConnection: async () => connection }, auditCalls);
  const response = createResponse();

  await updateUser({
    params: { id: '2' },
    body: { role: 'official' },
    user: { user_id: 1 },
    ip: '127.0.0.1',
    get: () => 'test-agent',
  }, response);

  assert.equal(response.statusCode, 200);
  const userUpdate = queries.find(({ sql }) => sql.startsWith('UPDATE users SET role'));
  assert.ok(userUpdate);
  assert.deepEqual(userUpdate.params, ['barangay_official', 1, '2']);
  assert.doesNotMatch(userUpdate.sql, /full_name|username/);
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action, 'role_changed');
  assert.deepEqual(auditCalls[0].old_data, { role: 'bhw' });
  assert.deepEqual(auditCalls[0].new_data, { role: 'official' });
});
