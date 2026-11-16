const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC_RANGES = {
  heart_rate: [20, 250],
  respiratory_rate: [5, 80],
  height_cm: [20, 250],
  weight_kg: [0.3, 400],
  temperature: [25, 45],
  menstrual_pads_per_day: [0, 100],
  gravida: [0, 50],
  parity: [0, 50],
  full_term: [0, 50],
  premature: [0, 50],
  abortion: [0, 50],
  living_children: [0, 50]
};

function isValidDate(value, allowFuture = false) {
  if (!DATE_PATTERN.test(String(value || ''))) return false;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  if (allowFuture) return true;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  return value <= today;
}

function validateClinicalRecord(recordData) {
  if (!recordData || typeof recordData !== 'object' || Array.isArray(recordData)) return { record_data: 'A valid clinical record is required.' };
  const errors = {};
  if (!['New', 'Follow-up', 'Referral'].includes(recordData.client_type)) {
    errors.client_type = 'Select a client type.';
  }
  if (!isValidDate(recordData.visit_date)) errors.visit_date = 'Enter a valid visit date that is not in the future.';
  if (recordData.visit_time && !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(String(recordData.visit_time))) {
    errors.visit_time = 'Enter a valid visit time.';
  }
  if (recordData.blood_pressure && !/^\s*\d{2,3}\s*\/\s*\d{2,3}\s*$/.test(String(recordData.blood_pressure))) {
    errors.blood_pressure = 'Enter blood pressure as systolic/diastolic, for example 120/80.';
  } else if (recordData.blood_pressure) {
    const [systolic, diastolic] = String(recordData.blood_pressure).split('/').map(Number);
    if (systolic < 50 || systolic > 300 || diastolic < 30 || diastolic > 200) {
      errors.blood_pressure = 'Enter a plausible blood pressure value.';
    }
  }
  if (recordData.lmp && !isValidDate(recordData.lmp)) errors.lmp = 'Enter a valid last menstrual period date that is not in the future.';
  if (Array.isArray(recordData.past_surgical_history)) {
    recordData.past_surgical_history.forEach((operation, index) => {
      if (operation?.date && !isValidDate(operation.date)) {
        errors[`past_surgical_history.${index}.date`] = 'Enter a valid operation date that is not in the future.';
      }
    });
  }

  Object.entries(NUMERIC_RANGES).forEach(([field, [minimum, maximum]]) => {
    const value = recordData[field];
    if (value === '' || value === null || value === undefined) return;
    const number = Number(value);
    if (!Number.isFinite(number) || number < minimum || number > maximum) {
      errors[field] = `Enter a value between ${minimum} and ${maximum}.`;
    }
  });
  return errors;
}

module.exports = { validateClinicalRecord };
