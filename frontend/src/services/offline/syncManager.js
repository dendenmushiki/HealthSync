import offlineQueue from './offlineQueueService';
import api from '../api/apiClient';
import idb from './indexedDbService';

let runningPromise = null;

export function runSync() {
  if (runningPromise) return runningPromise;
  runningPromise = (async () => {
  const result = { synced: 0, failed: 0 };
  if (typeof navigator !== 'undefined' && !navigator.onLine) return result;
  try {
    const pending = (await offlineQueue.getPendingOperations()).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    for (const item of pending) {
      try {
        await offlineQueue.updateOperationStatus(item.offlineOperationId, { status: 'SYNCING', lastError: null });
        window.dispatchEvent(new CustomEvent('healthsync:queue-changed'));
        let syncResponse = item.serverResponse;
        let serverRecordId = item.serverRecordId;
        if (!item.syncComplete) {
          const response = item.request
            ? await api.request(item.request)
            : await api.post('/sync', { operation: item.operation, module: item.module, table: item.table, payload: item.payload }, { headers: { 'X-Idempotency-Key': item.offlineOperationId } });
          if (!response?.data?.success) throw new Error(response?.data?.message || 'Server did not accept this change.');
          syncResponse = response.data;
          serverRecordId = response.data.data?.serverRecordId || response.data.data?.resident_id || response.data.data?.record?.server_record_id || null;
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

        await offlineQueue.updateOperationStatus(item.offlineOperationId, { status: 'SYNCED', serverResponse: syncResponse, serverRecordId, syncedAt: new Date().toISOString(), lastError: null });
        result.synced += 1;
        window.dispatchEvent(new CustomEvent('healthsync:queue-changed'));
      } catch (err) {
        result.failed += 1;
        const friendly = err?.response?.data?.message || (err?.message === 'Network Error' ? 'No connection to the server' : err?.message || 'The server could not accept this change');
        console.error('Sync error for', item.offlineOperationId, friendly);
        const current = await idb.getFromStore('offlineQueue', item.offlineOperationId);
        const retryCount = (current && current.retryCount) ? current.retryCount + 1 : 1;
        await offlineQueue.updateOperationStatus(item.offlineOperationId, { status: 'FAILED', retryCount, lastError: friendly });
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
