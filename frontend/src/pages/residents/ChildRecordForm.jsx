import React from 'react';
import MedicalRecordForm from './MedicalRecordForm';

const ChildRecordForm = ({ resident }) => <MedicalRecordForm recordType="child" resident={resident} />;
export default ChildRecordForm;
