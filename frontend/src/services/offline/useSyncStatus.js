import { useCallback, useEffect, useState } from 'react';
import offlineQueue from './offlineQueueService';
import networkService from './networkService';

export default function useSyncStatus() {
  const [items, setItems] = useState([]);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

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
    const unsubscribe = networkService.subscribe(({ online: isOnline }) => setOnline(isOnline));
    const onQueue = () => refresh();
    const onSyncComplete = () => { setSyncing(false); refresh(); };
    const onOnline = () => setOnline(true);
    window.addEventListener('healthsync:queue-changed', onQueue);
    window.addEventListener('healthsync:sync-complete', onSyncComplete);
    window.addEventListener('online', onOnline);
    return () => {
      unsubscribe();
      window.removeEventListener('healthsync:queue-changed', onQueue);
      window.removeEventListener('healthsync:sync-complete', onSyncComplete);
      window.removeEventListener('online', onOnline);
    };
  }, [refresh]);

  const pending = items.filter((item) => item.status === 'PENDING').length;
  const failed = items.filter((item) => item.status === 'FAILED').length;
  const syncingCount = items.filter((item) => item.status === 'SYNCING').length;
  const syncedToday = items.filter((item) => item.status === 'SYNCED' && item.syncedAt && new Date(item.syncedAt).toDateString() === new Date().toDateString()).length;
  const conflicts = items.filter((item) => item.status === 'CONFLICT').length;
  const waiting = pending + failed + syncingCount;
  const lastSynced = items.filter((item) => item.syncedAt).sort((a, b) => new Date(b.syncedAt) - new Date(a.syncedAt))[0]?.syncedAt || null;

  return { items, online, syncing, setSyncing, loaded, refresh, pending, failed, syncingCount, syncedToday, conflicts, waiting, lastSynced, error };
}
