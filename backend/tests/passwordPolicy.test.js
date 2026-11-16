const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePassword } = require('../src/services/passwordPolicy');

test('accepts a password meeting every requirement', () => {
  assert.equal(validatePassword('HealthSyncAccount#2026').valid, true);
});

test('rejects a password that misses a required character type or length', () => {
  assert.equal(validatePassword({ password: 'HealthSyncAccount#2026' }).valid, false);
  assert.equal(validatePassword('shortPassword1!').valid, false);
  assert.equal(validatePassword('thispasswordislongenough1!').valid, false);
  assert.equal(validatePassword('ThisPasswordIsLongEnough!').valid, false);
  assert.equal(validatePassword('ThisPasswordIsLongEnough1').valid, false);
  assert.equal(validatePassword(`ThisPasswordIsLongEnough1!${'x'.repeat(60)}`).valid, false);
});
