import offlineQueue, { SYNCABLE_QUEUE_TABLES } from './offlineQueueService';
import api from '../api/apiClient';

const runningPromises = new Map();
const MAX_UNKNOWN_CREATE_RETRIES = 3;

const SERVER_RECORD_ID_FIELDS = {
  residents: ['resident_id', 'id'],
  health_records: ['health_record_id', 'record_id', 'id'],
  child_health_records: ['id'],
  operation_timbang: ['timbang_id', 'operation_timbang_id', 'id'],
  adolescent_bmi_records: ['adolescent_bmi_id', 'record_id', 'id'],
  adult_bmi_records: ['bmi_id', 'adult_bmi_id', 'record_id', 'id'],
  senior_citizen_records: ['senior_id', 'record_id', 'id'],
  patient_clinical_records: ['id'],
  child_records: ['id'],
  maternal_records: ['id'],
  immunization_records: ['id'],
};

function getServerRecordId(responseData, table) {
  const data = responseData?.data;
  const record = data?.record || data;
  const fields = ['serverRecordId', ...(SERVER_RECORD_ID_FIELDS[table] || ['id']), 'server_record_id'];
  for (const field of fields) {
    if (data?.[field] !== undefined && data[field] !== null) return data[field];
    if (record?.[field] !== undefined && record[field] !== null) return record[field];
  }
  return null;
}

function getServerRecord(responseData) {
  const data = responseData?.data;
  return data?.record || data || null;
}

function getActiveSession() {
  let user;
  try {
    user = JSON.parse(localStorage.getItem('hs_user') || 'null');
  } catch {
    user = null;
  }
  const token = localStorage.getItem('hs_token');
  if (!user?.user_id || !token) {
    throw new Error('Sign in online with the account that owns these changes before synchronizing.');
  }
  return { userId: String(user.user_id), token };
}

function assertActiveSession(session) {
  let user;
  try {
    user = JSON.parse(localStorage.getItem('hs_user') || 'null');
  } catch {
    user = null;
  }
  if (String(user?.user_id ?? '') !== session.userId || localStorage.getItem('hs_token') !== session.token) {
    const error = new Error('The active account changed during synchronization. The queued change was preserved.');
    error.code = 'SYNC_ACCOUNT_CHANGED';
    throw error;
  }
}

async function resolveResidentDependency(item) {
  const residentId = item.payload?.resident_id || item.request?.data?.resident_id;
  if (typeof residentId !== 'string' || !residentId.startsWith('offline:')) return { item };
  const mapping = await offlineQueue.getResidentIdMapping?.(residentId);
  if (mapping?.serverResidentId) {
    const serverResidentId = mapping.serverResidentId;
    const nextRequest = item.request ? {
      ...item.request,
      url: String(item.request.url || '').split('/').map((part) => part === residentId ? String(serverResidentId) : part).join('/'),
      data: item.request.data && typeof item.request.data === 'object'
        ? { ...item.request.data, resident_id: serverResidentId }
        : item.request.data,
    } : null;
    const updatedItem = await offlineQueue.updateOperationStatus(item.offlineOperationId, {
      payload: item.payload && typeof item.payload === 'object'
        ? { ...item.payload, resident_id: serverResidentId }
        : item.payload,
      request: nextRequest,
      localRecord: item.localRecord
        ? { ...item.localRecord, resident_id: serverResidentId }
        : item.localRecord,
    });
    return { item: updatedItem || item };
  }
  const queueItems = await offlineQueue.getQueueItems();
  const residentOperation = queueItems.find((queued) => (
    queued.table === 'residents' &&
    (String(queued.localRecord?.offlineResidentId || queued.localRecord?.resident_id) === residentId ||
      residentId === `offline:${queued.offlineOperationId}`)
  ));
  if (residentOperation?.status !== 'SYNCED' || !residentOperation.serverRecordId) {
    return { blocked: true, parent: residentOperation || null };
  }
  const serverResidentId = residentOperation.serverRecordId;
  const serverResidentIdPath = String(serverResidentId);
  const nextRequest = item.request ? {
    ...item.request,
    url: String(item.request.url || '').split('/').map((part) => part === residentId ? serverResidentIdPath : part).join('/'),
    data: item.request.data && typeof item.request.data === 'object'
      ? { ...item.request.data, resident_id: serverResidentId }
      : item.request.data,
  } : null;
  const updatedItem = await offlineQueue.updateOperationStatus(item.offlineOperationId, {
    payload: item.payload && typeof item.payload === 'object'
      ? { ...item.payload, resident_id: serverResidentId }
      : item.payload,
    request: nextRequest,
    localRecord: item.localRecord
      ? { ...item.localRecord, resident_id: serverResidentId }
      : item.localRecord,
  });
  return { item: updatedItem || item };
}

function isNetworkFailure(error) {
  if (error?.response) return false;
  return (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'].includes(error?.code) ||
    error?.message === 'Network Error';
}

function acquireFallbackLease(scope) {
  const key = `healthsync_sync_lease_${scope}`;
  const owner = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const now = Date.now();
  try {
    const current = JSON.parse(localStorage.getItem(key) || 'null');
    if (current?.expiresAt > now) return null;
    localStorage.setItem(key, JSON.stringify({ owner, expiresAt: now + 120000 }));
    if (JSON.parse(localStorage.getItem(key) || 'null')?.owner !== owner) return null;
    const renew = window.setInterval(() => {
      try {
        const lease = JSON.parse(localStorage.getItem(key) || 'null');
        if (lease?.owner === owner) {
          localStorage.setItem(key, JSON.stringify({ owner, expiresAt: Date.now() + 120000 }));
        }
      } catch {
        // The current run will still release its lease in finally.
      }
    }, 30000);
    const releaseOnPageHide = () => {
      try {
        if (JSON.parse(localStorage.getItem(key) || 'null')?.owner === owner) localStorage.removeItem(key);
      } catch {
        // The lease expires if the browser is already tearing down storage.
      }
    };
    window.addEventListener('pagehide', releaseOnPageHide, { once: true });
    return {
      release() {
        window.clearInterval(renew);
        window.removeEventListener('pagehide', releaseOnPageHide);
        try {
          if (JSON.parse(localStorage.getItem(key) || 'null')?.owner === owner) localStorage.removeItem(key);
        } catch {
          // Expiry allows another tab to recover the lease.
        }
      },
    };
  } catch {
    return null;
  }
}

export function runSync({ manual = false } = {}) {
  let ownerId = 'unauthenticated';
  try {
    ownerId = getActiveSession().userId;
  } catch {
    // syncWork reports the authentication error through its normal path.
  }
  const deviceId = localStorage.getItem('hs_offline_device_id') || 'unknown-device';
  const scope = `${ownerId}:${deviceId}`;
  if (runningPromises.has(scope)) return runningPromises.get(scope);
  const syncWork = async () => {
  const result = { synced: 0, failed: 0, blocked: 0, authRequired: false };
  window.dispatchEvent(new CustomEvent('healthsync:sync-start'));
  try {
    const session = getActiveSession();
    const queued = await offlineQueue.getQueueItems(session.userId);
    const retryableConflicts = queued.filter((item) => (
      item.status === 'CONFLICT' &&
      Boolean(item.request || item.payload) &&
      SYNCABLE_QUEUE_TABLES.has(item.table) &&
      (!item.lastErrorCode || item.lastErrorCode === 'IDEMPOTENCY_OUTCOME_UNKNOWN') &&
      Number(item.retryCount || 0) < MAX_UNKNOWN_CREATE_RETRIES
    ));
    const pending = [
      ...(await offlineQueue.getPendingOperations(session.userId)),
      ...retryableConflicts,
      ...queued.filter((item) => item.status === 'BLOCKED'),
    ].filter((item) => SYNCABLE_QUEUE_TABLES.has(item.table))
      .filter((item) => manual || !item.nextRetryAt || Date.parse(item.nextRetryAt) <= Date.now())
      .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0) ||
        new Date(a.createdAt) - new Date(b.createdAt) ||
        String(a.offlineOperationId).localeCompare(String(b.offlineOperationId)));
    if (pending.some((item) => String(item.userId) !== session.userId)) {
      throw new Error('A queued change is not owned by the active account and was not synchronized.');
    }
    for (let item of pending) {
      try {
        assertActiveSession(session);
        if (item.savedOffline !== true) {
          item = await offlineQueue.updateOperationStatus(item.offlineOperationId, {
            savedOffline: true,
          }, session.userId) || item;
        }
        const dependency = await resolveResidentDependency(item);
        if (dependency.blocked) {
          const parent = dependency.parent;
          const parentReason = parent?.status === 'FAILED'
            ? `Resident registration needs attention${parent.lastErrorCode ? ` (${parent.lastErrorCode})` : ''}.`
            : 'Waiting for resident registration to sync.';
          await offlineQueue.updateOperationStatus(item.offlineOperationId, {
            status: 'BLOCKED',
            lastError: parentReason,
            dependencyOperationId: parent?.offlineOperationId || null,
            syncStartedAt: null,
          }, session.userId);
          result.blocked += 1;
          window.dispatchEvent(new CustomEvent('healthsync:queue-changed'));
          continue;
        }
        item = dependency.item;
        assertActiveSession(session);
        const attemptAt = new Date().toISOString();
        await offlineQueue.updateOperationStatus(item.offlineOperationId, {
          status: 'SYNCING',
          syncStartedAt: attemptAt,
          lastAttemptAt: new Date().toISOString(),
          attempts: Number(item.attempts || item.retryCount || 0) + 1,
          lastError: null,
          lastErrorCode: null,
        }, session.userId);
        window.dispatchEvent(new CustomEvent('healthsync:queue-changed'));
        let syncResponse = item.serverResponse;
        let serverRecordId = item.serverRecordId;
        if (!item.syncComplete) {
          assertActiveSession(session);
          const response = item.request
            ? await api.request({
              ...item.request,
              headers: {
                ...(item.request.headers || {}),
                Authorization: `Bearer ${session.token}`,
                'X-Idempotency-Key': item.offlineOperationId,
                'X-HealthSync-Offline-Sync': 'true',
                'X-HealthSync-Client-Created-At': item.createdAt || new Date().toISOString(),
              },
            })
            : await api.post('/sync', { operation: item.operation, module: item.module, table: item.table, payload: item.payload }, {
              headers: {
                Authorization: `Bearer ${session.token}`,
                'X-Idempotency-Key': item.offlineOperationId,
                'X-HealthSync-Offline-Sync': 'true',
                'X-HealthSync-Client-Created-At': item.createdAt || new Date().toISOString(),
              },
            });
          assertActiveSession(session);
          if (!response?.data?.success) throw new Error(response?.data?.message || 'Server did not accept this change.');
          syncResponse = response.data;
          serverRecordId = getServerRecordId(response.data, item.table);
          await offlineQueue.updateOperationStatus(item.offlineOperationId, {
            syncComplete: true,
            serverResponse: syncResponse,
            serverRecordId,
          }, session.userId);
        }

        assertActiveSession(session);
        if (item.table === 'residents' && (item.photo || item.photoAction)) {
          const residentId = serverRecordId || item.payload.resident_id;
          if (!residentId) throw new Error('Resident was synced, but its photo could not be linked.');
          if (item.photo) {
            const formData = new FormData();
            formData.append('photo', item.photo);
            await api.post(`/residents/${residentId}/photo`, formData, {
              headers: { Authorization: `Bearer ${session.token}` },
            });
          } else if (item.photoAction === 'DELETE') {
            await api.delete(`/residents/${residentId}/photo`, {
              headers: { Authorization: `Bearer ${session.token}` },
            });
          }
          assertActiveSession(session);
        }

        const updates = {
          status: 'SYNCED',
          serverResponse: syncResponse,
          serverRecordId,
          syncedAt: new Date().toISOString(),
          lastError: null,
          lastErrorCode: null,
          syncStartedAt: null,
        };
        if (item.localRecord) {
          const serverRecord = getServerRecord(syncResponse);
          updates.localRecord = {
            ...item.localRecord,
            ...(serverRecord && typeof serverRecord === 'object' ? serverRecord : {}),
            ...(serverRecordId ? {
              id: serverRecordId,
              ...(item.table === 'residents' ? { resident_id: serverRecordId } : {}),
            } : {}),
            ...(item.table === 'residents' ? { offline: false } : {}),
            sync_status: 'SYNCED',
          };
        }
        await offlineQueue.updateOperationStatus(item.offlineOperationId, updates, session.userId);
        if (item.table === 'residents' && serverRecordId) {
          const localResidentId = item.localRecord?.offlineResidentId ||
            item.localRecord?.resident_id ||
            `offline:${item.offlineOperationId}`;
          await offlineQueue.putResidentIdMapping?.(localResidentId, serverRecordId, session.userId);
          await offlineQueue.rewriteResidentReferences?.(localResidentId, serverRecordId, session.userId);
        }
        result.synced += 1;
        window.dispatchEvent(new CustomEvent('healthsync:queue-changed'));
      } catch (err) {
        if (err?.code === 'SYNC_ACCOUNT_CHANGED') break;
        try {
          assertActiveSession(session);
        } catch {
          break;
        }
        const statusCode = Number(err?.response?.status) || 0;
        if (statusCode === 401) {
          result.authRequired = true;
          const currentAuthItem = await offlineQueue.getOperation(item.offlineOperationId);
          const authAttempts = Number(currentAuthItem?.attempts || item.attempts || item.retryCount || 0) + 1;
          await offlineQueue.updateOperationStatus(item.offlineOperationId, {
            status: 'PENDING',
            retryCount: Number(item.retryCount || 0),
            attempts: authAttempts,
            lastAttemptAt: new Date().toISOString(),
            lastError: 'Sign in again to sync this saved change.',
            lastErrorCode: err?.response?.data?.errorCode || 'AUTH_REQUIRED',
            nextRetryAt: null,
            syncStartedAt: null,
          }, session.userId);
          window.dispatchEvent(new CustomEvent('healthsync:sync-auth-required'));
          window.dispatchEvent(new CustomEvent('healthsync:queue-changed'));
          break;
        }
        result.failed += 1;
        const errorCode = err?.response?.data?.errorCode;
        const current = await offlineQueue.getOperation(item.offlineOperationId);
        const retryCount = (current?.retryCount || 0) + 1;
        // Create requests use atomic idempotency keys, so replaying this same request cannot duplicate a saved record.
        const safelyReplayableCreate = item.operation === 'CREATE' &&
          Boolean(item.request) &&
          SYNCABLE_QUEUE_TABLES.has(item.table) &&
          retryCount <= MAX_UNKNOWN_CREATE_RETRIES;
        const retryableHttp = [408, 429].includes(statusCode) || statusCode >= 500;
        const permanentHttp = [400, 403, 404, 409, 422, 423].includes(statusCode);
        const canSafelyRetry = SYNCABLE_QUEUE_TABLES.has(item.table) &&
          (isNetworkFailure(err) || retryableHttp || errorCode === 'IDEMPOTENCY_RETRY_SAFE' ||
            (errorCode === 'IDEMPOTENCY_OUTCOME_UNKNOWN' && safelyReplayableCreate));
        const requiresReview = isNetworkFailure(err) ||
          ['IDEMPOTENCY_OUTCOME_UNKNOWN', 'IDEMPOTENCY_KEY_CONFLICT', 'IDEMPOTENCY_KEY_REUSE']
            .includes(errorCode) || statusCode === 409 ||
            (!canSafelyRetry && Number(err?.response?.status) >= 500);
        const friendly = canSafelyRetry
          ? errorCode === 'IDEMPOTENCY_RETRY_SAFE'
            ? 'The server rolled back this attempt. It will retry safely using the same operation key.'
            : errorCode === 'IDEMPOTENCY_OUTCOME_UNKNOWN'
              ? 'The server response was uncertain. HealthSync will safely check again using the same operation key.'
              : isNetworkFailure(err)
                ? 'The server response was interrupted. HealthSync will verify the outcome using the same operation key before retrying.'
              : statusCode === 429
                ? 'The server is rate-limiting sync. HealthSync will retry shortly.'
                : retryableHttp
                  ? `The server is temporarily unavailable (HTTP ${statusCode}). HealthSync will retry.`
            : 'The connection was interrupted. The next sync attempt will reuse the same idempotency key.'
          : requiresReview
            ? 'The server outcome is unknown. This change will not be retried automatically; verify whether it was saved before taking further action.'
          : permanentHttp
            ? `The server rejected this change (HTTP ${statusCode}). Check the saved details, correct the issue, then retry.`
          : statusCode
            ? `The server returned HTTP ${statusCode}. This change could not be synchronized.`
            : 'The connection was interrupted. The saved change will retry with its original operation key.';
        console.error('Offline synchronization failed', {
          operationId: item.offlineOperationId,
          errorCode: err?.response?.data?.errorCode || 'SYNC_FAILED',
        });
        assertActiveSession(session);
        const retryAfter = err?.response?.headers?.['retry-after'];
        const retryAfterSeconds = Number(retryAfter);
        const retryAfterDate = Date.parse(retryAfter || '');
        const retryDelay = retryAfterSeconds > 0
          ? retryAfterSeconds * 1000
          : Number.isFinite(retryAfterDate) && retryAfterDate > Date.now()
            ? retryAfterDate - Date.now()
          : Math.min(60000, 2000 * (2 ** Math.min(retryCount - 1, 5)));
        await offlineQueue.updateOperationStatus(item.offlineOperationId, {
          status: requiresReview ? 'CONFLICT' : canSafelyRetry ? 'PENDING' : 'FAILED',
          retryCount,
          attempts: Number(current?.attempts || item.attempts || 1),
          lastAttemptAt: new Date().toISOString(),
          nextRetryAt: canSafelyRetry || requiresReview
            ? new Date(Date.now() + retryDelay).toISOString()
            : null,
          lastError: friendly,
          lastErrorCode: errorCode || (isNetworkFailure(err) ? 'IDEMPOTENCY_OUTCOME_UNKNOWN' : null),
          syncStartedAt: null,
        }, session.userId);
        window.dispatchEvent(new CustomEvent('healthsync:queue-changed'));
        window.dispatchEvent(new CustomEvent('healthsync:notification', {
          detail: {
            category: 'offlineSyncAlerts',
            title: 'Synchronization needs attention',
            description: 'Some saved changes could not be synchronized yet. Review Sync Status for details.',
            id: `sync-failed-${item.offlineOperationId}`,
            createdAt: new Date().toISOString(),
          },
        }));
      }
    }
  } finally {
    if (typeof offlineQueue.cleanupSyncedOperations === 'function') {
      try {
        let cleanupUserId = ownerId;
        try {
          cleanupUserId = getActiveSession().userId;
        } catch {
          // Keep the queue intact when there is no active owner.
        }
        await offlineQueue.cleanupSyncedOperations(cleanupUserId);
      } catch {
        // Cleanup is best-effort; confirmed synced records remain in the queue until verified cleanup succeeds.
      }
    }
    window.dispatchEvent(new CustomEvent('healthsync:sync-complete', { detail: result }));
  }
  return result;
  };
  const lockManager = typeof navigator !== 'undefined' ? navigator.locks : null;
  const request = lockManager?.request
    ? lockManager.request(`healthsync-offline-sync:${encodeURIComponent(scope)}`, { mode: 'exclusive', ifAvailable: true }, (lock) => (
      lock ? syncWork() : { synced: 0, failed: 0 }
    ))
    : Promise.resolve().then(async () => {
      const lease = acquireFallbackLease(encodeURIComponent(scope));
      if (!lease) return { synced: 0, failed: 0, skipped: true };
      try {
        return await syncWork();
      } finally {
        lease.release();
      }
    });
  const scopedPromise = request.finally(() => {
    if (runningPromises.get(scope) === scopedPromise) runningPromises.delete(scope);
  });
  runningPromises.set(scope, scopedPromise);
  return scopedPromise;
}

const syncManager = { runSync };

export default syncManager;
