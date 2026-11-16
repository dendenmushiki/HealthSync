const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticate');
const authorizeRole = require('../middleware/authorize');
const createIdempotencyMiddleware = require('../middleware/idempotency');
const {
  listChildHealthRecords,
  getChildHealthRecord,
  createChildHealthRecord,
  updateChildHealthRecord,
  deleteChildHealthRecord
} = require('../controllers/childHealthController');

router.get('/', authenticateToken, authorizeRole(['bhw', 'official']), listChildHealthRecords);
router.get('/:id', authenticateToken, authorizeRole(['bhw', 'official']), getChildHealthRecord);
router.post('/', authenticateToken, authorizeRole(['bhw']), createIdempotencyMiddleware('child_health', 'child_health_records'), createChildHealthRecord);
router.put('/:id', authenticateToken, authorizeRole(['bhw']), createIdempotencyMiddleware('child_health', 'child_health_records'), updateChildHealthRecord);
router.delete('/:id', authenticateToken, authorizeRole(['bhw']), createIdempotencyMiddleware('child_health', 'child_health_records'), deleteChildHealthRecord);

module.exports = router;
