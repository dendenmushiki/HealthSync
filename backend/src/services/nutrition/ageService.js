/**
 * Age Calculation Service
 * Handles precise age calculations from birthdate
 */
const MIN_ADULT_BMI_AGE_MONTHS = 229;

/**
 * Calculate age in years from birthdate
 * @param {Date|string} birthdate - Birth date (Date object or ISO string)
 * @param {Date|string} refDate - Reference date (defaults to today)
 * @returns {number} Age in years
 */
function getAgeYears(birthdate, refDate = new Date()) {
  const bd = new Date(birthdate);
  const rd = new Date(refDate);
  
  let age = rd.getFullYear() - bd.getFullYear();
  const monthDiff = rd.getMonth() - bd.getMonth();
  
  // If haven't had birthday this year, subtract 1
  if (monthDiff < 0 || (monthDiff === 0 && rd.getDate() < bd.getDate())) {
    age--;
  }
  
  return age;
}

/**
 * Calculate age in months from birthdate
 * @param {Date|string} birthdate - Birth date
 * @param {Date|string} refDate - Reference date (defaults to today)
 * @returns {number} Age in months
 */
function getAgeMonths(birthdate, refDate = new Date()) {
  const dateParts = (value) => {
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return null;
      return { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() };
    }

    const text = String(value || '');
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(text);
    if (match) {
      const [, year, month, day] = match.map(Number);
      const parsed = new Date(Date.UTC(year, month - 1, day));
      if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) return null;
      return { year, month, day };
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return { year: parsed.getFullYear(), month: parsed.getMonth() + 1, day: parsed.getDate() };
  };
  const birth = dateParts(birthdate);
  const reference = dateParts(refDate);
  if (!birth || !reference) return NaN;

  let months = (reference.year - birth.year) * 12 + reference.month - birth.month;
  if (reference.day < birth.day) months--;
  return Math.max(0, months);
}

/**
 * Calculate exact age as {years, months, days}
 * @param {Date|string} birthdate
 * @param {Date|string} refDate
 * @returns {object} {years, months, days}
 */
function getExactAge(birthdate, refDate = new Date()) {
  const bd = new Date(birthdate);
  const rd = new Date(refDate);
  
  let years = rd.getFullYear() - bd.getFullYear();
  let months = rd.getMonth() - bd.getMonth();
  let days = rd.getDate() - bd.getDate();
  
  // Adjust for day overflow
  if (days < 0) {
    months--;
    const lastMonth = new Date(rd.getFullYear(), rd.getMonth(), 0);
    days += lastMonth.getDate();
  }
  
  // Adjust for month overflow
  if (months < 0) {
    years--;
    months += 12;
  }
  
  return { years, months, days };
}

/**
 * Determine age group
 * @param {number} ageMonths - Age in months
 * @returns {string} 'infant', 'toddler', 'preschool', 'child', 'adolescent', 'adult', 'senior'
 */
function getAgeGroup(ageMonths) {
  if (ageMonths < 12) return 'infant';
  if (ageMonths < 24) return 'toddler';
  if (ageMonths < 60) return 'preschool';
  if (ageMonths < 120) return 'child';
  if (ageMonths < MIN_ADULT_BMI_AGE_MONTHS) return 'adolescent';
  if (ageMonths < 720) return 'adult';
  return 'senior';
}

/**
 * Check if age falls within specific range
 * @param {number} ageMonths
 * @returns {object} Nutrition classification group eligibility
 */
function getNutritionEligibility(ageMonths) {
  const ageYears = Math.floor(ageMonths / 12);
  
  return {
    isUnder5: ageMonths < 60,           // Operation Timbang eligible
    isAdolescent: ageMonths >= 60 && ageMonths < MIN_ADULT_BMI_AGE_MONTHS,
    isAdult: ageMonths >= MIN_ADULT_BMI_AGE_MONTHS,
    isSeniorEligible: ageYears >= 60     // 60+ years
  };
}

module.exports = {
  MIN_ADULT_BMI_AGE_MONTHS,
  getAgeYears,
  getAgeMonths,
  getExactAge,
  getAgeGroup,
  getNutritionEligibility
};
