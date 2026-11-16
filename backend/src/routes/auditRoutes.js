const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticate');
const authorizeRole = require('../middleware/authorize');
const {
  listAuditLogs,
  getAuditLog,
  getAuditStats,
  getAuditOptions,
  getAuditSummary,
  exportAuditLogs,
} = require('../controllers/auditController');

router.get('/options', authenticateToken, authorizeRole(['admin']), getAuditOptions);
router.get('/summary', authenticateToken, authorizeRole(['admin']), getAuditSummary);
router.get('/export', authenticateToken, authorizeRole(['admin']), exportAuditLogs);
router.get('/', authenticateToken, authorizeRole(['admin']), listAuditLogs);
router.get('/stats', authenticateToken, authorizeRole(['admin']), getAuditStats);
router.get('/:id', authenticateToken, authorizeRole(['admin']), getAuditLog);

module.exports = router;
