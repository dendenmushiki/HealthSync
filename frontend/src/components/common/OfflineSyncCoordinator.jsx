import { useContext, useEffect } from 'react';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api/apiClient';
import syncManager from '../../services/offline/syncManager';
import networkService from '../../services/offline/networkService';

const PENDING_SYNC_RECHECK_INTERVAL_MS = 30000;

const OfflineSyncCoordinator = () => {
  const { user, token, offlineVaultReady } = useContext(AuthContext) || {};

  useEffect(() => {
    if (typeof indexedDB === 'undefined' || !offlineVaultReady) return undefined;
    let active = true;
    let attemptPromise = null;
    let backendWasAvailable = null;
    let authenticationBlocked = false;
    const expectedToken = token || localStorage.getItem('hs_token');
    const expectedUserId = user?.user_id === undefined ? null : String(user.user_id);

    const attemptSync = () => {
      if (!active) return Promise.resolve(false);
      if (attemptPromise) return attemptPromise;
      if (authenticationBlocked) return Promise.resolve(false);
      if (!expectedToken || localStorage.getItem('hs_token') !== expectedToken) return Promise.resolve(false);
      attemptPromise = (async () => {
        const backendAvailable = await (networkService.checkNow || networkService.healthCheck)();
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
        const result = await syncManager.runSync();
        if (result?.authRequired) authenticationBlocked = true;
        return true;
      })().catch((error) => {
        if (!active) return false;
        if (error.response?.status === 401) {
          authenticationBlocked = true;
          window.dispatchEvent(new CustomEvent('healthsync:sync-auth-required'));
        }
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
    const onQueue = () => attemptSync();
    const onOnline = () => attemptSync();
    const onFocus = () => attemptSync();

    window.dispatchEvent(new CustomEvent('healthsync:session-refreshed'));
    window.addEventListener('online', onOnline);
    window.addEventListener('healthsync:connectivity-online', onOnline);
    window.addEventListener('healthsync:offline-queued', onQueue);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    const retryTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') attemptSync();
    }, PENDING_SYNC_RECHECK_INTERVAL_MS);
    attemptSync();
    return () => {
      active = false;
      window.clearInterval(retryTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('healthsync:connectivity-online', onOnline);
      window.removeEventListener('healthsync:offline-queued', onQueue);
      window.removeEventListener('focus', onFocus);
    };
  }, [offlineVaultReady, token, user?.user_id]);

  return null;
};

export default OfflineSyncCoordinator;
