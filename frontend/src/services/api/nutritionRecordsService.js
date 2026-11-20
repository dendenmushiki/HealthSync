import api from './apiClient';
import {
  getOfflineRecord,
  getOfflineRecords,
  getUnlockedOfflineVaultRole,
} from '../offline/offlineVaultService';
import { getOfflineSession } from '../offline/offlineSessionService';
import offlineQueue from '../offline/offlineQueueService';
import { isOffline } from '../offline/networkService';

const ACTIVE_NUTRITION_SNAPSHOT_KEY = 'activeNutritionSnapshot';
const ACTIVE_OFFLINE_DATA_SNAPSHOT_KEY = 'activeOfflineDataSnapshot';

function getOfflineNutritionAccount() {
  let user;
  try {
    user = JSON.parse(localStorage.getItem('hs_user') || 'null');
  } catch {
    throw new Error('Offline nutrition data is unavailable for this account.');
  }
  const grant = getOfflineSession();
  if (!user?.user_id || user.role !== 'bhw' || user.must_change_password || !grant ||
      String(grant.userId) !== String(user.user_id) || grant.role !== user.role ||
      getUnlockedOfflineVaultRole(user.user_id) !== user.role) {
    throw new Error('Unlock authorized BHW offline access before viewing nutrition records.');
  }
  return user;
}

async function loadOfflineNutritionRecords() {
  const user = getOfflineNutritionAccount();
  const [activeSnapshot, previousSnapshot] = await Promise.all([
    getOfflineRecord(user.user_id, 'offlineMetadata', ACTIVE_OFFLINE_DATA_SNAPSHOT_KEY),
    getOfflineRecord(user.user_id, 'offlineMetadata', ACTIVE_NUTRITION_SNAPSHOT_KEY),
  ]);
  const collection = activeSnapshot?.collections?.nutrition || previousSnapshot?.collection;
  const isComplete = activeSnapshot?.status === 'complete' || previousSnapshot?.status === 'complete';
  if (!collection || !isComplete) {
    throw new Error('Nutrition records have not been downloaded for offline use.');
  }
  const [records, queuedItems] = await Promise.all([
    getOfflineRecords(user.user_id, collection),
    offlineQueue.getQueueItems(user.user_id),
  ]);
  const merged = new Map();
  records.forEach((record) => merged.set(`${record.record_type}:${record.id}`, record));
  queuedItems.forEach((item) => {
    if (item.localRecord?.record_type && item.localRecord.id !== undefined) {
      merged.set(`${item.localRecord.record_type}:${item.localRecord.id}`, item.localRecord);
    }
  });
  return [...merged.values()];
}

export async function getOfflineNutritionRecordsForType(recordType) {
  const records = await loadOfflineNutritionRecords();
  return records.filter((record) => record.record_type === recordType);
}

export async function getOfflineNutritionHistory(recordType, residentId, limit = 12) {
  return (await getOfflineNutritionRecordsForType(recordType)).filter((record) => (
    String(record.resident_id) === String(residentId)
  )).sort((first, second) => (
    String(second.record_date || '').localeCompare(String(first.record_date || '')) ||
    String(second.created_at || '').localeCompare(String(first.created_at || ''))
  )).slice(0, Math.max(0, Number(limit) || 0));
}

const normalStatus = (status) => /^normal$/i.test(String(status || '').trim());
const needsAttention = (status) => !normalStatus(status);

function matchesFilters(record, params) {
  const search = String(params.search || '').trim().toLowerCase();
  const name = [record.first_name, record.middle_name, record.last_name, record.suffix].filter(Boolean).join(' ').toLowerCase();
  if (search && !`${name} ${record.record_type} ${record.status}`.toLowerCase().includes(search)) return false;
  if (params.type && params.type !== 'All' && record.record_type !== params.type) return false;
  if (params.status === 'normal' && !normalStatus(record.status)) return false;
  if (params.status === 'attention' && !needsAttention(record.status)) return false;
  if (params.from && record.record_date < params.from) return false;
  if (params.to && record.record_date > params.to) return false;
  if (params.sitio && String(record.sitio || '') !== params.sitio) return false;
  return true;
}

function sortNutritionRecords(records, params) {
  const direction = params.order === 'asc' ? 1 : -1;
  const sort = String(params.sort || 'date');
  return records.sort((a, b) => {
    let comparison = 0;
    if (sort === 'name') comparison = [a.first_name, a.last_name].join(' ').localeCompare([b.first_name, b.last_name].join(' '));
    else if (sort === 'status') comparison = Number(needsAttention(a.status)) - Number(needsAttention(b.status));
    else comparison = String(a.record_date || '').localeCompare(String(b.record_date || ''));
    if (comparison === 0 && sort !== 'date') comparison = String(a.record_date || '').localeCompare(String(b.record_date || ''));
    if (comparison === 0) comparison = String(a.created_at || '').localeCompare(String(b.created_at || ''));
    return comparison * direction;
  });
}

async function listOfflineNutritionRecords(params = {}) {
  const records = await loadOfflineNutritionRecords();
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const counts = {
    total: records.length,
    attention: records.filter((record) => needsAttention(record.status)).length,
    type: {
      operation: records.filter((record) => record.record_type === 'Operation Timbang').length,
      adolescent: records.filter((record) => record.record_type === 'Adolescent BMI').length,
      adult: records.filter((record) => record.record_type === 'Adult BMI').length,
    },
    month: records.filter((record) => String(record.record_date || '').startsWith(currentMonth)).length,
    childrenThisYear: new Set(records.filter((record) => record.record_type === 'Operation Timbang' &&
      String(record.record_date || '').startsWith(String(currentYear))).map((record) => record.resident_id)).size,
  };
  let filtered = records.filter((record) => matchesFilters(record, params));
  if (params.latestOnly === 'true') {
    const latest = new Map();
    filtered.forEach((record) => {
      const current = latest.get(record.resident_id);
      if (!current || record.record_date > current.record_date ||
          (record.record_date === current.record_date && String(record.created_at) > String(current.created_at))) {
        latest.set(record.resident_id, record);
      }
    });
    filtered = [...latest.values()];
  }
  sortNutritionRecords(filtered, params);
  const pageSize = [10, 25, 50].includes(Number(params.pageSize)) ? Number(params.pageSize) : 10;
  const page = Math.max(1, Number(params.page) || 1);
  const total = filtered.length;
  const items = filtered.slice((page - 1) * pageSize, page * pageSize);
  return {
    success: true,
    data: {
      items,
      total,
      page,
      pageSize,
      counts,
      sitos: [...new Set(items.map((record) => record.sitio).filter(Boolean))],
      offline: true,
    },
  };
}

export async function listNutritionRecords(params = {}) {
  if (isOffline()) return listOfflineNutritionRecords(params);
  const response = await api.get('/nutrition/records', { params });
  return response.data;
}
export async function getNutritionRecord(type, id) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const records = await loadOfflineNutritionRecords();
    const typeMap = { operation: 'Operation Timbang', adolescent: 'Adolescent BMI', adult: 'Adult BMI' };
    const recordType = typeMap[String(type)] || String(type);
    const record = records.find((item) => item.record_type === recordType && String(item.id) === String(id));
    if (!record) throw new Error('This nutrition record has not been downloaded to this device.');
    const history = records.filter((item) => item.resident_id === record.resident_id)
      .sort((a, b) => String(a.record_date).localeCompare(String(b.record_date)));
    const index = history.findIndex((item) => item.record_type === record.record_type && String(item.id) === String(record.id));
    return {
      success: true,
      data: {
        ...record,
        history,
        previousId: index > 0 ? { type: history[index - 1].record_type, id: history[index - 1].id } : null,
        nextId: index >= 0 && index < history.length - 1
          ? { type: history[index + 1].record_type, id: history[index + 1].id }
          : null,
        offline: true,
      },
    };
  }
  const response = await api.get(`/nutrition/records/${encodeURIComponent(type)}/${id}`);
  return response.data;
}
export async function exportNutritionRecords(params = {}) {
  const response = await api.get('/nutrition/records/export', { params, responseType: 'blob' });
  return response.data;
}
