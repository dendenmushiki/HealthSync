const bmiService = require('./bmiService');
const whoReferenceService = require('./whoReferenceService');

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function calendarDate(value, label, allowTimestamp = false) {
  let dateText;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    dateText = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  } else if (typeof value === 'string') {
    dateText = allowTimestamp ? value.slice(0, 10) : value;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText || '');
  if (!match) throw validationError(`${label} must be a valid date.`);

  const [, year, month, day] = match.map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) {
    throw validationError(`${label} must be a valid date.`);
  }
  return {
    text: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    year,
    month,
    day
  };
}

function getTodayDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function calculateAssessment(resident, recordDateInput, weightInput, heightInput) {
  const recordDate = calendarDate(recordDateInput, 'Record date');
  if (recordDate.text > getTodayDate()) {
    throw validationError('Record date cannot be in the future.');
  }
  if (!resident?.birthdate) {
    throw validationError('Resident birthdate is required for BMI-for-age classification.');
  }

  const birthDate = calendarDate(resident.birthdate, 'Resident birthdate', true);
  if (recordDate.text < birthDate.text) {
    throw validationError('Record date cannot be before the resident birthdate.');
  }

  let ageMonths = (recordDate.year - birthDate.year) * 12 + recordDate.month - birthDate.month;
  if (recordDate.day < birthDate.day) ageMonths -= 1;
  if (ageMonths < whoReferenceService.MIN_AGE_MONTHS || ageMonths > whoReferenceService.MAX_AGE_MONTHS) {
    throw validationError(`Adolescent BMI is supported for ages ${whoReferenceService.MIN_AGE_MONTHS}-${whoReferenceService.MAX_AGE_MONTHS} months by the WHO 2007 references.`);
  }

  const weight = Number(weightInput);
  const height = Number(heightInput);
  const validation = bmiService.validateBMIInput(weight, height);
  if (!validation.valid) {
    const error = validationError('Invalid BMI input');
    error.errors = validation.errors;
    throw error;
  }

  const bmi = bmiService.calculateBMI(weight, height);
  const bmiForReference = weight / ((height / 100) ** 2);
  const whoData = whoReferenceService.lookupZScore(resident.sex, ageMonths, bmiForReference);
  return {
    record_date: recordDate.text,
    age_years: Math.floor(ageMonths / 12),
    age_months: ageMonths,
    height_cm: height,
    weight_kg: weight,
    bmi,
    bmi_for_age_zscore: whoData.zscore,
    bmi_for_age_category: whoReferenceService.classifyByZScore(whoData.classificationZscore)
  };
}

module.exports = { calculateAssessment };
