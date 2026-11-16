const referenceData = require('./who2007-bmi-for-age.json');

const MIN_AGE_MONTHS = referenceData.minimumAgeMonths;
const MAX_AGE_MONTHS = referenceData.maximumAgeMonths;
const Z_SCORE_LIMIT = 5;

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeSex(sex) {
  const normalized = String(sex || '').trim().toLowerCase();
  if (normalized === 'male' || normalized === 'm' || normalized === '1') return 'male';
  if (normalized === 'female' || normalized === 'f' || normalized === '2') return 'female';
  throw validationError('Resident sex must be recorded as male or female for BMI-for-age classification.');
}

function getAgeReference(sex, ageMonths) {
  const normalizedSex = normalizeSex(sex);
  if (!Number.isFinite(ageMonths) || ageMonths < MIN_AGE_MONTHS || ageMonths > MAX_AGE_MONTHS) {
    throw validationError(`WHO BMI-for-age references support ages ${MIN_AGE_MONTHS}-${MAX_AGE_MONTHS} months.`);
  }

  const lowerAge = Math.floor(ageMonths);
  const upperAge = Math.ceil(ageMonths);
  const lower = referenceData[normalizedSex][lowerAge - MIN_AGE_MONTHS];
  const upper = referenceData[normalizedSex][upperAge - MIN_AGE_MONTHS];
  if (!lower || !upper) {
    const error = new Error('WHO BMI-for-age reference data is unavailable for this age and sex.');
    error.statusCode = 503;
    throw error;
  }

  if (lowerAge === upperAge) return lower;
  const fraction = ageMonths - lowerAge;
  return lower.map((value, index) => value + (upper[index] - value) * fraction);
}

function lmsZScore(bmi, l, m, s) {
  return l === 0
    ? Math.log(bmi / m) / s
    : (Math.pow(bmi / m, l) - 1) / (l * s);
}

function lookupZScore(sex, ageMonths, bmi) {
  if (!Number.isFinite(bmi) || bmi <= 0) {
    throw validationError('BMI must be a positive number to calculate BMI-for-age.');
  }

  const reference = getAgeReference(sex, ageMonths);
  const [, l, m, s, bmiMinus3, bmiMinus2, bmiPlus2, bmiPlus3] = reference;
  let zscore = lmsZScore(bmi, l, m, s);

  if (zscore < -3) {
    zscore = -3 + ((bmi - bmiMinus3) / (bmiMinus2 - bmiMinus3));
  } else if (zscore > 3) {
    zscore = 3 + ((bmi - bmiPlus3) / (bmiPlus3 - bmiPlus2));
  }

  if (!Number.isFinite(zscore) || zscore < -Z_SCORE_LIMIT || zscore > Z_SCORE_LIMIT) {
    throw validationError('The BMI-for-age result is outside the plausible WHO reference range. Please verify the measurements.');
  }

  const rounded = Math.round(zscore * 100) / 100;
  return {
    zscore: Object.is(rounded, -0) ? 0 : rounded,
    classificationZscore: zscore,
    bmi,
    method: 'WHO 2007 LMS with WHO +/-3 SD adjustment'
  };
}

function classifyByZScore(zscore) {
  if (!Number.isFinite(zscore)) {
    throw validationError('A valid WHO BMI-for-age Z-score is required for classification.');
  }
  if (zscore < -3) return 'Severe Thinness';
  if (zscore < -2) return 'Thinness';
  if (zscore <= 1) return 'Normal';
  if (zscore <= 2) return 'Overweight';
  return 'Obesity';
}

async function getReferenceStatus() {
  return {
    hasData: true,
    recordCount: referenceData.male.length + referenceData.female.length,
    ageRange: { min: MIN_AGE_MONTHS, max: MAX_AGE_MONTHS }
  };
}

module.exports = {
  lookupZScore,
  classifyByZScore,
  getReferenceStatus,
  normalizeSex,
  MIN_AGE_MONTHS,
  MAX_AGE_MONTHS
};
