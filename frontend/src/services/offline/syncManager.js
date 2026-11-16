import offlineQueue from './offlineQueueService';
import api from '../api/apiClient';

let runningPromise = null;
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

export function runSync() {
  if (runningPromise) return runningPromise;
  runningPromise = (async () => {
  const result = { synced: 0, failed: 0 };
  if (typeof navigator !== 'undefined' && !navigator.onLine) return result;
  try {
    const pending = (await offlineQueue.getPendingOperations()).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    for (let item of pending) {
      try {
        item = await resolveResidentDependency(item);
        await offlineQueue.updateOperationStatus(item.offlineOperationId, { status: 'SYNCING', lastError: null });
        window.dispatchEvent(new CustomEvent('healthsync:queue-changed'));
        let syncResponse = item.serverResponse;
        let serverRecordId = item.serverRecordId;
        if (!item.syncComplete) {
          const response = item.request
            ? await api.request({
              ...item.request,
              headers: {
                ...(item.request.headers || {}),
                'X-Idempotency-Key': item.offlineOperationId,
              },
            })
            : await api.post('/sync', { operation: item.operation, module: item.module, table: item.table, payload: item.payload }, { headers: { 'X-Idempotency-Key': item.offlineOperationId } });
          if (!response?.data?.success) throw new Error(response?.data?.message || 'Server did not accept this change.');
          syncResponse = response.data;
          serverRecordId = getServerRecordId(response.data);
          await offlineQueue.updateOperationStatus(item.offlineOperationId, { syncComplete: true, serverResponse: syncResponse, serverRecordId });
        }

        if (item.table === 'residents' && (item.photo || item.photoAction)) {
          const residentId = serverRecordId || item.payload.resident_id;
          if (!residentId) throw new Error('Resident was synced, but its photo could not be linked.');
          if (item.photo) {
            const formData = new FormData();
            formData.append('photo', item.photo);
            await api.post(`/residents/${residentId}/photo`, formData);
          } else if (item.photoAction === 'DELETE') {
            await api.delete(`/residents/${residentId}/photo`);
          }
        }

        const updates = {
          status: 'SYNCED',
          serverResponse: syncResponse,
          serverRecordId,
          syncedAt: new Date().toISOString(),
          lastError: null,
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
        await offlineQueue.updateOperationStatus(item.offlineOperationId, updates);
        result.synced += 1;
        window.dispatchEvent(new CustomEvent('healthsync:queue-changed'));
      } catch (err) {
        result.failed += 1;
        const errorCode = err?.response?.data?.errorCode;
        const canSafelyRetry = Boolean(item.request) && IDEMPOTENT_QUEUED_TABLES.has(item.table) &&
          !err?.response && !err?.code?.startsWith('IDEMPOTENCY_');
        const requiresReview = ['IDEMPOTENCY_OUTCOME_UNKNOWN', 'IDEMPOTENCY_KEY_CONFLICT', 'IDEMPOTENCY_KEY_REUSE']
          .includes(errorCode) || (Boolean(item.request) && !canSafelyRetry &&
            (!err?.response || Number(err.response.status) >= 500));
        const friendly = canSafelyRetry
          ? 'The connection was interrupted. The next sync attempt will reuse the same idempotency key.'
          : requiresReview
            ? 'The server outcome is unknown. This change will not be retried automatically; verify whether it was saved before taking further action.'
          : err?.response?.data?.message || (err?.message === 'Network Error' ? 'No connection to the server' : err?.message || 'The server could not accept this change');
        console.error('Offline synchronization failed', {
          operationId: item.offlineOperationId,
          errorCode: err?.response?.data?.errorCode || 'SYNC_FAILED',
        });
        const current = await offlineQueue.getOperation(item.offlineOperationId);
        const retryCount = (current && current.retryCount) ? current.retryCount + 1 : 1;
        await offlineQueue.updateOperationStatus(item.offlineOperationId, {
          status: canSafelyRetry ? 'PENDING' : requiresReview ? 'CONFLICT' : 'FAILED',
          retryCount,
          lastError: friendly,
        });
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
  })();
  runningPromise.finally(() => { runningPromise = null; });
  return runningPromise;
}

const syncManager = { runSync };

export default syncManager;
