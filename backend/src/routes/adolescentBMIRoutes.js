const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticate');
const authorizeRole = require('../middleware/authorize');
const {
  listAdolescentBMI,
  getAdolescentBMI,
  previewAdolescentBMI,
  createAdolescentBMI,
  updateAdolescentBMI,
  deleteAdolescentBMI,
  listPreviousAdolescentBMI
} = require('../controllers/adolescentBMIController');

// All endpoints require authentication
router.get('/', authenticateToken, authorizeRole(['bhw']), listAdolescentBMI);
router.post('/preview', authenticateToken, authorizeRole(['bhw']), previewAdolescentBMI);
router.get('/previous/:residentId', authenticateToken, authorizeRole(['bhw']), listPreviousAdolescentBMI);
router.get('/:id', authenticateToken, authorizeRole(['bhw']), getAdolescentBMI);

// Create and update - BHW and Admin only
router.post('/', authenticateToken, authorizeRole(['bhw']), createAdolescentBMI);
router.put('/:id', authenticateToken, authorizeRole(['bhw']), updateAdolescentBMI);
router.delete('/:id', authenticateToken, authorizeRole(['bhw']), deleteAdolescentBMI);

module.exports = router;
