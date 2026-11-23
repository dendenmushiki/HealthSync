const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticate');
const authorizeRole = require('../middleware/authorize');
const {
  handleSync,
  listSyncActivity,
  getSyncActivityDetails,
} = require('../controllers/syncController');

// Protected sync endpoint - requires authentication
router.get('/activity/:id', authenticateToken, authorizeRole(['bhw']), getSyncActivityDetails);
router.get('/activity', authenticateToken, authorizeRole(['bhw']), listSyncActivity);
router.post('/', authenticateToken, authorizeRole(['bhw']), handleSync);

module.exports = router;
