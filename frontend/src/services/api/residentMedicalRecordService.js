import api from './apiClient';

const getPath = (residentId, recordType) => `/resident-medical-records/${residentId}/${recordType}`;

export async function listResidentMedicalRecords(residentId, recordType) {
  const response = await api.get(getPath(residentId, recordType));
  return response.data;
}

export async function getResidentMedicalRecord(residentId, recordType, recordId) {
  const response = await api.get(`${getPath(residentId, recordType)}/${recordId}`);
  return response.data;
}

export async function createResidentMedicalRecord(residentId, recordType, recordData) {
  const response = await api.post(getPath(residentId, recordType), { record_data: recordData });
  return response.data;
}

export async function updateResidentMedicalRecord(residentId, recordType, recordId, recordData) {
  const response = await api.put(`${getPath(residentId, recordType)}/${recordId}`, { record_data: recordData });
  return response.data;
}

export async function deleteResidentMedicalRecord(residentId, recordType, recordId) {
  const response = await api.delete(`${getPath(residentId, recordType)}/${recordId}`);
  return response.data;
}
