import growthStandards from '../../data/nutrition/who2006-growth-standards.json';
import adolescentReferences from '../../data/nutrition/who2007-bmi-for-age.json';

const DAYS_PER_MONTH = 30.4375;
const MAX_UNDER_FIVE_AGE_DAYS = 1826;
const LENGTH_HEIGHT_CUTOFF_DAYS = 731;
const BMI_INPUT_LIMITS = { maximumWeightKg: 300, minimumHeightCm: 50, maximumHeightCm: 230 };

function validationError(message, errors) {
  const error = new Error(message);
  if (errors) error.errors = errors;
  return error;
}

function calendarDate(value, label) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').slice(0, 10));
  if (!match) throw validationError(`${label} must be a valid date.`);
  const parts = match.slice(1).map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(parts[0], parts[1] - 1, parts[2]);
  if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1 || date.getUTCDate() !== parts[2]) {
    throw validationError(`${label} must be a valid date.`);
  }
  return {
    date,
    text: `${String(parts[0]).padStart(4, '0')}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`,
    year: parts[0],
    month: parts[1],
    day: parts[2],
  };
}

function getManilaToday() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeSex(sex, subject) {
  const value = String(sex || '').trim().toLowerCase();
  if (['male', 'm', '1'].includes(value)) return 'male';
  if (['female', 'f', '2'].includes(value)) return 'female';
  throw validationError(`${subject} sex must be recorded as male or female.`);
}

function validatePositiveMeasurement(value, label) {
  const measurement = Number(value);
  if (!Number.isFinite(measurement) || measurement <= 0) throw validationError(`${label} must be a positive number.`);
  return measurement;
}

function lmsZScore(value, lms, adjustExtreme = false) {
  const [l, m, s] = lms;
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(l) ||
      !Number.isFinite(m) || !Number.isFinite(s) || m <= 0 || s <= 0) {
    throw validationError('Unable to calculate nutritional status from the available WHO reference data.');
  }
  const calculate = (measurement) => (l === 0
    ? Math.log(measurement / m) / s
    : (Math.pow(measurement / m, l) - 1) / (l * s));
  let score = calculate(value);
  if (adjustExtreme && (score < -3 || score > 3)) {
    const valueAtZ = (z) => (l === 0
      ? m * Math.exp(s * z)
      : m * Math.pow(1 + l * s * z, 1 / l));
    const sd3 = valueAtZ(3);
    const sd2 = valueAtZ(2);
    const sdMinus3 = valueAtZ(-3);
    const sdMinus2 = valueAtZ(-2);
    score = score > 3
      ? 3 + ((value - sd3) / (sd3 - sd2))
      : -3 + ((value - sdMinus3) / (sdMinus2 - sdMinus3));
  }
  if (!Number.isFinite(score)) throw validationError('The measurement is outside the supported WHO growth reference range.');
  return Object.is(score, -0) ? 0 : score;
}

function classifyWeightForAge(score) {
  if (score < -3) return 'Severely underweight';
  if (score < -2) return 'Moderately underweight';
  if (score <= 2) return 'Normal';
  if (score <= 3) return 'Overweight';
  return 'Obese';
}

function classifyHeightForAge(score) {
  if (score < -3) return 'Severely stunted';
  if (score < -2) return 'Moderately stunted';
  if (score <= 2) return 'Normal';
  return 'Tall';
}

function classifyWeightForHeight(score) {
  if (score < -3) return 'Severely wasted/SAM';
  if (score < -2) return 'Moderately wasted/MAM';
  if (score <= 2) return 'Normal';
  if (score <= 3) return 'Overweight';
  return 'Obese';
}

function getWeightForHeightLms(sex, ageDays, measurementCm) {
  const indicator = ageDays < LENGTH_HEIGHT_CUTOFF_DAYS ? 'wfl' : 'wfh';
  const reference = growthStandards[indicator]?.[sex];
  const minCm = indicator === 'wfl' ? 45 : 65;
  const maxCm = indicator === 'wfl' ? 110 : 120;
  if (!reference || measurementCm < minCm || measurementCm > maxCm) {
    throw validationError(`The standardized measurement must be between ${minCm} and ${maxCm} cm for this age and measurement type.`);
  }
  const lowerCm = Math.floor((measurementCm + 1e-8) * 10) / 10;
  const upperCm = Math.min(lowerCm + 0.1, maxCm);
  const lowerIndex = Math.round((lowerCm - minCm) * 10);
  const upperIndex = Math.round((upperCm - minCm) * 10);
  const lower = reference[lowerIndex];
  const upper = reference[upperIndex];
  if (!lower || !upper) throw validationError('The measurement is outside the supported WHO growth reference range.');
  if (lowerIndex === upperIndex) return lower;
  const fraction = Math.max(0, Math.min(1, (measurementCm - lowerCm) / 0.1));
  return lower.map((value, index) => value + fraction * (upper[index] - value));
}

export function calculateOperationTimbangOffline(input = {}) {
  const birth = calendarDate(input.birthdate, "The child's birthdate");
  const measured = calendarDate(input.date_recorded, 'The measurement date');
  const today = getManilaToday();
  if (birth.text > today) throw validationError("The child's birthdate cannot be in the future.");
  if (measured.text > today) throw validationError('The measurement date cannot be in the future.');
  const sex = normalizeSex(input.sex, "The child's");
  const weight = validatePositiveMeasurement(input.weight_kg, 'Weight');
  const measurementCm = validatePositiveMeasurement(input.measurement_cm, 'Height or length');
  if (!['length', 'height'].includes(input.measurement_type)) {
    throw validationError('Measurement type is required. Choose recumbent length or standing height.');
  }

  const ageDaysExact = (measured.date.getTime() - birth.date.getTime()) / 86400000;
  if (ageDaysExact < 0) throw validationError("The measurement date cannot be before the child's birthdate.");
  let ageInMonths = (measured.year - birth.year) * 12 + measured.month - birth.month;
  if (measured.day < birth.day) ageInMonths -= 1;
  const anthroAgeInMonths = ageDaysExact / DAYS_PER_MONTH;
  if (ageInMonths >= 60 || anthroAgeInMonths >= 60 || ageDaysExact > MAX_UNDER_FIVE_AGE_DAYS) {
    throw validationError('Operation Timbang is only supported for children younger than 60 months.');
  }
  const ageDays = Math.round(ageDaysExact);
  if (!growthStandards.wfa?.[sex]?.[ageDays] || !growthStandards.hfa?.[sex]?.[ageDays]) {
    throw validationError("The child's age is outside the available WHO growth reference range.");
  }
  if (ageDays < 274 && input.measurement_type === 'height') {
    throw validationError('WHO Anthro treats standing-height measurements before 9 months as implausible. Please record recumbent length.');
  }
  let standardizedCm = measurementCm;
  if (ageDays < LENGTH_HEIGHT_CUTOFF_DAYS && input.measurement_type === 'height') standardizedCm += 0.7;
  else if (ageDays >= LENGTH_HEIGHT_CUTOFF_DAYS && input.measurement_type === 'length') standardizedCm -= 0.7;

  const wfa = lmsZScore(weight, growthStandards.wfa[sex][ageDays], true);
  const hfa = lmsZScore(standardizedCm, growthStandards.hfa[sex][ageDays]);
  const wflh = lmsZScore(weight, getWeightForHeightLms(sex, ageDays, standardizedCm), true);
  if (wfa < -6 || wfa > 5) throw validationError("Weight-for-age is outside the plausible WHO range. Please verify the child's measurements.");
  if (hfa < -6 || hfa > 6) throw validationError("Height/length-for-age is outside the plausible WHO range. Please verify the child's measurements.");
  if (wflh < -5 || wflh > 5) throw validationError("Weight-for-length/height is outside the plausible WHO range. Please verify the child's measurements.");
  return {
    age_in_days: ageDays,
    age_in_months: Math.floor(ageInMonths),
    wfa_zscore: wfa,
    wfa_status: classifyWeightForAge(wfa),
    hfa_zscore: hfa,
    hfa_status: classifyHeightForAge(hfa),
    wflh_zscore: wflh,
    wflh_status: classifyWeightForHeight(wflh),
  };
}

export function calculateAdultBMIOffline(resident, input = {}) {
  const measured = calendarDate(input.date_recorded, 'Record date');
  if (measured.text > getManilaToday()) throw validationError('Record date cannot be in the future.');
  const birth = calendarDate(resident?.birthdate, 'Resident birthdate');
  if (measured.text < birth.text) throw validationError('Record date cannot be before the resident birthdate.');
  let ageMonths = (measured.year - birth.year) * 12 + measured.month - birth.month;
  if (measured.day < birth.day) ageMonths -= 1;
  if (ageMonths < 229) throw validationError(`Resident is ${Math.floor(ageMonths / 12)} years old. Adult BMI classification is available from 19 years and 1 month.`);

  const weight = Number(input.weight_kg);
  const height = Number(input.height_cm);
  const errors = [];
  if (!weight || !Number.isFinite(weight) || weight <= 0) errors.push('Weight must be a positive number');
  if (weight > BMI_INPUT_LIMITS.maximumWeightKg) errors.push('Weight seems unusually high');
  if (!height || !Number.isFinite(height) || height <= 0) errors.push('Height must be a positive number');
  if (height < BMI_INPUT_LIMITS.minimumHeightCm) errors.push('Height seems unusually low');
  if (height > BMI_INPUT_LIMITS.maximumHeightCm) errors.push('Height seems unusually high');
  if (errors.length) throw validationError('Invalid BMI input', errors);
  const bmi = Math.round((weight / ((height / 100) ** 2)) * 100) / 100;
  const bmiCategory = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese';
  return {
    resident_id: input.resident_id,
    date_recorded: measured.text,
    age_years: Math.floor(ageMonths / 12),
    height_cm: height,
    weight_kg: weight,
    bmi,
    bmi_category: bmiCategory,
  };
}

function validateAdolescentBMI(weight, height) {
  const errors = [];
  if (!weight || !Number.isFinite(weight) || weight <= 0) errors.push('Weight must be a positive number');
  if (weight > BMI_INPUT_LIMITS.maximumWeightKg) errors.push('Weight seems unusually high');
  if (!height || !Number.isFinite(height) || height <= 0) errors.push('Height must be a positive number');
  if (height < BMI_INPUT_LIMITS.minimumHeightCm) errors.push('Height seems unusually low');
  if (height > BMI_INPUT_LIMITS.maximumHeightCm) errors.push('Height seems unusually high');
  if (errors.length) throw validationError('Invalid BMI input', errors);
}

function lookupAdolescentZScore(sex, ageMonths, bmi) {
  const normalizedSex = normalizeSex(sex, 'Resident');
  const minimum = adolescentReferences.minimumAgeMonths;
  const maximum = adolescentReferences.maximumAgeMonths;
  if (!Number.isFinite(ageMonths) || ageMonths < minimum || ageMonths > maximum) {
    throw validationError(`Adolescent BMI is supported for ages ${minimum}-${maximum} months by the WHO 2007 references.`);
  }
  if (!Number.isFinite(bmi) || bmi <= 0) throw validationError('BMI must be a positive number to calculate BMI-for-age.');
  const lowerAge = Math.floor(ageMonths);
  const upperAge = Math.ceil(ageMonths);
  const lower = adolescentReferences[normalizedSex][lowerAge - minimum];
  const upper = adolescentReferences[normalizedSex][upperAge - minimum];
  if (!lower || !upper) throw validationError('WHO BMI-for-age reference data is unavailable for this age and sex.');
  const reference = lowerAge === upperAge
    ? lower
    : lower.map((value, index) => value + (upper[index] - value) * (ageMonths - lowerAge));
  const [, l, m, s, bmiMinus3, bmiMinus2, bmiPlus2, bmiPlus3] = reference;
  let zscore = l === 0 ? Math.log(bmi / m) / s : (Math.pow(bmi / m, l) - 1) / (l * s);
  if (zscore < -3) zscore = -3 + ((bmi - bmiMinus3) / (bmiMinus2 - bmiMinus3));
  else if (zscore > 3) zscore = 3 + ((bmi - bmiPlus3) / (bmiPlus3 - bmiPlus2));
  if (!Number.isFinite(zscore) || zscore < -5 || zscore > 5) {
    throw validationError('The BMI-for-age result is outside the plausible WHO reference range. Please verify the measurements.');
  }
  return zscore;
}

function classifyAdolescentBMI(zscore) {
  if (zscore < -3) return 'Severe Thinness';
  if (zscore < -2) return 'Thinness';
  if (zscore <= 1) return 'Normal';
  if (zscore <= 2) return 'Overweight';
  return 'Obesity';
}

export function calculateAdolescentBMIOffline(resident, input = {}) {
  const measured = calendarDate(input.record_date, 'Record date');
  if (measured.text > getManilaToday()) throw validationError('Record date cannot be in the future.');
  const birth = calendarDate(resident?.birthdate, 'Resident birthdate');
  if (measured.text < birth.text) throw validationError('Record date cannot be before the resident birthdate.');
  let ageMonths = (measured.year - birth.year) * 12 + measured.month - birth.month;
  if (measured.day < birth.day) ageMonths -= 1;
  if (ageMonths < adolescentReferences.minimumAgeMonths || ageMonths > adolescentReferences.maximumAgeMonths) {
    throw validationError(`Adolescent BMI is supported for ages ${adolescentReferences.minimumAgeMonths}-${adolescentReferences.maximumAgeMonths} months by the WHO 2007 references.`);
  }
  const weight = Number(input.weight_kg);
  const height = Number(input.height_cm);
  validateAdolescentBMI(weight, height);
  const bmi = Math.round((weight / ((height / 100) ** 2)) * 100) / 100;
  const rawBmi = weight / ((height / 100) ** 2);
  const zscore = lookupAdolescentZScore(resident.sex, ageMonths, rawBmi);
  return {
    record_date: measured.text,
    age_years: Math.floor(ageMonths / 12),
    age_months: ageMonths,
    height_cm: height,
    weight_kg: weight,
    bmi,
    bmi_for_age_zscore: Object.is(Math.round(zscore * 100) / 100, -0) ? 0 : Math.round(zscore * 100) / 100,
    bmi_for_age_category: classifyAdolescentBMI(zscore),
  };
}
