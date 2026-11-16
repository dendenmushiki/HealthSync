const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateBMI, classifyAdultBMI, getAdultBMIBoundaries, validateBMIInput } = require('../src/services/nutrition/bmiService');

test('adult WHO cutoffs classify all categories at exact boundaries', () => {
  assert.equal(classifyAdultBMI(18.49), 'Underweight');
  assert.equal(classifyAdultBMI(18.5), 'Normal');
  assert.equal(classifyAdultBMI(24.99), 'Normal');
  assert.equal(classifyAdultBMI(25), 'Overweight');
  assert.equal(classifyAdultBMI(29.99), 'Overweight');
  assert.equal(classifyAdultBMI(30), 'Obese');
});

test('adult BMI calculation is rounded to two decimals', () => {
  assert.equal(calculateBMI(40.7, 147), 18.83);
  assert.equal(calculateBMI(70, 170), 24.22);
});

test('adult BMI boundaries and input plausibility use existing ranges', () => {
  assert.deepEqual(getAdultBMIBoundaries().normal, { min: 18.5, max: 24.9 });
  assert.equal(validateBMIInput(301, 170).valid, false);
  assert.equal(validateBMIInput(70, 49).valid, false);
  assert.equal(validateBMIInput(70, 170).valid, true);
});
