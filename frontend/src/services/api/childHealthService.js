import api from './apiClient';

export async function listChildHealthRecords(params = {}) {
  const response = await api.get('/child-health', { params });
  return response.data;
}

export async function getChildHealthRecord(id) {
  const response = await api.get(`/child-health/${id}`);
  return response.data;
}

export async function createChildHealthRecord(payload) {
  const response = await api.post('/child-health', payload);
  return response.data;
}

export async function updateChildHealthRecord(id, payload) {
  const response = await api.put(`/child-health/${id}`, payload);
  return response.data;
}

export async function deleteChildHealthRecord(id) {
  const response = await api.delete(`/child-health/${id}`);
  return response.data;
}
