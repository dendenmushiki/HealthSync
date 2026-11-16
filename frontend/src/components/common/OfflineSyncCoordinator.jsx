import { useContext, useEffect } from 'react';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api/apiClient';
import syncManager from '../../services/offline/syncManager';

const OfflineSyncCoordinator = () => {
  const { offlineVaultReady } = useContext(AuthContext) || {};

  useEffect(() => {
    const onOnline = async () => {
      if (typeof indexedDB === 'undefined' || !offlineVaultReady) return;
      try {
        await new Promise((resolve) => window.setTimeout(resolve, 750));
        if (localStorage.getItem('hs_token')) await api.get('/auth/me');
        await syncManager.runSync();
      } catch (error) {
        window.dispatchEvent(new CustomEvent('healthsync:auto-sync-error', {
          detail: {
            message: error.response?.status === 401
              ? 'Your online session has expired. Sign in online to synchronize; offline work remains on this device.'
              : 'Saved changes could not be synchronized. Reconnect with an authorized account and device.',
          },
        }));
      }
    };

    window.addEventListener('online', onOnline);
    if (navigator.onLine) onOnline();
    return () => window.removeEventListener('online', onOnline);
  }, [offlineVaultReady]);

  return null;
};

export default OfflineSyncCoordinator;
