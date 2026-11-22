const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateAge,
  ensureSeniorCitizenRecord,
} = require('../src/services/seniorCitizenAutoRegistrationService');

test('senior auto-registration age becomes 60 on the birthdate', () => {
  assert.equal(calculateAge('1966-11-22', '2026-11-21'), 59);
  assert.equal(calculateAge('1966-11-22', '2026-11-22'), 60);
});

test('under-age residents are not auto-registered', async () => {
  const connection = {
    query: async () => {
      throw new Error('Database should not be queried for an under-age resident');
    },
  };
  const result = await ensureSeniorCitizenRecord(connection, {
    resident_id: 12,
    birthdate: '1966-11-23',
  }, { dateRegistered: '2026-11-22' });
  assert.equal(result, null);
});

test('existing senior records are not duplicated', async () => {
  const connection = {
    query: async (sql) => {
      if (sql.includes('FROM senior_citizen_records')) return [[{ senior_id: 7 }]];
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const result = await ensureSeniorCitizenRecord(connection, {
    resident_id: 12,
    birthdate: '1966-11-22',
  }, { dateRegistered: '2026-11-22' });
  assert.equal(result, null);
});

test('senior records are not created without an authenticated user', async () => {
  const connection = {
    query: async () => {
      throw new Error('Database should not be queried when recorded_by is unavailable');
    },
  };
  const result = await ensureSeniorCitizenRecord(connection, {
    resident_id: 12,
    birthdate: '1966-11-22',
  }, { dateRegistered: '2026-11-22' });
  assert.equal(result, null);
});
