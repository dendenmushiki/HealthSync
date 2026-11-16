import api from './apiClient';
import { publishNotification } from '../notifications/notificationEvents';

export async function listSeniorCitizens(params = {}) {
  const response = await api.get('/senior-citizens', { params });
  return response.data;
}

export async function getSeniorCitizen(id) {
  const response = await api.get(`/senior-citizens/${id}`);
  return response.data;
}

export async function createSeniorCitizen(payload) {
  const response = await api.post('/senior-citizens', payload);
  if (response.data?.success && !response.data?.queued) {
    publishNotification('seniorFollowUpAlerts', 'Senior registry updated', 'A senior citizen record was registered.');
  }
  return response.data;
}

export async function updateSeniorCitizen(id, payload) {
  const response = await api.put(`/senior-citizens/${id}`, payload);
  return response.data;
}

export async function removeSeniorCitizen(id) {
  const response = await api.delete(`/senior-citizens/${id}`);
  return response.data;
}

export async function searchEligibleResidents(search) {
  const response = await api.get('/senior-citizens/eligible-residents/search', { params: { search } });
  return response.data;
}

export async function getNextSeniorId() {
  const response = await api.get('/senior-citizens/next-id');
  return response.data;
}
