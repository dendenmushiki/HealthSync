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

export const SYNCABLE_QUEUE_TABLES = new Set([
  'residents',
  'health_records',
  'child_health_records',
  'operation_timbang',
  'adolescent_bmi_records',
  'adult_bmi_records',
  'senior_citizen_records',
  'patient_clinical_records',
  'child_records',
  'maternal_records',
  'immunization_records',
]);

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
  offlineOperationId: requestedOperationId,
}) {
  const ownerId = requireOwner(userId);
  const activeUser = getStoredUser();
  const queuedItems = await getOfflineRecords(ownerId, 'offlineQueue');
  const updateId = operation === 'UPDATE'
    ? String(localRecord?.id || localRecord?.resident_id || '').trim()
    : '';
  const coalescedCreate = updateId
    ? queuedItems.find((item) => item.table === table && item.operation === 'CREATE' &&
      item.status === 'PENDING' && !item.syncComplete &&
      [item.localRecord?.id, item.localRecord?.resident_id, item.localRecord?.offlineResidentId]
        .some((value) => String(value ?? '') === updateId))
    : null;
  const offlineOperationId = coalescedCreate?.offlineOperationId || requestedOperationId || uuidv4();
  const mergedPayload = coalescedCreate && payload && typeof payload === 'object'
    ? { ...coalescedCreate.payload, ...payload }
    : payload;
  const mergedRequest = coalescedCreate && request
    ? {
      ...coalescedCreate.request,
      data: { ...(coalescedCreate.request?.data || {}), ...(request.data || {}) },
    }
    : request;
  const mergedLocalRecord = coalescedCreate && localRecord
    ? { ...coalescedCreate.localRecord, ...localRecord, offline: true, sync_status: 'PENDING' }
    : localRecord;
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
  const storedLocalRecord = mergedLocalRecord
    ? {
      ...mergedLocalRecord,
      id: table === 'residents' && (operation === 'CREATE' || coalescedCreate) ? localId : (mergedLocalRecord.id || localId),
      ...(table === 'residents' && (operation === 'CREATE' || coalescedCreate)
        ? { resident_id: localId, offlineResidentId: localId }
        : {}),
      ...(localRecordIdField && !mergedLocalRecord[localRecordIdField] ? { [localRecordIdField]: localId } : {}),
      offline: true,
      sync_status: 'PENDING',
    }
    : null;
  const residentReference = mergedPayload?.resident_id || mergedRequest?.data?.resident_id ||
    mergedRequest?.url?.match(/resident-medical-records\/([^/]+)/)?.[1];
  const residentDependency = typeof residentReference === 'string' && residentReference.startsWith('offline:')
    ? queuedItems.find((queued) => queued.table === 'residents' &&
      String(queued.localRecord?.offlineResidentId || queued.localRecord?.resident_id) === residentReference)
    : null;
  const item = {
    offlineOperationId,
    clientId: coalescedCreate?.clientId || offlineOperationId,
    operation,
    module,
    table,
    payload: mergedPayload,
    createdAt: new Date().toISOString(),
    userId: ownerId,
    userRole: activeUser?.role || null,
    sequence: coalescedCreate?.sequence || Math.max(0, ...queuedItems.map((queued) => Number(queued.sequence) || 0)) + 1,
    dependsOn: residentDependency?.offlineOperationId || null,
    photo,
    photoAction,
    request: mergedRequest,
    localRecord: storedLocalRecord,
    savedOffline: true,
    status: 'PENDING',
    retryCount: 0,
  };
  if (coalescedCreate) {
    const updated = {
      ...coalescedCreate,
      ...item,
      offlineOperationId: coalescedCreate.offlineOperationId,
      clientId: coalescedCreate.clientId || coalescedCreate.offlineOperationId,
      operation: 'CREATE',
      status: 'PENDING',
      retryCount: Number(coalescedCreate.retryCount || 0),
    };
    await putOfflineRecord(ownerId, 'offlineQueue', updated.offlineOperationId, updated);
    return updated;
  }
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
      status: 'CONFLICT',
      syncStartedAt: null,
      lastErrorCode: 'IDEMPOTENCY_OUTCOME_UNKNOWN',
      lastError: 'A previous sync attempt was interrupted. HealthSync will verify the outcome using the same operation key before retrying.',
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

export async function putResidentIdMapping(localResidentId, serverResidentId, userId) {
  const ownerId = requireOwner(userId);
  const key = String(localResidentId || '').trim();
  if (!key || !serverResidentId) return null;
  await putOfflineRecord(ownerId, 'syncMappings', `resident:${key}`, {
    localResidentId: key,
    serverResidentId,
    mappedAt: new Date().toISOString(),
  });
  return { localResidentId: key, serverResidentId };
}

export async function getResidentIdMapping(localResidentId, userId) {
  const ownerId = requireOwner(userId);
  const key = String(localResidentId || '').trim();
  if (!key) return null;
  return await getOfflineRecord(ownerId, 'syncMappings', `resident:${key}`) || null;
}

export async function getDependentOperations(parentOperationId, userId) {
  const ownerId = requireOwner(userId);
  const items = await getOfflineRecords(ownerId, 'offlineQueue');
  return items.filter((item) =>
    String(item.dependsOn || '') === String(parentOperationId) ||
    (item.payload?.resident_id && String(item.payload.resident_id).startsWith(`offline:${parentOperationId}`))
  );
}

export async function rewriteResidentReferences(localResidentId, serverResidentId, userId) {
  const ownerId = requireOwner(userId);
  const items = await getOfflineRecords(ownerId, 'offlineQueue');
  const localId = String(localResidentId || '').trim();
  let rewritten = 0;
  for (const item of items) {
    if (!item.payload && !item.request && !item.localRecord) continue;
    const payloadChanged = item.payload?.resident_id === localId;
    const requestChanged = item.request?.data?.resident_id === localId ||
      String(item.request?.url || '').split('/').includes(localId);
    const localRecordChanged = item.localRecord?.resident_id === localId;
    if (!payloadChanged && !requestChanged && !localRecordChanged) continue;
    const payload = item.payload && typeof item.payload === 'object'
      ? (item.payload.resident_id === localId ? { ...item.payload, resident_id: serverResidentId } : item.payload)
      : item.payload;
    const requestData = item.request?.data && typeof item.request.data === 'object'
      ? (item.request.data.resident_id === localId
        ? { ...item.request.data, resident_id: serverResidentId }
        : item.request.data)
      : item.request?.data;
    const requestUrl = item.request?.url
      ? String(item.request.url).split('/').map((part) => part === localId ? String(serverResidentId) : part).join('/')
      : item.request?.url;
    const localRecord = item.localRecord && typeof item.localRecord === 'object'
      ? (item.localRecord.resident_id === localId
        ? { ...item.localRecord, resident_id: serverResidentId }
        : item.localRecord)
      : item.localRecord;
    await putOfflineRecord(ownerId, 'offlineQueue', item.offlineOperationId, {
      ...item,
      payload,
      request: item.request ? { ...item.request, url: requestUrl, data: requestData } : item.request,
      localRecord,
    });
    rewritten += 1;
  }
  return rewritten;
}

export async function cleanupSyncedOperations(userId, retentionMs = 7 * 24 * 60 * 60 * 1000) {
  const ownerId = requireOwner(userId);
  const items = await getOfflineRecords(ownerId, 'offlineQueue');
  const cutoff = Date.now() - retentionMs;
  let removed = 0;
  for (const item of items) {
    if (item.status !== 'SYNCED' || !item.syncedAt) continue;
    const syncedAt = Date.parse(item.syncedAt);
    if (!Number.isFinite(syncedAt) || syncedAt >= cutoff) continue;
    await deleteOfflineRecord(ownerId, 'offlineQueue', item.offlineOperationId);
    removed += 1;
  }
  return removed;
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
  cleanupSyncedOperations,
  deleteOperation,
  enqueueOperation,
  getDependentOperations,
  getOperation,
  getPendingOperations,
  getQueueItems,
  getResidentIdMapping,
  migrateLegacyQueue,
  putResidentIdMapping,
  rewriteResidentReferences,
  updateOperationStatus,
};

export default offlineQueueService;
