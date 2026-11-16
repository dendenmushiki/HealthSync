const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticate');
const authorizeRole = require('../middleware/authorize');
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
router.post('/', authenticateToken, authorizeRole(['bhw']), createSeniorCitizen);
router.put('/:id', authenticateToken, authorizeRole(['bhw']), updateSeniorCitizen);
router.delete('/:id', authenticateToken, authorizeRole(['bhw']), removeSeniorCitizen);

module.exports = router;
