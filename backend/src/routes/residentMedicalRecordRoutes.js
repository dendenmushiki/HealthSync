const express = require('express');
const authenticateToken = require('../middleware/authenticate');
const authorizeRole = require('../middleware/authorize');
const {
  listResidentMedicalRecords,
  getResidentMedicalRecord,
  createResidentMedicalRecord,
  updateResidentMedicalRecord,
  deleteResidentMedicalRecord
} = require('../controllers/residentMedicalRecordController');

const router = express.Router();
router.use(authenticateToken, authorizeRole(['bhw']));
router.get('/:residentId/:recordType', listResidentMedicalRecords);
router.get('/:residentId/:recordType/:recordId', getResidentMedicalRecord);
router.post('/:residentId/:recordType', createResidentMedicalRecord);
router.put('/:residentId/:recordType/:recordId', updateResidentMedicalRecord);
router.delete('/:residentId/:recordType/:recordId', deleteResidentMedicalRecord);

module.exports = router;
