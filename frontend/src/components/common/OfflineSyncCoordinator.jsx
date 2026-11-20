import { useContext, useEffect } from 'react';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api/apiClient';
import syncManager from '../../services/offline/syncManager';
import networkService from '../../services/offline/networkService';

const BACKEND_RECHECK_INTERVAL_MS = 20000;

const OfflineSyncCoordinator = () => {
  const { user, token, offlineVaultReady } = useContext(AuthContext) || {};

  useEffect(() => {
    if (typeof indexedDB === 'undefined' || !offlineVaultReady) return undefined;
    let active = true;
    let attemptPromise = null;
    let onlineTimer = null;
    let backendWasAvailable = null;
    const expectedToken = token || localStorage.getItem('hs_token');
    const expectedUserId = user?.user_id === undefined ? null : String(user.user_id);

    const attemptSync = () => {
      if (!active) return Promise.resolve(false);
      if (attemptPromise) return attemptPromise;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return Promise.resolve(false);
      if (!expectedToken || localStorage.getItem('hs_token') !== expectedToken) return Promise.resolve(false);
      attemptPromise = (async () => {
        const backendAvailable = await networkService.healthCheck();
        if (!active || localStorage.getItem('hs_token') !== expectedToken) return false;
        if (!backendAvailable) {
          backendWasAvailable = false;
          return false;
        }
        if (expectedUserId !== null) {
          let activeUser;
          try {
            activeUser = JSON.parse(localStorage.getItem('hs_user') || 'null');
          } catch {
            return false;
          }
          if (String(activeUser?.user_id ?? '') !== expectedUserId) return false;
        }
        const shouldVerifySession = backendWasAvailable !== true;
        backendWasAvailable = true;
        if (shouldVerifySession) await api.get('/auth/me');
        if (!active || localStorage.getItem('hs_token') !== expectedToken) return false;
        await syncManager.runSync();
        return true;
      })().catch((error) => {
        if (!active) return false;
        window.dispatchEvent(new CustomEvent('healthsync:auto-sync-error', {
          detail: {
            message: error.response?.status === 401
              ? 'Your online session has expired. Sign in online to synchronize; offline work remains on this device.'
              : 'Saved changes could not be synchronized. Reconnect with an authorized account and device.',
          },
        }));
        return false;
      }).finally(() => {
        attemptPromise = null;
      });
      return attemptPromise;
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') attemptSync();
    };
    const onOnline = () => {
      if (onlineTimer !== null) window.clearTimeout(onlineTimer);
      onlineTimer = window.setTimeout(() => {
        onlineTimer = null;
        attemptSync();
      }, 750);
    };

    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    const retryTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') attemptSync();
    }, BACKEND_RECHECK_INTERVAL_MS);
    attemptSync();
    return () => {
      active = false;
      if (onlineTimer !== null) window.clearTimeout(onlineTimer);
      window.clearInterval(retryTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [offlineVaultReady, token, user?.user_id]);

  return null;
};

export default OfflineSyncCoordinator;
