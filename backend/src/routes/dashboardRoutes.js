const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticate');
const authorizeRole = require('../middleware/authorize');
const {
  getSummary,
  getNutritionStats,
  getBMIStats,
  getAdminSummary
} = require('../controllers/dashboardController');

router.get('/summary', authenticateToken, authorizeRole(['bhw', 'official']), getSummary);
router.get('/nutrition', authenticateToken, authorizeRole(['bhw']), getNutritionStats);
router.get('/bmi', authenticateToken, authorizeRole(['bhw']), getBMIStats);
router.get('/admin-summary', authenticateToken, authorizeRole(['admin']), getAdminSummary);

module.exports = router;
