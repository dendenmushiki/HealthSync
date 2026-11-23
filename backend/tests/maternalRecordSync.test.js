const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/config/database');
const { processOperation } = require('../src/services/syncService');

test('persists EDC to the maternal date column when syncing a queued record', async () => {
  const originalQuery = pool.query;
  const originalGetConnection = pool.getConnection;
  const poolCalls = [];
  const connectionCalls = [];
  const schemaRows = [
    { TABLE_NAME: 'maternal_records', COLUMN_NAME: 'id', DATA_TYPE: 'bigint', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null },
    { TABLE_NAME: 'maternal_records', COLUMN_NAME: 'resident_id', DATA_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null },
    { TABLE_NAME: 'maternal_records', COLUMN_NAME: 'record_data', DATA_TYPE: 'json', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null },
    { TABLE_NAME: 'maternal_records', COLUMN_NAME: 'edc', DATA_TYPE: 'date', IS_NULLABLE: 'YES', COLUMN_DEFAULT: null },
    { TABLE_NAME: 'maternal_records', COLUMN_NAME: 'recorded_by', DATA_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null },
    { TABLE_NAME: 'maternal_records', COLUMN_NAME: 'created_at', DATA_TYPE: 'timestamp', IS_NULLABLE: 'NO', COLUMN_DEFAULT: 'CURRENT_TIMESTAMP' },
    { TABLE_NAME: 'maternal_records', COLUMN_NAME: 'updated_at', DATA_TYPE: 'timestamp', IS_NULLABLE: 'NO', COLUMN_DEFAULT: 'CURRENT_TIMESTAMP' },
  ];
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, params) {
      connectionCalls.push({ sql, params });
      if (sql.startsWith('INSERT INTO `maternal_records`')) return [{ insertId: 31 }];
      return [{ affectedRows: 1 }];
    },
  };
  pool.query = async (sql) => {
    poolCalls.push(sql);
    if (sql.includes('information_schema.COLUMNS')) return [schemaRows];
    if (sql.includes("COLUMN_KEY = 'PRI'")) return [[{ COLUMN_NAME: 'id' }]];
    return [{ insertId: 1 }];
  };
  pool.getConnection = async () => connection;
  try {
    const result = await processOperation({
      operation: 'CREATE',
      module: 'maternal',
      table: 'maternal_records',
      payload: {
        id: 31,
        resident_id: 7,
        record_data: { lmp: '2024-04-22', edc: '2025-01-27' },
        recorded_by: 3,
      },
    });
    const insert = connectionCalls.find((call) => call.sql.startsWith('INSERT INTO `maternal_records`'));
    assert.ok(insert);
    assert.match(insert.sql, /`edc`/);
    assert.equal(insert.params[3], '2025-01-27');
    assert.equal(result.response.serverRecordId, 31);
    assert.ok(poolCalls.some((sql) => sql.includes('INSERT INTO audit_logs')));
  } finally {
    pool.query = originalQuery;
    pool.getConnection = originalGetConnection;
  }
});
