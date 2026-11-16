const express = require('express');
const authenticateToken = require('../middleware/authenticate');
const authorizeRole = require('../middleware/authorize');
const createIdempotencyMiddleware = require('../middleware/idempotency');
const {
  listAllResidentMedicalRecords,
  listResidentMedicalRecords,
  getResidentMedicalRecord,
  createResidentMedicalRecord,
  updateResidentMedicalRecord,
  deleteResidentMedicalRecord
} = require('../controllers/residentMedicalRecordController');

const router = express.Router();
router.use(authenticateToken, authorizeRole(['bhw']));
router.get('/', listAllResidentMedicalRecords);
router.get('/:residentId/:recordType', listResidentMedicalRecords);
router.get('/:residentId/:recordType/:recordId', getResidentMedicalRecord);
const tableByRecordType = {
  clinical: 'patient_clinical_records',
  child: 'child_records',
  maternal: 'maternal_records',
  immunization: 'immunization_records',
};
const medicalRecordIdempotency = createIdempotencyMiddleware(
  (req) => `${req.params.recordType}_records`,
  (req) => tableByRecordType[req.params.recordType]
);
router.post('/:residentId/:recordType', medicalRecordIdempotency, createResidentMedicalRecord);
router.put('/:residentId/:recordType/:recordId', medicalRecordIdempotency, updateResidentMedicalRecord);
router.delete('/:residentId/:recordType/:recordId', medicalRecordIdempotency, deleteResidentMedicalRecord);

module.exports = router;
