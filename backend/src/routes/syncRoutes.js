const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticate');
const authorizeRole = require('../middleware/authorize');
const { handleSync } = require('../controllers/syncController');

// Protected sync endpoint - requires authentication
router.post('/', authenticateToken, authorizeRole(['bhw']), handleSync);

module.exports = router;
