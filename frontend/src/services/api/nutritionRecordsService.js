import api from './apiClient';

export async function listNutritionRecords(params = {}) {
  const response = await api.get('/nutrition/records', { params });
  return response.data;
}
export async function getNutritionRecord(type, id) {
  const response = await api.get(`/nutrition/records/${encodeURIComponent(type)}/${id}`);
  return response.data;
}
export async function exportNutritionRecords(params = {}) {
  const response = await api.get('/nutrition/records/export', { params, responseType: 'blob' });
  return response.data;
}
