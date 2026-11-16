import React, { useEffect, useState } from 'react';
import networkService from '../../services/offline/networkService';
import syncManager from '../../services/offline/syncManager';

const OfflineBanner = () => {
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    networkService.startNetworkMonitor();
    const unsub = networkService.subscribe(({ online }) => setOnline(online));
    const onOnline = async () => {
      if (typeof indexedDB === 'undefined') return;
      setSyncing(true);
      try {
        // Give the server and authentication state a moment to become ready before retrying.
        await new Promise((resolve) => window.setTimeout(resolve, 750));
        await syncManager.runSync();
      } finally {
        setSyncing(false);
      }
    };
    window.addEventListener('online', onOnline);
    if (navigator.onLine) onOnline();
    return () => { unsub(); window.removeEventListener('online', onOnline); };
  }, []);

  if (online) return null;

  return (
    <div className="bg-warning text-dark p-2 text-center">
      ● Offline — Resident and health record changes are stored on this device and will synchronize when online.
      {syncing && <span> Syncing...</span>}
    </div>
  );
};

export default OfflineBanner;
