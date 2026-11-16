import api from './apiClient';
import { publishNotification } from '../notifications/notificationEvents';

export async function listOperationTimbang(params = {}) {
  const response = await api.get('/operation-timbang', { params });
  return response.data;
}

export async function getOperationTimbang(id) {
  const response = await api.get(`/operation-timbang/${id}`);
  return response.data;
}

export async function createOperationTimbang(payload) {
  const response = await api.post('/operation-timbang', payload);
  if (response.data?.success && !response.data?.queued) {
    publishNotification('nutritionAlerts', 'Nutrition assessment recorded', 'A new Operation Timbang record is available for review.');
  }
  return response.data;
}

export async function calculateOperationTimbang(payload) {
  const response = await api.post('/operation-timbang/calculate', payload);
  return response.data;
}

export async function updateOperationTimbang(id, payload) {
  const response = await api.put(`/operation-timbang/${id}`, payload);
  return response.data;
}

export async function deleteOperationTimbang(id) {
  const response = await api.delete(`/operation-timbang/${id}`);
  return response.data;
}

export async function getPreviousOperationTimbang(residentId, limit = 12) {
  const response = await api.get(`/operation-timbang/previous/${residentId}`, { params: { limit } });
  return response.data;
}
