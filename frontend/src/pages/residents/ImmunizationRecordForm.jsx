import React from 'react';
import MedicalRecordForm from './MedicalRecordForm';

const ImmunizationRecordForm = ({ resident }) => <MedicalRecordForm recordType="immunization" resident={resident} />;
export default ImmunizationRecordForm;
