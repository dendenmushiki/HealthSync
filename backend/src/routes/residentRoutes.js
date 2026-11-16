const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticate');
const authorizeRole = require('../middleware/authorize');
const createIdempotencyMiddleware = require('../middleware/idempotency');
const { listResidents, getResident, createResident, updateResident, deleteResident } = require('../controllers/residentController');
const { uploadProfilePhoto } = require('../middleware/profilePhotoUpload');
const { uploadResidentPhoto, deleteResidentPhoto } = require('../controllers/profilePhotoController');
const { getResidentSummary } = require('../controllers/residentSummaryController');

// Public read endpoints (protected to authenticated users)
router.get('/', authenticateToken, authorizeRole(['bhw']), listResidents);
router.get('/:id/summary', authenticateToken, authorizeRole(['bhw']), getResidentSummary);
router.get('/:id', authenticateToken, authorizeRole(['bhw']), getResident);

// Create and update - only BHW and Admin
router.post('/', authenticateToken, authorizeRole(['bhw']), createIdempotencyMiddleware('residents', 'residents'), createResident);
router.put('/:id', authenticateToken, authorizeRole(['bhw']), createIdempotencyMiddleware('residents', 'residents'), updateResident);
router.post('/:id/photo', authenticateToken, authorizeRole(['bhw']), uploadProfilePhoto, uploadResidentPhoto);
router.delete('/:id/photo', authenticateToken, authorizeRole(['bhw']), deleteResidentPhoto);
router.delete('/:id', authenticateToken, authorizeRole(['bhw']), createIdempotencyMiddleware('residents', 'residents'), deleteResident);

module.exports = router;
