const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticate');
const authorizeRole = require('../middleware/authorize');
const { listNutritionRecords, getNutritionRecord, exportNutritionRecords } = require('../controllers/nutritionRecordController');

router.get('/records', authenticateToken, authorizeRole(['bhw']), listNutritionRecords);
router.get('/records/export', authenticateToken, authorizeRole(['bhw']), exportNutritionRecords);
router.get('/records/:type/:id', authenticateToken, authorizeRole(['bhw']), getNutritionRecord);

module.exports = router;
