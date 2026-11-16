import api from './apiClient';

export async function listAuditLogs(params = {}) {
  const response = await api.get('/audit', { params });
  return response.data;
}

export async function getAuditSummary(params = {}) {
  const response = await api.get('/audit/summary', { params });
  return response.data;
}

export async function getAuditOptions(params = {}) {
  const response = await api.get('/audit/options', { params });
  return response.data;
}

export async function getAuditLog(id, params = {}) {
  const response = await api.get(`/audit/${id}`, { params });
  return response.data;
}

export async function exportAuditLogs(params = {}) {
  const response = await api.get('/audit/export', { params, responseType: 'blob' });
  return response;
}
