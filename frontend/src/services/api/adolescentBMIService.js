import api from './apiClient';
import { publishNotification } from '../notifications/notificationEvents';
import { getResident } from './residentService';
import { calculateAdolescentBMIOffline } from '../nutrition/offlineNutritionCalculator';
import { getOfflineNutritionHistory, getOfflineNutritionRecordsForType } from './nutritionRecordsService';

const isOffline = () => typeof navigator !== 'undefined' && !navigator.onLine;
const RECORD_TYPE = 'Adolescent BMI';

function paginateOffline(items, params = {}) {
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.max(1, Number(params.limit || params.pageSize) || 25);
  const total = items.length;
  return { success: true, data: { items: items.slice((page - 1) * limit, page * limit), total, page, limit }, offline: true };
}

export async function listAdolescentBMI(params = {}) {
  if (isOffline()) {
    let items = await getOfflineNutritionRecordsForType(RECORD_TYPE);
    items = items.filter((record) => (
      (!params.resident_id || String(record.resident_id) === String(params.resident_id)) &&
      (!params.startDate || record.record_date >= params.startDate) &&
      (!params.endDate || record.record_date <= params.endDate)
    )).sort((first, second) => String(second.record_date || '').localeCompare(String(first.record_date || '')));
    return paginateOffline(items, params);
  }
  const response = await api.get('/adolescent-bmi', { params });
  return response.data;
}

export async function getAdolescentBMI(id) {
  if (isOffline()) {
    const records = await getOfflineNutritionRecordsForType(RECORD_TYPE);
    const record = records.find((item) => String(item.id) === String(id));
    if (!record) throw new Error('This adolescent BMI record has not been downloaded to this device.');
    return { success: true, data: record, offline: true };
  }
  const response = await api.get(`/adolescent-bmi/${id}`);
  return response.data;
}

export async function previewAdolescentBMI(payload) {
  if (isOffline()) {
    const residentResponse = await getResident(payload.resident_id);
    return {
      success: true,
      data: calculateAdolescentBMIOffline(residentResponse.data, payload),
      offline: true,
    };
  }
  const response = await api.post('/adolescent-bmi/preview', payload);
  return response.data;
}

export async function createAdolescentBMI(payload) {
  if (isOffline()) {
    const residentResponse = await getResident(payload.resident_id);
    const assessment = calculateAdolescentBMIOffline(residentResponse.data, payload);
    const resident = residentResponse.data;
    const localRecord = {
      ...payload,
      ...assessment,
      id: null,
      record_type: RECORD_TYPE,
      record_date: assessment.record_date || payload.record_date || payload.measurement_date || payload.date_recorded,
      resident_id: payload.resident_id,
      first_name: resident.first_name,
      middle_name: resident.middle_name,
      last_name: resident.last_name,
      suffix: resident.suffix,
      birthdate: resident.birthdate,
      sex: resident.sex,
      sitio: resident.sitio,
      status: assessment.bmi_for_age_category,
      sync_status: 'PENDING',
    };
    const response = await api.post('/adolescent-bmi', payload, { offlineLocalRecord: localRecord });
    return { ...response.data, data: { ...localRecord, id: `offline:${response.data.offlineOperationId}` }, offline: true };
  }
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
  if (isOffline()) {
    return { success: true, data: await getOfflineNutritionHistory(RECORD_TYPE, residentId, limit), offline: true };
  }
  const response = await api.get(`/adolescent-bmi/previous/${residentId}`, { params: { limit } });
  return response.data;
}
