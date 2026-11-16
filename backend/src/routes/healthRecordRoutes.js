const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticate');
const authorizeRole = require('../middleware/authorize');
const {
  listAllHealthRecords,
  listHealthRecords,
  getHealthRecordDetails,
  getHealthRecord,
  createHealthRecord,
  updateHealthRecord,
  deleteHealthRecord
} = require('../controllers/healthRecordController');

// Health-record data is restricted to BHW users; reporting has separate aggregate endpoints.
router.get('/', authenticateToken, authorizeRole(['bhw']), listHealthRecords);
router.get('/overview', authenticateToken, authorizeRole(['bhw']), listAllHealthRecords);
router.get('/details/:sourceTable/:recordId', authenticateToken, authorizeRole(['bhw']), getHealthRecordDetails);
router.get('/:id', authenticateToken, authorizeRole(['bhw']), getHealthRecord);

router.post('/', authenticateToken, authorizeRole(['bhw']), createHealthRecord);
router.put('/:id', authenticateToken, authorizeRole(['bhw']), updateHealthRecord);
router.delete('/:id', authenticateToken, authorizeRole(['bhw']), deleteHealthRecord);

module.exports = router;
