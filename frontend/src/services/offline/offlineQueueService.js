import { v4 as uuidv4 } from 'uuid';
import idb from './indexedDbService';
import {
  deleteOfflineRecord,
  getOfflineRecord,
  getOfflineRecords,
  getUnlockedOfflineVaultRole,
  isOfflineVaultUnlocked,
  offlineValuesEqual,
  putOfflineRecord,
} from './offlineVaultService';
import { getOfflineSession } from './offlineSessionService';

const STALE_SYNC_MS = 2 * 60 * 1000;

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('hs_user') || 'null');
  } catch {
    throw new Error('The active account cannot be verified for offline synchronization.');
  }
}

function getStoredUserId() {
  const user = getStoredUser();
  if (user?.user_id === undefined || user.user_id === null || String(user.user_id).trim() === '') {
    throw new Error('The active account cannot be verified for offline synchronization.');
  }
  return String(user.user_id);
}

function requireOwner(userId) {
  const user = getStoredUser();
  const activeUserId = String(user?.user_id ?? '').trim();
  const ownerId = String(userId ?? '').trim();
  const grant = getOfflineSession();
  if (!ownerId || ownerId !== activeUserId || user?.must_change_password || !grant ||
      String(grant.userId) !== ownerId || grant.role !== user.role) {
    throw new Error('Offline queue access is restricted to the active account.');
  }
  if (!isOfflineVaultUnlocked(ownerId)) {
    throw new Error('Unlock offline access before using the synchronization queue.');
  }
  if (getUnlockedOfflineVaultRole(ownerId) !== user.role) {
    throw new Error('Offline synchronization is unavailable after an account role change.');
  }
  return ownerId;
}

export async function enqueueOperation({
  operation,
  module,
  table,
  payload,
  userId,
  photo = null,
  photoAction = null,
  request = null,
  localRecord = null,
}) {
  const ownerId = requireOwner(userId);
  const offlineOperationId = uuidv4();
  const localId = `offline:${offlineOperationId}`;
  const localRecordIdFields = {
    health_records: 'health_record_id',
    child_health_records: 'id',
    senior_citizen_records: 'record_id',
    operation_timbang: 'operation_timbang_id',
    adult_bmi_records: 'record_id',
    adolescent_bmi_records: 'record_id',
    patient_clinical_records: 'id',
    child_records: 'id',
    maternal_records: 'id',
    immunization_records: 'id',
  };
  const localRecordIdField = localRecordIdFields[table];
  const storedLocalRecord = localRecord
    ? {
      ...localRecord,
      id: table === 'residents' && operation === 'CREATE' ? localId : (localRecord.id || localId),
      ...(table === 'residents' && operation === 'CREATE'
        ? { resident_id: localId, offlineResidentId: localId }
        : {}),
      ...(localRecordIdField && !localRecord[localRecordIdField] ? { [localRecordIdField]: localId } : {}),
      ...(table === 'residents' ? { offline: true, sync_status: 'PENDING' } : {}),
    }
    : null;
  const item = {
    offlineOperationId,
    operation,
    module,
    table,
    payload,
    createdAt: new Date().toISOString(),
    userId: ownerId,
    photo,
    photoAction,
    request,
    localRecord: storedLocalRecord,
    status: 'PENDING',
    retryCount: 0,
  };
  await putOfflineRecord(ownerId, 'offlineQueue', item.offlineOperationId, item);
  return item;
}

export async function getQueueItems(userId = getStoredUserId()) {
  const ownerId = requireOwner(userId);
  const items = await getOfflineRecords(ownerId, 'offlineQueue');
  for (const item of items) {
    if (item.status !== 'SYNCING') continue;
    const startedAt = Date.parse(item.syncStartedAt || item.createdAt || '');
    if (!Number.isFinite(startedAt) || Date.now() - startedAt < STALE_SYNC_MS) continue;
    const recovered = await updateOperationStatus(item.offlineOperationId, {
      status: 'PENDING',
      syncStartedAt: null,
      lastError: 'A previous sync attempt was interrupted. The next attempt will reuse the same idempotency key.',
    }, ownerId);
    if (recovered) Object.assign(item, recovered);
  }
  return items.filter((item) => String(item.userId) === ownerId);
}

export async function getPendingOperations(userId) {
  const items = await getQueueItems(userId);
  return items.filter((item) => item.status === 'PENDING');
}

export async function getOperation(offlineOperationId, userId = getStoredUserId()) {
  const ownerId = requireOwner(userId);
  const item = await getOfflineRecord(ownerId, 'offlineQueue', offlineOperationId);
  if (!item || String(item.userId) !== ownerId) return null;
  return item;
}

export async function updateOperationStatus(offlineOperationId, updates, userId) {
  const ownerId = requireOwner(userId ?? getStoredUserId());
  const existing = await getOfflineRecord(ownerId, 'offlineQueue', offlineOperationId);
  if (!existing || String(existing.userId) !== ownerId) return null;
  const merged = {
    ...existing,
    ...updates,
    offlineOperationId: existing.offlineOperationId,
    userId: ownerId,
  };
  await putOfflineRecord(ownerId, 'offlineQueue', offlineOperationId, merged);
  return merged;
}

export async function deleteOperation(offlineOperationId, userId) {
  const ownerId = requireOwner(userId ?? getStoredUserId());
  const existing = await getOfflineRecord(ownerId, 'offlineQueue', offlineOperationId);
  if (!existing || String(existing.userId) !== ownerId) return false;
  await deleteOfflineRecord(ownerId, 'offlineQueue', offlineOperationId);
  return true;
}

export async function migrateLegacyQueue(userId) {
  const ownerId = requireOwner(userId);
  const legacyItems = await idb.getAllFromStore('offlineQueue');
  const ownedItems = legacyItems.filter((item) => item.userId !== null &&
    item.userId !== undefined && String(item.userId) === ownerId);
  let migrated = 0;
  let skipped = 0;

  for (const item of ownedItems) {
    const operationId = String(item.offlineOperationId || '').trim();
    if (!operationId) {
      skipped += 1;
      continue;
    }
    const existing = await getOfflineRecord(ownerId, 'offlineQueue', operationId);
    if (!existing) {
      await putOfflineRecord(ownerId, 'offlineQueue', operationId, { ...item, userId: ownerId });
    }
    const securedCopy = await getOfflineRecord(ownerId, 'offlineQueue', operationId);
    if (!securedCopy || !await offlineValuesEqual({ ...item, userId: ownerId }, securedCopy)) {
      throw new Error('A saved change could not be verified in encrypted storage.');
    }
    await idb.deleteFromStore('offlineQueue', item.offlineOperationId);
    migrated += 1;
  }
  return {
    migrated,
    skipped,
    unowned: legacyItems.filter((item) => item.userId === null || item.userId === undefined).length,
  };
}

const offlineQueueService = {
  deleteOperation,
  enqueueOperation,
  getOperation,
  getPendingOperations,
  getQueueItems,
  migrateLegacyQueue,
  updateOperationStatus,
};

export default offlineQueueService;
