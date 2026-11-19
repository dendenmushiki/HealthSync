const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticate');
const authorizeRole = require('../middleware/authorize');
const { handleSync, listSyncActivity } = require('../controllers/syncController');

// Protected sync endpoint - requires authentication
router.get('/activity', authenticateToken, authorizeRole(['bhw']), listSyncActivity);
router.post('/', authenticateToken, authorizeRole(['bhw']), handleSync);

module.exports = router;
