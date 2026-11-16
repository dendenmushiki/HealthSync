import api from './apiClient';
import { getOfflineSnapshotRecords } from '../offline/offlineDataDownloadService';
import { getQueueItems } from '../offline/offlineQueueService';

const isOffline = () => typeof navigator !== 'undefined' && !navigator.onLine;

async function getOfflineChildRecords() {
  const [records, queuedItems] = await Promise.all([
    getOfflineSnapshotRecords('legacyChild'),
    getQueueItems(),
  ]);
  const merged = new Map(records.map((record) => [String(record.id), record]));
  queuedItems.forEach((item) => {
    if (item.table === 'child_health_records' && item.localRecord && item.operation !== 'DELETE') {
      merged.set(String(item.localRecord.id), item.localRecord);
    }
  });
  return [...merged.values()];
}

export async function listChildHealthRecords(params = {}) {
  if (isOffline()) {
    let items = (await getOfflineChildRecords()).filter((record) => (
      (!params.resident_id || String(record.resident_id) === String(params.resident_id)) &&
      (!params.startDate || String(record.record_date || '') >= params.startDate) &&
      (!params.endDate || String(record.record_date || '') <= params.endDate)
    )).sort((first, second) => String(second.record_date || '').localeCompare(String(first.record_date || '')));
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.max(1, Number(params.limit) || 25);
    const total = items.length;
    items = items.slice((page - 1) * limit, page * limit);
    return { success: true, data: { items, total, page, limit }, offline: true };
  }
  const response = await api.get('/child-health', { params });
  return response.data;
}

export async function getChildHealthRecord(id) {
  if (isOffline()) {
    const records = await getOfflineChildRecords();
    const record = records.find((item) => String(item.id) === String(id));
    if (!record) throw new Error('This child health record has not been downloaded to this device.');
    return { success: true, data: record, offline: true };
  }
  const response = await api.get(`/child-health/${id}`);
  return response.data;
}

export async function createChildHealthRecord(payload) {
  const offlineLocalRecord = isOffline()
    ? {
      ...payload,
      record_date: payload.record_date || payload.visit_date,
      created_at: new Date().toISOString(),
      offline: true,
      sync_status: 'PENDING',
    }
    : undefined;
  const response = await api.post('/child-health', payload, { offlineLocalRecord });
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
