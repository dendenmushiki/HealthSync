import offlineQueue from './offlineQueueService';
import api from '../api/apiClient';

const runningPromises = new Map();
const IDEMPOTENT_QUEUED_TABLES = new Set([
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
  'report_remarks',
]);

function getServerRecordId(responseData) {
  const data = responseData?.data;
  const record = data?.record || data;
  return data?.serverRecordId || data?.resident_id || record?.id || record?.resident_id ||
    record?.senior_id || record?.record_id || record?.timbang_id || record?.bmi_id ||
    record?.adolescent_bmi_id || record?.health_record_id || record?.server_record_id || null;
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
  if (typeof residentId !== 'string' || !residentId.startsWith('offline:')) return item;
  const queueItems = await offlineQueue.getQueueItems();
  const residentOperation = queueItems.find((queued) => (
    queued.table === 'residents' &&
    String(queued.localRecord?.offlineResidentId || queued.localRecord?.resident_id) === residentId
  ));
  if (residentOperation?.status !== 'SYNCED' || !residentOperation.serverRecordId) {
    throw new Error('Waiting for the locally created resident to synchronize.');
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
  return offlineQueue.updateOperationStatus(item.offlineOperationId, {
    payload: item.payload && typeof item.payload === 'object'
      ? { ...item.payload, resident_id: serverResidentId }
      : item.payload,
    request: nextRequest,
    localRecord: item.localRecord
      ? { ...item.localRecord, resident_id: serverResidentId }
      : item.localRecord,
  });
}

function isNetworkFailure(error) {
  if (error?.response) return false;
  return (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'].includes(error?.code) ||
    error?.message === 'Network Error';
}

export function runSync() {
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
  const result = { synced: 0, failed: 0 };
  if (typeof navigator !== 'undefined' && !navigator.onLine) return result;
  try {
    const session = getActiveSession();
    const pending = (await offlineQueue.getPendingOperations(session.userId))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (pending.some((item) => String(item.userId) !== session.userId)) {
      throw new Error('A queued change is not owned by the active account and was not synchronized.');
    }
    for (let item of pending) {
      try {
        assertActiveSession(session);
        item = await resolveResidentDependency(item);
        assertActiveSession(session);
        await offlineQueue.updateOperationStatus(item.offlineOperationId, {
          status: 'SYNCING',
          syncStartedAt: new Date().toISOString(),
          lastError: null,
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
              },
            })
            : await api.post('/sync', { operation: item.operation, module: item.module, table: item.table, payload: item.payload }, {
              headers: { Authorization: `Bearer ${session.token}`, 'X-Idempotency-Key': item.offlineOperationId },
            });
          assertActiveSession(session);
          if (!response?.data?.success) throw new Error(response?.data?.message || 'Server did not accept this change.');
          syncResponse = response.data;
          serverRecordId = getServerRecordId(response.data);
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
        result.synced += 1;
        window.dispatchEvent(new CustomEvent('healthsync:queue-changed'));
      } catch (err) {
        if (err?.code === 'SYNC_ACCOUNT_CHANGED') break;
        try {
          assertActiveSession(session);
        } catch {
          break;
        }
        result.failed += 1;
        const errorCode = err?.response?.data?.errorCode;
        const canSafelyRetry = IDEMPOTENT_QUEUED_TABLES.has(item.table) &&
          (isNetworkFailure(err) || errorCode === 'IDEMPOTENCY_RETRY_SAFE');
        const requiresReview = ['IDEMPOTENCY_OUTCOME_UNKNOWN', 'IDEMPOTENCY_KEY_CONFLICT', 'IDEMPOTENCY_KEY_REUSE']
          .includes(errorCode) || (!canSafelyRetry && Number(err?.response?.status) >= 500);
        const friendly = canSafelyRetry
          ? errorCode === 'IDEMPOTENCY_RETRY_SAFE'
            ? err.response.data.message
            : 'The connection was interrupted. The next sync attempt will reuse the same idempotency key.'
          : requiresReview
            ? 'The server outcome is unknown. This change will not be retried automatically; verify whether it was saved before taking further action.'
          : err?.response?.data?.message || (err?.message === 'Network Error' ? 'No connection to the server' : err?.message || 'The server could not accept this change');
        console.error('Offline synchronization failed', {
          operationId: item.offlineOperationId,
          errorCode: err?.response?.data?.errorCode || 'SYNC_FAILED',
        });
        const current = await offlineQueue.getOperation(item.offlineOperationId);
        const retryCount = (current && current.retryCount) ? current.retryCount + 1 : 1;
        assertActiveSession(session);
        await offlineQueue.updateOperationStatus(item.offlineOperationId, {
          status: canSafelyRetry ? 'PENDING' : requiresReview ? 'CONFLICT' : 'FAILED',
          retryCount,
          lastError: friendly,
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
    window.dispatchEvent(new CustomEvent('healthsync:sync-complete', { detail: result }));
  }
  return result;
  };
  const lockManager = typeof navigator !== 'undefined' ? navigator.locks : null;
  const request = lockManager?.request
    ? lockManager.request(`healthsync-offline-sync:${encodeURIComponent(scope)}`, { mode: 'exclusive', ifAvailable: true }, (lock) => (
      lock ? syncWork() : { synced: 0, failed: 0 }
    ))
    : syncWork();
  const scopedPromise = request.finally(() => {
    if (runningPromises.get(scope) === scopedPromise) runningPromises.delete(scope);
  });
  runningPromises.set(scope, scopedPromise);
  return scopedPromise;
}

const syncManager = { runSync };

export default syncManager;
