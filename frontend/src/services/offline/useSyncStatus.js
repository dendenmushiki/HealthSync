import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import offlineQueue from './offlineQueueService';
import networkService from './networkService';

const SyncStatusContext = createContext(null);

function useSyncStatusState() {
  const [items, setItems] = useState([]);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [dashboardRequestFailed, setDashboardRequestFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const queue = await offlineQueue.getQueueItems();
      setItems(queue);
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
    const unsubscribe = networkService.subscribe(({ online: isOnline, backendAvailable }) => {
      setOnline(isOnline && backendAvailable !== false);
    });
    const onQueue = () => refresh();
    const onSyncComplete = () => { setSyncing(false); refresh(); };
    window.addEventListener('healthsync:queue-changed', onQueue);
    window.addEventListener('healthsync:sync-complete', onSyncComplete);
    return () => {
      unsubscribe();
      window.removeEventListener('healthsync:queue-changed', onQueue);
      window.removeEventListener('healthsync:sync-complete', onSyncComplete);
    };
  }, [refresh]);

  const pending = items.filter((item) => item.status === 'PENDING').length;
  const failed = items.filter((item) => item.status === 'FAILED').length;
  const syncingCount = items.filter((item) => item.status === 'SYNCING').length;
  const syncedToday = items.filter((item) => item.status === 'SYNCED' && item.syncedAt && new Date(item.syncedAt).toDateString() === new Date().toDateString()).length;
  const conflicts = items.filter((item) => item.status === 'CONFLICT').length;
  const waiting = pending + failed + syncingCount;
  const lastSynced = items.filter((item) => item.syncedAt).sort((a, b) => new Date(b.syncedAt) - new Date(a.syncedAt))[0]?.syncedAt || null;

  return {
    items,
    online,
    syncing,
    setSyncing,
    loaded,
    refresh,
    pending,
    failed,
    syncingCount,
    syncedToday,
    conflicts,
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
