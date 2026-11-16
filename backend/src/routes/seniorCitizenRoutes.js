const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticate');
const authorizeRole = require('../middleware/authorize');
const createIdempotencyMiddleware = require('../middleware/idempotency');
const {
  listSeniorCitizens,
  getSeniorCitizen,
  createSeniorCitizen,
  updateSeniorCitizen,
  searchEligibleResidents,
  getNextSeniorId,
  removeSeniorCitizen
} = require('../controllers/seniorCitizenController');

// All endpoints require authentication
router.get('/', authenticateToken, authorizeRole(['bhw']), listSeniorCitizens);
router.get('/eligible-residents/search', authenticateToken, authorizeRole(['bhw']), searchEligibleResidents);
router.get('/next-id', authenticateToken, authorizeRole(['bhw']), getNextSeniorId);
router.get('/:id', authenticateToken, authorizeRole(['bhw']), getSeniorCitizen);

// Create and update - BHW and Admin only
router.post('/', authenticateToken, authorizeRole(['bhw']), createIdempotencyMiddleware('senior_citizens', 'senior_citizen_records'), createSeniorCitizen);
router.put('/:id', authenticateToken, authorizeRole(['bhw']), createIdempotencyMiddleware('senior_citizens', 'senior_citizen_records'), updateSeniorCitizen);
router.delete('/:id', authenticateToken, authorizeRole(['bhw']), createIdempotencyMiddleware('senior_citizens', 'senior_citizen_records'), removeSeniorCitizen);

module.exports = router;
