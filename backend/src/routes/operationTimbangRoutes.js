const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticate');
const authorizeRole = require('../middleware/authorize');
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
router.post('/', authenticateToken, authorizeRole(['bhw']), createOperationTimbang);
router.put('/:id', authenticateToken, authorizeRole(['bhw']), updateOperationTimbang);
router.delete('/:id', authenticateToken, authorizeRole(['bhw']), deleteOperationTimbang);

module.exports = router;
