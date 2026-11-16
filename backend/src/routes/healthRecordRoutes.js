const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticate');
const authorizeRole = require('../middleware/authorize');
const createIdempotencyMiddleware = require('../middleware/idempotency');
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

router.post('/', authenticateToken, authorizeRole(['bhw']), createIdempotencyMiddleware('health_records', 'health_records'), createHealthRecord);
router.put('/:id', authenticateToken, authorizeRole(['bhw']), createIdempotencyMiddleware('health_records', 'health_records'), updateHealthRecord);
router.delete('/:id', authenticateToken, authorizeRole(['bhw']), createIdempotencyMiddleware('health_records', 'health_records'), deleteHealthRecord);

module.exports = router;
