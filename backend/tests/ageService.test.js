const test = require('node:test');
const assert = require('node:assert/strict');
const ageService = require('../src/services/nutrition/ageService');

test('adult BMI eligibility begins at 229 completed months', () => {
  assert.equal(ageService.MIN_ADULT_BMI_AGE_MONTHS, 229);
  assert.equal(ageService.getAgeMonths('2006-01-01', '2025-01-01'), 228);
  assert.equal(ageService.getAgeMonths('2006-01-01', '2025-02-01'), 229);
  assert.equal(ageService.getNutritionEligibility(228).isAdult, false);
  assert.equal(ageService.getNutritionEligibility(229).isAdult, true);
  assert.equal(ageService.getNutritionEligibility(228).isAdolescent, true);
  assert.equal(ageService.getNutritionEligibility(229).isAdolescent, false);
});
