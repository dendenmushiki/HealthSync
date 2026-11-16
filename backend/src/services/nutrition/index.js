/**
 * Nutrition Services Index
 * Exports all nutrition-related services
 */

const ageService = require('./ageService');
const bmiService = require('./bmiService');
const whoReferenceService = require('./whoReferenceService');
const optPlusService = require('./optPlusService');

module.exports = {
  ageService,
  bmiService,
  whoReferenceService,
  optPlusService
};
