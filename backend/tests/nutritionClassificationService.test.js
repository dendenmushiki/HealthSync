const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyOperationTimbang,
  latestNutritionStatusSql,
  normalizeNutritionStatus
} = require('../src/services/nutritionClassificationService');

test('Operation Timbang status uses the most severe available indicator', () => {
  const result = classifyOperationTimbang({
    wfa_status: 'normal',
    hfa_status: 'Moderately stunted',
    wflh_status: 'Normal'
  });

  assert.equal(result.status, 'Moderately stunted');
  assert.deepEqual(result.indicators.map(({ status }) => status), ['Normal', 'Moderately stunted', 'Normal']);
});

test('missing Operation Timbang indicators are not classified as Normal', () => {
  assert.equal(classifyOperationTimbang({}).status, null);
});

test('status aliases are canonicalized consistently', () => {
  assert.equal(normalizeNutritionStatus('  OBESITY  '), 'Obese');
  assert.equal(normalizeNutritionStatus('normal'), 'Normal');
  assert.equal(normalizeNutritionStatus(''), null);
});

test('resident latest-status SQL uses the same worst-indicator selection', () => {
  const sql = latestNutritionStatusSql();

  assert.match(sql, /wfa_status/);
  assert.match(sql, /hfa_status/);
  assert.match(sql, /wflh_status/);
  assert.match(sql, /ORDER BY ot\.date_recorded DESC, ot\.timbang_id DESC/);
});
