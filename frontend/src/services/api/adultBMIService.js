import api from './apiClient';
import { publishNotification } from '../notifications/notificationEvents';

export async function listAdultBMI(params = {}) {
  const response = await api.get('/adult-bmi', { params });
  return response.data;
}

export async function getAdultBMI(id) {
  const response = await api.get(`/adult-bmi/${id}`);
  return response.data;
}

export async function createAdultBMI(payload) {
  const response = await api.post('/adult-bmi', payload);
  if (response.data?.success && !response.data?.queued) {
    publishNotification('nutritionAlerts', 'Nutrition assessment recorded', 'A new adult BMI record is available for review.');
  }
  return response.data;
}

export async function updateAdultBMI(id, payload) {
  const response = await api.put(`/adult-bmi/${id}`, payload);
  return response.data;
}

export async function deleteAdultBMI(id) {
  const response = await api.delete(`/adult-bmi/${id}`);
  return response.data;
}

export async function previewAdultBMI(payload) {
  const response = await api.post('/adult-bmi/preview', payload);
  return response.data;
}

export async function getPreviousAdultBMI(residentId, limit = 5) {
  const response = await api.get(`/adult-bmi/previous/${residentId}`, { params: { limit } });
  return response.data;
}
