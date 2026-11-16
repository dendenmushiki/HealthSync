const growthStandards = require('./who2006-growth-standards.json');

const DAYS_PER_MONTH = 30.4375;
const MAX_UNDER_FIVE_AGE_DAYS = 1826;
const LENGTH_HEIGHT_CUTOFF_DAYS = 731;

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function calendarDate(value, label) {
  let parts;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    parts = [value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()];
  } else if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw validationError(`${label} must be a valid date.`);
    parts = match.slice(1).map(Number);
  } else {
    throw validationError(`${label} must be a valid date.`);
  }

  const [year, month, day] = parts;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw validationError(`${label} must be a valid date.`);
  }
  return { date, value: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}

function normalizeSex(sex) {
  const normalized = String(sex || '').trim().toLowerCase();
  if (normalized === 'male' || normalized === 'm' || normalized === '1') return 'male';
  if (normalized === 'female' || normalized === 'f' || normalized === '2') return 'female';
  throw validationError("The child's sex must be recorded as male or female to calculate WHO growth indicators.");
}

function validateMeasurement(value, label) {
  const measurement = Number(value);
  if (!Number.isFinite(measurement) || measurement <= 0) {
    throw validationError(`${label} must be a positive number.`);
  }
  return measurement;
}

function lmsZScore(value, lms, adjustExtreme = false) {
  const [l, m, s] = lms;
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(l) || !Number.isFinite(m) || !Number.isFinite(s) || m <= 0 || s <= 0) {
    throw validationError('Unable to calculate nutritional status from the available WHO reference data.');
  }

  const calculate = (measurement) => (l === 0
    ? Math.log(measurement / m) / s
    : (Math.pow(measurement / m, l) - 1) / (l * s));

  let zScore = calculate(value);
  if (adjustExtreme && (zScore < -3 || zScore > 3)) {
    const valueAtZ = (z) => (l === 0
      ? m * Math.exp(s * z)
      : m * Math.pow(1 + l * s * z, 1 / l));
    const sd3 = valueAtZ(3);
    const sd2 = valueAtZ(2);
    const sdMinus3 = valueAtZ(-3);
    const sdMinus2 = valueAtZ(-2);
    zScore = zScore > 3
      ? 3 + ((value - sd3) / (sd3 - sd2))
      : -3 + ((value - sdMinus3) / (sdMinus2 - sdMinus3));
  }

  if (!Number.isFinite(zScore)) {
    throw validationError('The measurement is outside the supported WHO growth reference range.');
  }
  return Object.is(zScore, -0) ? 0 : zScore;
}

function classifyWeightForAge(zScore) {
  if (zScore < -3) return 'Severely underweight';
  if (zScore < -2) return 'Moderately underweight';
  if (zScore <= 2) return 'Normal';
  if (zScore <= 3) return 'Overweight';
  return 'Obese';
}

function classifyHeightForAge(zScore) {
  if (zScore < -3) return 'Severely stunted';
  if (zScore < -2) return 'Moderately stunted';
  if (zScore <= 2) return 'Normal';
  return 'Tall';
}

function classifyWeightForHeight(zScore) {
  if (zScore < -3) return 'Severely wasted/SAM';
  if (zScore < -2) return 'Moderately wasted/MAM';
  if (zScore <= 2) return 'Normal';
  if (zScore <= 3) return 'Overweight';
  return 'Obese';
}

function assertPlausibleScore(score, lowerBound, upperBound, indicator) {
  if (score < lowerBound || score > upperBound) {
    throw validationError(`${indicator} is outside the plausible WHO range. Please verify the child's measurements.`);
  }
}

function getInterpolatedWeightForHeightLms(sex, ageDays, measurementCm) {
  const indicator = ageDays < LENGTH_HEIGHT_CUTOFF_DAYS ? 'wfl' : 'wfh';
  const reference = growthStandards[indicator][sex];
  const minCm = indicator === 'wfl' ? 45 : 65;
  const maxCm = indicator === 'wfl' ? 110 : 120;
  if (measurementCm < minCm || measurementCm > maxCm) {
    throw validationError(`The standardized measurement must be between ${minCm} and ${maxCm} cm for this age and measurement type.`);
  }

  const lowerCm = Math.floor((measurementCm + 1e-8) * 10) / 10;
  const upperCm = Math.min(lowerCm + 0.1, maxCm);
  const lowerIndex = Math.round((lowerCm - minCm) * 10);
  const upperIndex = Math.round((upperCm - minCm) * 10);
  const lower = reference[lowerIndex];
  const upper = reference[upperIndex];
  if (!lower || !upper) {
    throw validationError('The measurement is outside the supported WHO growth reference range.');
  }
  if (lowerIndex === upperIndex) return lower;

  const fraction = Math.max(0, Math.min(1, (measurementCm - lowerCm) / 0.1));
  return lower.map((value, index) => value + fraction * (upper[index] - value));
}

function getTodayDateInManila() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function calculateOperationTimbang(input = {}) {
  if (!input || typeof input !== 'object') throw validationError('Measurement details are required.');
  const { birthdate, sex, date_recorded, weight_kg, measurement_cm, measurement_type } = input;
  const birth = calendarDate(birthdate, "The child's birthdate");
  const measurementDate = calendarDate(date_recorded, 'The measurement date');
  const today = getTodayDateInManila();
  if (birth.value > today) {
    throw validationError("The child's birthdate cannot be in the future.");
  }
  if (measurementDate.value > today) {
    throw validationError('The measurement date cannot be in the future.');
  }

  const sexKey = normalizeSex(sex);
  const weightKg = validateMeasurement(weight_kg, 'Weight');
  const measurementCm = validateMeasurement(measurement_cm, 'Height or length');
  if (!['length', 'height'].includes(measurement_type)) {
    throw validationError('Measurement type is required. Choose recumbent length or standing height.');
  }

  const ageInDays = (measurementDate.date.getTime() - birth.date.getTime()) / 86400000;
  if (ageInDays < 0) throw validationError("The measurement date cannot be before the child's birthdate.");
  let ageInMonths = ((measurementDate.date.getUTCFullYear() - birth.date.getUTCFullYear()) * 12)
    + measurementDate.date.getUTCMonth() - birth.date.getUTCMonth();
  if (measurementDate.date.getUTCDate() < birth.date.getUTCDate()) ageInMonths -= 1;
  const anthroAgeInMonths = ageInDays / DAYS_PER_MONTH;
  if (ageInMonths >= 60 || anthroAgeInMonths >= 60 || ageInDays > MAX_UNDER_FIVE_AGE_DAYS) {
    throw validationError('Operation Timbang is only supported for children younger than 60 months.');
  }
  const referenceAgeDays = Math.round(ageInDays);
  if (referenceAgeDays < 0 || referenceAgeDays >= growthStandards.wfa[sexKey].length) {
    throw validationError("The child's age is outside the available WHO growth reference range.");
  }
  if (referenceAgeDays < 274 && measurement_type === 'height') {
    throw validationError('WHO Anthro treats standing-height measurements before 9 months as implausible. Please record recumbent length.');
  }

  let standardizedMeasurementCm = measurementCm;
  if (referenceAgeDays < LENGTH_HEIGHT_CUTOFF_DAYS && measurement_type === 'height') {
    standardizedMeasurementCm += 0.7;
  } else if (referenceAgeDays >= LENGTH_HEIGHT_CUTOFF_DAYS && measurement_type === 'length') {
    standardizedMeasurementCm -= 0.7;
  }

  const wfaZScore = lmsZScore(weightKg, growthStandards.wfa[sexKey][referenceAgeDays], true);
  const hfaZScore = lmsZScore(standardizedMeasurementCm, growthStandards.hfa[sexKey][referenceAgeDays]);
  const wflhZScore = lmsZScore(
    weightKg,
    getInterpolatedWeightForHeightLms(sexKey, referenceAgeDays, standardizedMeasurementCm),
    true
  );

  assertPlausibleScore(wfaZScore, -6, 5, 'Weight-for-age');
  assertPlausibleScore(hfaZScore, -6, 6, 'Height/length-for-age');
  assertPlausibleScore(wflhZScore, -5, 5, 'Weight-for-length/height');

  return {
    age_in_days: referenceAgeDays,
    age_in_months: Math.floor(ageInMonths),
    wfa_zscore: wfaZScore,
    wfa_status: classifyWeightForAge(wfaZScore),
    hfa_zscore: hfaZScore,
    hfa_status: classifyHeightForAge(hfaZScore),
    wflh_zscore: wflhZScore,
    wflh_status: classifyWeightForHeight(wflhZScore),
  };
}

module.exports = {
  calculateOperationTimbang,
  classifyWeightForAge,
  classifyHeightForAge,
  classifyWeightForHeight,
  lmsZScore,
};
