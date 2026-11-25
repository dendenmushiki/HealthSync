/**
 * BMI Calculation and Classification Service
 */

/**
 * Calculate BMI from weight and height
 * @param {number} weightKg - Weight in kilograms
 * @param {number} heightCm - Height in centimeters
 * @returns {number} BMI rounded to 2 decimal places
 */
function calculateBMI(weightKg, heightCm) {
  if (!weightKg || !heightCm || weightKg <= 0 || heightCm <= 0) {
    throw new Error('Weight and height must be positive numbers');
  }
  
  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);
  
  return Math.round(bmi * 100) / 100;
}

/**
 * Classify adult BMI using standard adult BMI categories
 * @param {number} bmi
 * @returns {string} BMI category
 */
function classifyAdultBMI(bmi) {
  if (bmi < 18.5) return 'Underweight';
  if (bmi >= 18.5 && bmi < 25.0) return 'Normal';
  if (bmi >= 25.0 && bmi < 30.0) return 'Overweight';
  if (bmi >= 30.0) return 'Obese';
  return 'Unknown';
}

/**
 * Get WHO standard adult BMI boundaries
 * @returns {object} BMI thresholds
 */
function getAdultBMIBoundaries() {
  return {
    underweight: { min: 0, max: 18.4 },
    normal: { min: 18.5, max: 24.9 },
    overweight: { min: 25.0, max: 29.9 },
    obese: { min: 30.0, max: Infinity }
  };
}

/**
 * Validate BMI input values
 * @param {number} weight
 * @param {number} height
 * @returns {object} {valid: boolean, errors: string[]}
 */
function validateBMIInput(weight, height) {
  const errors = [];
  
  if (!weight || typeof weight !== 'number' || weight <= 0) {
    errors.push('Weight must be a positive number');
  }
  if (weight > 300) {
    errors.push('Weight seems unusually high');
  }
  
  if (!height || typeof height !== 'number' || height <= 0) {
    errors.push('Height must be a positive number');
  }
  if (height < 50) {
    errors.push('Height seems unusually low');
  }
  if (height > 230) {
    errors.push('Height seems unusually high');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  calculateBMI,
  classifyAdultBMI,
  getAdultBMIBoundaries,
  validateBMIInput
};
