/**
 * Age Calculation Service
 * Handles precise age calculations from birthdate
 */

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
  const bd = new Date(birthdate);
  const rd = new Date(refDate);
  
  let months = (rd.getFullYear() - bd.getFullYear()) * 12;
  months += rd.getMonth() - bd.getMonth();
  
  // If haven't had the day of month yet, subtract 1
  if (rd.getDate() < bd.getDate()) {
    months--;
  }
  
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
  if (ageMonths < 240) return 'adolescent';
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
    isAdolescent: ageMonths >= 60 && ageMonths < 240, // 5-19 years
    isAdult: ageYears >= 20,             // 20+ years
    isSeniorEligible: ageYears >= 60     // 60+ years
  };
}

module.exports = {
  getAgeYears,
  getAgeMonths,
  getExactAge,
  getAgeGroup,
  getNutritionEligibility
};
