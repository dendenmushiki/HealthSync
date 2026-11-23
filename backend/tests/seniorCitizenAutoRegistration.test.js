const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const readSource = (relativePath) => fs.readFileSync(
  path.join(__dirname, '..', 'src', relativePath),
  'utf8'
);

test('resident CRUD, reads, and sync do not auto-register senior citizens', () => {
  const residentController = readSource('controllers/residentController.js');
  const seniorCitizenController = readSource('controllers/seniorCitizenController.js');
  const syncService = readSource('services/syncService.js');

  for (const source of [residentController, seniorCitizenController, syncService]) {
    assert.doesNotMatch(source, /ensureSeniorCitizenRecord|reconcileSeniorCitizenRegistry/);
  }
});

test('senior citizen registration remains a manual, age-eligible BHW action', () => {
  const controller = readSource('controllers/seniorCitizenController.js');
  const routes = readSource('routes/seniorCitizenRoutes.js');

  assert.match(controller, /const createSeniorCitizen = async/);
  assert.match(controller, /ageYears < 60/);
  assert.match(controller, /INSERT INTO senior_citizen_records/);
  assert.match(routes, /router\.post\('\/'.*authorizeRole\(\['bhw'\]\)/);
});
