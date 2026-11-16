const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticate');
const authorizeRole = require('../middleware/authorize');
const {
  listAdultBMI,
  getAdultBMI,
  createAdultBMI,
  updateAdultBMI,
  deleteAdultBMI,
  previewAdultBMI,
  getPreviousAdultBMI
} = require('../controllers/adultBMIController');

// All endpoints require authentication
router.get('/', authenticateToken, authorizeRole(['bhw']), listAdultBMI);
router.get('/previous/:residentId', authenticateToken, authorizeRole(['bhw']), getPreviousAdultBMI);
router.get('/:id', authenticateToken, authorizeRole(['bhw']), getAdultBMI);
router.post('/preview', authenticateToken, authorizeRole(['bhw']), previewAdultBMI);

// Create and update - BHW and Admin only
router.post('/', authenticateToken, authorizeRole(['bhw']), createAdultBMI);
router.put('/:id', authenticateToken, authorizeRole(['bhw']), updateAdultBMI);
router.delete('/:id', authenticateToken, authorizeRole(['bhw']), deleteAdultBMI);

module.exports = router;
