const test = require('node:test');
const assert = require('node:assert/strict');
const { validateMaternalRecord } = require('../src/services/maternalRecordValidation');

test('accepts empty dates and a valid EDC on or after LMP', () => {
  assert.deepEqual(validateMaternalRecord({ lmp: '', edc: '' }), {});
  assert.deepEqual(validateMaternalRecord({ lmp: '2024-01-15', edc: '2024-10-21' }), {});
  assert.deepEqual(validateMaternalRecord({ lmp: '2024-01-15', edc: '2024-01-15' }), {});
});

test('rejects invalid dates and an EDC before LMP', () => {
  assert.deepEqual(validateMaternalRecord({ lmp: '2024-02-30', edc: '2024-10-21' }), {
    lmp: 'Enter a valid LMP date.',
  });
  assert.deepEqual(validateMaternalRecord({ lmp: '2024-01-15', edc: '2024-02-30' }), {
    edc: 'Enter a valid EDC date.',
  });
  assert.deepEqual(validateMaternalRecord({ lmp: '2024-10-21', edc: '2024-01-15' }), {
    edc: 'EDC cannot be before LMP.',
  });
});
