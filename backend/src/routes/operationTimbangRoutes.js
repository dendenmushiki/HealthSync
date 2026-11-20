const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticate');
const authorizeRole = require('../middleware/authorize');
const createIdempotencyMiddleware = require('../middleware/idempotency');
const {
  listOperationTimbang,
  getOperationTimbang,
  calculateOperationTimbang,
  createOperationTimbang,
  updateOperationTimbang,
  deleteOperationTimbang,
  listPreviousMeasurements
} = require('../controllers/operationTimbangController');

// All endpoints require authentication
router.get('/', authenticateToken, authorizeRole(['bhw']), listOperationTimbang);
router.get('/previous/:residentId', authenticateToken, authorizeRole(['bhw']), listPreviousMeasurements);
router.get('/:id', authenticateToken, authorizeRole(['bhw']), getOperationTimbang);

// Calculations and record changes are restricted to BHW users.
router.post('/calculate', authenticateToken, authorizeRole(['bhw']), calculateOperationTimbang);
router.post('/', authenticateToken, authorizeRole(['bhw']), createIdempotencyMiddleware('operation_timbang', 'operation_timbang', { atomic: true }), createOperationTimbang);
router.put('/:id', authenticateToken, authorizeRole(['bhw']), createIdempotencyMiddleware('operation_timbang', 'operation_timbang'), updateOperationTimbang);
router.delete('/:id', authenticateToken, authorizeRole(['bhw']), createIdempotencyMiddleware('operation_timbang', 'operation_timbang'), deleteOperationTimbang);

module.exports = router;
