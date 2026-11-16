import api from './apiClient';
import { publishNotification } from '../notifications/notificationEvents';

export async function listAdolescentBMI(params = {}) {
  const response = await api.get('/adolescent-bmi', { params });
  return response.data;
}

export async function getAdolescentBMI(id) {
  const response = await api.get(`/adolescent-bmi/${id}`);
  return response.data;
}

export async function previewAdolescentBMI(payload) {
  const response = await api.post('/adolescent-bmi/preview', payload);
  return response.data;
}

export async function createAdolescentBMI(payload) {
  const response = await api.post('/adolescent-bmi', payload);
  if (response.data?.success && !response.data?.queued) {
    publishNotification('nutritionAlerts', 'Nutrition assessment recorded', 'A new adolescent BMI record is available for review.');
  }
  return response.data;
}

export async function updateAdolescentBMI(id, payload) {
  const response = await api.put(`/adolescent-bmi/${id}`, payload);
  return response.data;
}

export async function deleteAdolescentBMI(id) {
  const response = await api.delete(`/adolescent-bmi/${id}`);
  return response.data;
}

export async function getPreviousAdolescentBMI(residentId, limit = 12) {
  const response = await api.get(`/adolescent-bmi/previous/${residentId}`, { params: { limit } });
  return response.data;
}
