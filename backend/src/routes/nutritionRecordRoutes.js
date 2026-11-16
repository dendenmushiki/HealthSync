const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticate');
const authorizeRole = require('../middleware/authorize');
const { listNutritionRecords, getNutritionRecord, exportNutritionRecords } = require('../controllers/nutritionRecordController');

router.get('/records', authenticateToken, authorizeRole(['bhw', 'admin', 'official']), listNutritionRecords);
router.get('/records/export', authenticateToken, authorizeRole(['bhw', 'admin', 'official']), exportNutritionRecords);
router.get('/records/:type/:id', authenticateToken, authorizeRole(['bhw', 'admin', 'official']), getNutritionRecord);

module.exports = router;
