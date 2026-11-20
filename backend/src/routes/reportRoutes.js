const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticate');
const authorizeRole = require('../middleware/authorize');
const createIdempotencyMiddleware = require('../middleware/idempotency');
const {
  getMonthlyReport,
  getFhsisReport,
  getFhsisRemarks,
  saveFhsisRemark,
  getFhsisDrilldown,
  getNutritionReport,
  getOperationTimbangReport,
  getAdolescentBMIReport,
  getAdultBMIReport,
} = require('../controllers/reportController');

router.get('/monthly', authenticateToken, authorizeRole(['bhw', 'official']), getMonthlyReport);
router.get('/fhsis', authenticateToken, authorizeRole(['bhw', 'official']), getFhsisReport);
router.get('/fhsis/remarks', authenticateToken, authorizeRole(['bhw', 'official']), getFhsisRemarks);
router.put(
  '/fhsis/remarks',
  authenticateToken,
  authorizeRole(['bhw', 'official']),
  createIdempotencyMiddleware('report_remarks', 'report_remarks', { atomic: true }),
  saveFhsisRemark
);
router.get('/fhsis/drilldown', authenticateToken, authorizeRole(['bhw', 'official']), getFhsisDrilldown);
router.get('/nutrition', authenticateToken, authorizeRole(['bhw', 'official']), getNutritionReport);
router.get('/operation-timbang', authenticateToken, authorizeRole(['bhw', 'official']), getOperationTimbangReport);
router.get('/adolescent-bmi', authenticateToken, authorizeRole(['bhw', 'official']), getAdolescentBMIReport);
router.get('/adult-bmi', authenticateToken, authorizeRole(['bhw', 'official']), getAdultBMIReport);

module.exports = router;
