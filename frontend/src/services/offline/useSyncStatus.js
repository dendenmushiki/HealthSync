import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import offlineQueue, { SYNCABLE_QUEUE_TABLES } from './offlineQueueService';
import networkService from './networkService';

const SyncStatusContext = createContext(null);

function useSyncStatusState() {
  const [items, setItems] = useState([]);
  const [connectivity, setConnectivity] = useState(() => (
    typeof networkService.getConnectivityState === 'function'
      ? networkService.getConnectivityState()
      : { state: typeof navigator === 'undefined' || navigator.onLine ? 'online' : 'offline', online: typeof navigator === 'undefined' || navigator.onLine }
  ));
  const [syncing, setSyncing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [dashboardRequestFailed, setDashboardRequestFailed] = useState(false);
  const [signInRequired, setSignInRequired] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const queue = await offlineQueue.getQueueItems();
      setItems(queue.filter((item) => SYNCABLE_QUEUE_TABLES.has(item.table)));
      setError(null);
    } catch (error) {
      setItems([]);
      setError(error instanceof Error && error.message
        ? error.message
        : 'Secure sync data is locked or unavailable for this account.');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    networkService.startNetworkMonitor();
    const unsubscribe = networkService.subscribe((nextConnectivity) => setConnectivity(nextConnectivity));
    const onQueue = () => refresh();
    const onSyncComplete = (event) => {
      setSyncing(false);
      setLastSyncResult(event.detail || null);
      refresh();
    };
    const onSyncAuthRequired = () => setSignInRequired(true);
    const onSyncStart = () => setSyncing(true);
    const onSignIn = () => setSignInRequired(false);
    window.addEventListener('healthsync:queue-changed', onQueue);
    window.addEventListener('healthsync:sync-complete', onSyncComplete);
    window.addEventListener('healthsync:sync-start', onSyncStart);
    window.addEventListener('healthsync:sync-auth-required', onSyncAuthRequired);
    window.addEventListener('healthsync:session-refreshed', onSignIn);
    return () => {
      unsubscribe();
      window.removeEventListener('healthsync:queue-changed', onQueue);
      window.removeEventListener('healthsync:sync-complete', onSyncComplete);
      window.removeEventListener('healthsync:sync-start', onSyncStart);
      window.removeEventListener('healthsync:sync-auth-required', onSyncAuthRequired);
      window.removeEventListener('healthsync:session-refreshed', onSignIn);
    };
  }, [refresh]);

  const pending = items.filter((item) => item.status === 'PENDING').length;
  const failed = items.filter((item) => item.status === 'FAILED').length;
  const syncingCount = items.filter((item) => item.status === 'SYNCING').length;
  const syncedToday = items.filter((item) => item.savedOffline === true && item.status === 'SYNCED' && item.syncedAt && new Date(item.syncedAt).toDateString() === new Date().toDateString()).length;
  const conflicts = items.filter((item) => item.status === 'CONFLICT').length;
  const blocked = items.filter((item) => item.status === 'BLOCKED').length;
  const waiting = pending + failed + syncingCount + conflicts + blocked;
  const lastSynced = items.filter((item) => item.savedOffline === true && item.syncedAt).sort((a, b) => new Date(b.syncedAt) - new Date(a.syncedAt))[0]?.syncedAt || null;

  return {
    items,
    online: connectivity.state === 'online' || connectivity.online === true,
    connectivity,
    checkNow: networkService.checkNow || networkService.healthCheck,
    signInRequired,
    lastSyncResult,
    syncing,
    setSyncing,
    loaded,
    refresh,
    pending,
    failed,
    syncingCount,
    syncedToday,
    conflicts,
    blocked,
    waiting,
    lastSynced,
    error,
    dashboardRequestFailed,
    setDashboardRequestFailed,
  };
}

export function SyncStatusProvider({ children }) {
  const status = useSyncStatusState();
  return <SyncStatusContext.Provider value={status}>{children}</SyncStatusContext.Provider>;
}

export default function useSyncStatus() {
  const status = useContext(SyncStatusContext);
  if (!status) {
    throw new Error('useSyncStatus must be used within SyncStatusProvider.');
  }
  return status;
}
