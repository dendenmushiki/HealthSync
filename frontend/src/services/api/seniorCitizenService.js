import api from './apiClient';
import { publishNotification } from '../notifications/notificationEvents';
import { getOfflineSnapshotRecords } from '../offline/offlineDataDownloadService';
import { calculateAge } from '../../utils/residentUtils';
import { getResidents, getResident } from './residentService';
import offlineQueue from '../offline/offlineQueueService';
import { healthCheck, isOffline } from '../offline/networkService';

function getManilaToday() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function searchEligibleResidentsOffline(search) {
  const query = String(search || '').trim().toLowerCase();
  if (query.length < 2) return { success: true, data: [], offline: true };

  const [residentResponse, seniorRecords, queuedItems] = await Promise.all([
    getResidents({ search, min_age: 60, page: 1, limit: 100 }),
    getOfflineSnapshotRecords('seniorCitizens'),
    offlineQueue.getQueueItems(),
  ]);
  const queuedSeniorRecords = queuedItems
    .filter((item) => item.table === 'senior_citizen_records' && item.localRecord && item.operation !== 'DELETE')
    .map((item) => item.localRecord);
  const registeredIds = new Set([...seniorRecords, ...queuedSeniorRecords].map((record) => String(record.resident_id)));
  const today = new Date(`${getManilaToday()}T00:00:00`);
  const items = (residentResponse.data?.items || []).filter((resident) => {
    const age = calculateAge(resident.birthdate, today);
    if (age === null || age < 60 ||
        registeredIds.has(String(resident.resident_id))) return false;
    const searchable = [
      resident.first_name, resident.middle_name, resident.last_name, resident.suffix,
      resident.household_no, resident.contact_no,
    ].filter(Boolean).join(' ').toLowerCase();
    return searchable.includes(query);
  }).sort((first, second) => (
    `${first.last_name || ''} ${first.first_name || ''}`.localeCompare(`${second.last_name || ''} ${second.first_name || ''}`)
  )).slice(0, 20);
  return { success: true, data: items, offline: true };
}

export async function listSeniorCitizens(params = {}) {
  if (isOffline()) {
    const [downloaded, queuedItems] = await Promise.all([
      getOfflineSnapshotRecords('seniorCitizens'),
      offlineQueue.getQueueItems(),
    ]);
    const queued = queuedItems
      .filter((item) => item.table === 'senior_citizen_records' && item.localRecord && item.operation !== 'DELETE')
      .map((item) => item.localRecord);
    let items = [...new Map([...downloaded, ...queued].map((record) => [String(record.senior_id || record.record_id || record.id), record])).values()];
    const today = new Date(`${getManilaToday()}T00:00:00`);
    const search = String(params.search || '').trim().toLowerCase();
    items = items.filter((record) => {
      const age = calculateAge(record.birthdate, today);
      const searchText = [
        record.first_name, record.middle_name, record.last_name, record.senior_citizen_id,
        record.contact_number, record.emergency_contact_number, record.health_conditions,
      ].filter(Boolean).join(' ').toLowerCase();
      if (search && !searchText.includes(search)) return false;
      if (params.condition && !String(record.health_conditions || '').toLowerCase().includes(String(params.condition).toLowerCase())) return false;
      if (params.sitio && record.sitio !== params.sitio) return false;
      if (params.ageGroup === '60-69' && (age < 60 || age > 69)) return false;
      if (params.ageGroup === '70-79' && (age < 70 || age > 79)) return false;
      if (params.ageGroup === '80+' && age < 80) return false;
      return true;
    });
    const sorters = {
      name_asc: (first, second) => `${first.last_name || ''} ${first.first_name || ''}`.localeCompare(`${second.last_name || ''} ${second.first_name || ''}`),
      name_desc: (first, second) => `${second.last_name || ''} ${second.first_name || ''}`.localeCompare(`${first.last_name || ''} ${first.first_name || ''}`),
      age_oldest: (first, second) => String(first.birthdate || '').localeCompare(String(second.birthdate || '')),
      age_youngest: (first, second) => String(second.birthdate || '').localeCompare(String(first.birthdate || '')),
      senior_id: (first, second) => Number(String(first.senior_citizen_id || '').split('-').pop()) - Number(String(second.senior_citizen_id || '').split('-').pop()),
      newest: (first, second) => String(second.date_registered || '').localeCompare(String(first.date_registered || '')),
    };
    items.sort(sorters[params.sort] || sorters.newest);
    const total = items.length;
    const page = Math.max(1, Number(params.page) || 1);
    const requestedSize = Number(params.pageSize || params.limit) || 10;
    const pageSize = [10, 25, 50].includes(requestedSize) ? requestedSize : 10;
    items = items.slice((page - 1) * pageSize, page * pageSize);
    return {
      success: true,
      data: { items, total, page, pageSize, limit: pageSize, counts: { total } },
      offline: true,
    };
  }
  const response = await api.get('/senior-citizens', { params });
  return response.data;
}

export async function getSeniorCitizen(id) {
  if (isOffline()) {
    const [records, queuedItems] = await Promise.all([
      getOfflineSnapshotRecords('seniorCitizens'),
      offlineQueue.getQueueItems(),
    ]);
    const queued = queuedItems
      .filter((item) => item.table === 'senior_citizen_records' && item.localRecord && item.operation !== 'DELETE')
      .map((item) => item.localRecord);
    const record = [...records, ...queued].find((item) => (
      [item.senior_id, item.record_id, item.id].some((value) => String(value) === String(id))
    ));
    if (!record) throw new Error('This senior citizen registration has not been downloaded to this device.');
    return { success: true, data: record, offline: true };
  }
  const response = await api.get(`/senior-citizens/${id}`);
  return response.data;
}

export async function createSeniorCitizen(payload) {
  if (typeof navigator !== 'undefined' && navigator.onLine) await healthCheck();
  const offline = isOffline();
  const residentResponse = await getResident(payload.resident_id);
  const resident = residentResponse.data;
  let requestPayload = offline ? { ...payload, senior_citizen_id: '' } : payload;
  if (offline) {
    const registrationDate = new Date(`${String(payload.date_registered).slice(0, 10)}T00:00:00`);
    if (calculateAge(resident.birthdate, registrationDate) < 60) {
      throw new Error('Residents must be 60 years or older on the registration date.');
    }
    const [downloaded, queuedItems] = await Promise.all([
      getOfflineSnapshotRecords('seniorCitizens'),
      offlineQueue.getQueueItems(),
    ]);
    const duplicate = [...downloaded, ...queuedItems
      .filter((item) => item.table === 'senior_citizen_records' && item.localRecord && item.operation !== 'DELETE')
      .map((item) => item.localRecord)]
      .some((record) => String(record.resident_id) === String(payload.resident_id));
    if (duplicate) throw new Error('This resident is already registered as a senior citizen.');
  }
  const offlineLocalRecord = {
    ...payload,
    senior_citizen_id: payload.senior_citizen_id || 'Pending server assignment',
    first_name: resident.first_name,
    middle_name: resident.middle_name,
    last_name: resident.last_name,
    suffix: resident.suffix,
    birthdate: resident.birthdate,
    sex: resident.sex,
    created_at: new Date().toISOString(),
    offline: true,
    sync_status: 'PENDING',
  };
  const response = await api.post('/senior-citizens', requestPayload, { offlineLocalRecord });
  if (response.data?.offline || response.data?.queued) {
    const localId = `offline:${response.data.offlineOperationId}`;
    return {
      ...response.data,
      data: { ...offlineLocalRecord, id: localId, record_id: localId },
      offline: true,
      queued: true,
    };
  }
  if (response.data?.success && !response.data?.queued) {
    publishNotification('seniorFollowUpAlerts', 'Senior registry updated', 'A senior citizen record was registered.');
  }
  return response.data;
}

export async function updateSeniorCitizen(id, payload) {
  const response = await api.put(`/senior-citizens/${id}`, payload, {
    offlineLocalRecord: { ...payload, id, senior_id: id, record_id: id },
  });
  if (response.data?.offline || response.data?.queued) {
    return {
      ...response.data,
      data: { ...payload, id, senior_id: id, record_id: id },
      offline: true,
      queued: true,
    };
  }
  return response.data;
}

export async function removeSeniorCitizen(id) {
  const response = await api.delete(`/senior-citizens/${id}`);
  return response.data;
}

export async function searchEligibleResidents(search) {
  if (isOffline()) {
    return searchEligibleResidentsOffline(search);
  }
  const response = await api.get('/senior-citizens/eligible-residents/search', { params: { search } });
  return response.data;
}

export async function getNextSeniorId() {
  if (isOffline()) {
    const [downloaded, queuedItems] = await Promise.all([
      getOfflineSnapshotRecords('seniorCitizens'),
      offlineQueue.getQueueItems(),
    ]);
    const queued = queuedItems
      .filter((item) => item.table === 'senior_citizen_records' && item.localRecord)
      .map((item) => item.localRecord);
    const maximum = [...downloaded, ...queued].reduce((max, record) => {
      const match = /^SC-(\d+)$/i.exec(String(record.senior_citizen_id || ''));
      return match ? Math.max(max, Number(match[1])) : max;
    }, 62);
    return { success: true, data: { senior_citizen_id: `SC-${String(maximum + 1).padStart(6, '0')}` }, offline: true };
  }
  const response = await api.get('/senior-citizens/next-id');
  return response.data;
}
