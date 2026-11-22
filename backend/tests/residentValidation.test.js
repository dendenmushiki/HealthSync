const test = require('node:test');
const assert = require('node:assert/strict');
const { validateResidentInput } = require('../src/controllers/residentController');

const validResident = {
  first_name: 'Ana',
  last_name: 'Santos',
  birthdate: '2000-01-01',
  sex: 'male',
  civil_status: 'Single',
  resident_status: 'Active',
};

test('resident validation accepts Others as a gender value', () => {
  assert.equal(validateResidentInput({ ...validResident, sex: 'others' }), null);
});

test('resident validation rejects unsupported gender values', () => {
  const errors = validateResidentInput({ ...validResident, sex: 'other' });
  assert.equal(errors.sex, 'Select a valid gender.');
});

test('resident validation requires an allowed civil status and rejects legacy choices', () => {
  for (const civilStatus of ['', 'Unknown', 'Divorced']) {
    const errors = validateResidentInput({ ...validResident, civil_status: civilStatus });
    assert.equal(errors.civil_status, 'Please select a valid civil status.');
  }
  assert.equal(validateResidentInput({ ...validResident, civil_status: 'Annulled' }), null);
});

test('updates may preserve a legacy civil status when it is omitted', () => {
  const existing = { ...validResident, civil_status: 'Unknown' };
  assert.equal(validateResidentInput({ ...validResident, civil_status: undefined }, existing), null);
});
