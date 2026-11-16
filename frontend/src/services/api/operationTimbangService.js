import api from './apiClient';
import { publishNotification } from '../notifications/notificationEvents';
import { getResident } from './residentService';
import { calculateOperationTimbangOffline } from '../nutrition/offlineNutritionCalculator';
import { getOfflineNutritionHistory, getOfflineNutritionRecordsForType } from './nutritionRecordsService';

const isOffline = () => typeof navigator !== 'undefined' && !navigator.onLine;
const RECORD_TYPE = 'Operation Timbang';
const STATUS_PRIORITY = {
  'Severely stunted': 7,
  'Severely wasted/SAM': 7,
  'Severely underweight': 7,
  'Moderately stunted': 6,
  'Moderately wasted/MAM': 6,
  'Moderately underweight': 6,
  Underweight: 5,
  Wasted: 5,
  Stunted: 5,
  Tall: 4,
  Overweight: 3,
  Obese: 3,
  Normal: 0,
};

function paginateOffline(items, params = {}) {
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.max(1, Number(params.limit || params.pageSize) || 25);
  const total = items.length;
  return { success: true, data: { items: items.slice((page - 1) * limit, page * limit), total, page, limit }, offline: true };
}

export async function listOperationTimbang(params = {}) {
  if (isOffline()) {
    let items = await getOfflineNutritionRecordsForType(RECORD_TYPE);
    items = items.filter((record) => (
      (!params.resident_id || String(record.resident_id) === String(params.resident_id)) &&
      (!params.startDate || record.record_date >= params.startDate) &&
      (!params.endDate || record.record_date <= params.endDate)
    )).sort((first, second) => String(second.record_date || '').localeCompare(String(first.record_date || '')));
    return paginateOffline(items, params);
  }
  const response = await api.get('/operation-timbang', { params });
  return response.data;
}

export async function getOperationTimbang(id) {
  if (isOffline()) {
    const records = await getOfflineNutritionRecordsForType(RECORD_TYPE);
    const record = records.find((item) => String(item.id) === String(id));
    if (!record) throw new Error('This Operation Timbang record has not been downloaded to this device.');
    return { success: true, data: record, offline: true };
  }
  const response = await api.get(`/operation-timbang/${id}`);
  return response.data;
}

export async function createOperationTimbang(payload) {
  if (isOffline()) {
    const residentResponse = await getResident(payload.resident_id);
    const assessment = calculateOperationTimbangOffline({
      ...payload,
      birthdate: residentResponse.data?.birthdate,
      sex: residentResponse.data?.sex,
    });
    const resident = residentResponse.data;
    const localRecord = {
      ...payload,
      ...assessment,
      id: null,
      record_type: RECORD_TYPE,
      record_date: assessment.record_date || assessment.date_recorded ||
        payload.record_date || payload.date_recorded || payload.measurement_date,
      height_cm: payload.measurement_cm,
      resident_id: payload.resident_id,
      first_name: resident.first_name,
      middle_name: resident.middle_name,
      last_name: resident.last_name,
      suffix: resident.suffix,
      birthdate: resident.birthdate,
      sex: resident.sex,
      sitio: resident.sitio,
      status: [assessment.wfa_status, assessment.hfa_status, assessment.wflh_status]
        .sort((first, second) => (STATUS_PRIORITY[second] || 1) - (STATUS_PRIORITY[first] || 1))[0],
      sync_status: 'PENDING',
    };
    const response = await api.post('/operation-timbang', payload, { offlineLocalRecord: localRecord });
    return { ...response.data, data: { ...localRecord, id: `offline:${response.data.offlineOperationId}` }, offline: true };
  }
  const response = await api.post('/operation-timbang', payload);
  if (response.data?.success && !response.data?.queued) {
    publishNotification('nutritionAlerts', 'Nutrition assessment recorded', 'A new Operation Timbang record is available for review.');
  }
  return response.data;
}

export async function calculateOperationTimbang(payload) {
  if (isOffline()) {
    const residentResponse = await getResident(payload.resident_id);
    const data = calculateOperationTimbangOffline({
      ...payload,
      birthdate: residentResponse.data?.birthdate,
      sex: residentResponse.data?.sex,
    });
    return { success: true, data, offline: true };
  }
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
  if (isOffline()) {
    return { success: true, data: await getOfflineNutritionHistory(RECORD_TYPE, residentId, limit), offline: true };
  }
  const response = await api.get(`/operation-timbang/previous/${residentId}`, { params: { limit } });
  return response.data;
}
