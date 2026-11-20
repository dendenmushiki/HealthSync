import api from './apiClient';
import {
  getOfflineRecord,
  getOfflineRecords,
  getUnlockedOfflineVaultRole,
} from '../offline/offlineVaultService';
import { getOfflineSession } from '../offline/offlineSessionService';
import offlineQueue from '../offline/offlineQueueService';
import { isOffline } from '../offline/networkService';

const getPath = (residentId, recordType) => `/resident-medical-records/${residentId}/${recordType}`;

function getOfflineMedicalAccount() {
  let user;
  try {
    user = JSON.parse(localStorage.getItem('hs_user') || 'null');
  } catch {
    throw new Error('Offline medical records are unavailable for this account.');
  }
  const grant = getOfflineSession();
  if (!user?.user_id || user.role !== 'bhw' || user.must_change_password || !grant ||
      String(grant.userId) !== String(user.user_id) || grant.role !== user.role ||
      getUnlockedOfflineVaultRole(user.user_id) !== user.role) {
    throw new Error('Unlock authorized BHW offline access before viewing medical records.');
  }
  return user;
}

async function getOfflineMedicalRecords(residentId, recordType) {
  const user = getOfflineMedicalAccount();
  const snapshot = await getOfflineRecord(user.user_id, 'offlineMetadata', 'activeOfflineDataSnapshot');
  const collection = snapshot?.collections?.medicalRecords;
  if (!collection || snapshot.status !== 'complete') {
    throw new Error('Medical records have not been downloaded for offline use.');
  }
  const records = await getOfflineRecords(user.user_id, collection);
  const tableByType = {
    clinical: 'patient_clinical_records',
    child: 'child_records',
    maternal: 'maternal_records',
    immunization: 'immunization_records',
  };
  const queued = (await offlineQueue.getQueueItems(user.user_id))
    .filter((item) => item.table === tableByType[recordType] && item.localRecord && item.operation !== 'DELETE')
    .map((item) => item.localRecord);
  const merged = new Map([...records, ...queued].map((record) => [String(record.id), record]));
  return [...merged.values()].filter((record) => (
    String(record.resident_id) === String(residentId) && record.record_type === recordType
  ));
}

export async function listResidentMedicalRecords(residentId, recordType) {
  if (isOffline()) {
    return { success: true, data: await getOfflineMedicalRecords(residentId, recordType), offline: true };
  }
  const response = await api.get(getPath(residentId, recordType));
  return response.data;
}

export async function listAllResidentMedicalRecords(params = {}) {
  const response = await api.get('/resident-medical-records', { params });
  return response.data;
}

export async function getResidentMedicalRecord(residentId, recordType, recordId) {
  if (isOffline()) {
    const records = await getOfflineMedicalRecords(residentId, recordType);
    const record = records.find((item) => String(item.id) === String(recordId));
    if (!record) throw new Error('This medical record has not been downloaded to this device.');
    return { success: true, data: record, offline: true };
  }
  const response = await api.get(`${getPath(residentId, recordType)}/${recordId}`);
  return response.data;
}

export async function createResidentMedicalRecord(residentId, recordType, recordData) {
  const offlineLocalRecord = {
    resident_id: residentId,
    record_type: recordType,
    record_data: recordData,
    created_at: new Date().toISOString(),
    offline: true,
    sync_status: 'PENDING',
  };
  const response = await api.post(
    getPath(residentId, recordType),
    { record_data: recordData },
    { offlineLocalRecord }
  );
  return response.data;
}

export async function updateResidentMedicalRecord(residentId, recordType, recordId, recordData) {
  const response = await api.put(`${getPath(residentId, recordType)}/${recordId}`, { record_data: recordData });
  return response.data;
}

export async function deleteResidentMedicalRecord(residentId, recordType, recordId) {
  const response = await api.delete(`${getPath(residentId, recordType)}/${recordId}`);
  return response.data;
}
