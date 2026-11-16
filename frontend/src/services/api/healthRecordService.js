import api from './apiClient';

export async function listHealthRecords(params = {}) {
  const response = await api.get('/health-records', { params });
  return response.data;
}

export async function listAllHealthRecords(params = {}) {
  const response = await api.get('/health-records/overview', { params });
  return response.data;
}

export async function getHealthRecordDetails(sourceTable, recordId) {
  const response = await api.get(`/health-records/details/${encodeURIComponent(sourceTable)}/${recordId}`);
  return response.data;
}

export async function getHealthRecord(id) {
  const response = await api.get(`/health-records/${id}`);
  return response.data;
}

export async function createHealthRecord(payload) {
  const response = await api.post('/health-records', payload);
  return response.data;
}

export async function updateHealthRecord(id, payload) {
  const response = await api.put(`/health-records/${id}`, payload);
  return response.data;
}

export async function deleteHealthRecord(id) {
  const response = await api.delete(`/health-records/${id}`);
  return response.data;
}
