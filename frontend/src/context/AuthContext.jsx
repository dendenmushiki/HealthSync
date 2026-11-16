import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';
import { login as apiLogin, setAuth, logout as apiLogout, getAuth, checkDeviceAuthorization } from '../services/auth/authService';
import { clearOfflineSession, createOfflineSession, getOfflineSession } from '../services/offline/offlineSessionService';
import {
  changeOfflineVaultCredential,
  createOfflineVault,
  getOfflineVaultMetadata,
  isOfflineVaultUnlocked,
  lockOfflineVault,
  unlockOfflineVault,
} from '../services/offline/offlineVaultService';
import { migrateLegacyQueue } from '../services/offline/offlineQueueService';
import api from '../services/api/apiClient';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [offlineVaultReady, setOfflineVaultReady] = useState(false);
  const [offlineVaultError, setOfflineVaultError] = useState(null);
  const [sessionCleanupError, setSessionCleanupError] = useState(null);
  const authorizationCheckInFlight = useRef(null);

  useEffect(() => {
    try {
      if (localStorage.getItem('hs_logout_pending')) {
        lockOfflineVault();
        clearOfflineSession();
        localStorage.removeItem('hs_token');
        localStorage.removeItem('hs_user');
        localStorage.removeItem('hs_logout_pending');
      }
    const stored = getAuth();
    const grant = getOfflineSession();
    if (stored?.user && (stored.token || grant)) {
      setToken(stored.token);
      setUser(stored.user);
    }
    } catch (error) {
      lockOfflineVault();
      setSessionCleanupError('Sign-out cleanup is incomplete. Reload the page to retry before signing in.');
    }
    setLoading(false);
  }, []);

  const login = async (username, password) => {
    lockOfflineVault();
    setOfflineVaultReady(false);
    setOfflineVaultError(null);
    if (sessionCleanupError || localStorage.getItem('hs_logout_pending')) {
      throw new Error('Sign-out cleanup is incomplete. Reload the page to retry before signing in.');
    }
    const data = await apiLogin(username, password);
    if (data && data.success) {
      const signedInUser = data.data.user;
      const currentGrant = getOfflineSession();
      const currentAccountId = user?.user_id ?? getAuth()?.user?.user_id;
      if (currentAccountId && String(currentAccountId) !== String(signedInUser?.user_id) &&
          typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel('healthsync-session');
        channel.postMessage({ type: 'account-switch' });
        channel.close();
      }
      if (currentGrant && String(currentGrant.userId) !== String(signedInUser?.user_id)) {
        clearOfflineSession();
      }
      setAuth(data.data.token, signedInUser);
      if (signedInUser?.must_change_password || signedInUser?.offline_pin_setup_required) {
        try {
          const ownerId = signedInUser?.user_id;
          if (ownerId === undefined || ownerId === null) {
            throw new Error('The signed-in account is missing its account identifier.');
          }
          const metadata = await getOfflineVaultMetadata(ownerId);
          if (metadata) {
            if (signedInUser.must_change_password && metadata.credentialType === 'password') {
              const unlocked = await unlockOfflineVault({ userId: ownerId, credential: password });
              if (unlocked.role !== signedInUser.role) {
                throw new Error('Offline access must be refreshed after an account role change.');
              }
            }
          }
        } catch (error) {
          if (signedInUser?.user_id !== undefined) lockOfflineVault(signedInUser.user_id);
          setOfflineVaultError(error.message || 'Existing offline data could not be prepared for the required account setup.');
        }
      } else {
        if (signedInUser?.offline_pin_enrolled) {
          try {
            createOfflineSession({
              userId: signedInUser.user_id,
              role: signedInUser.role,
              deviceId: signedInUser.device_id,
            });
          } catch (error) {
            setOfflineVaultError(error.message || 'Offline authorization could not be saved on this device.');
          }
        } else {
          setOfflineVaultError('Set up a six-digit PIN in Settings → Security before relying on offline data.');
        }
      }
      if (data.data.preferences) {
        localStorage.setItem('hs_preferences', JSON.stringify(data.data.preferences));
        window.dispatchEvent(new CustomEvent('healthsync:preferences-updated', { detail: data.data.preferences }));
      }
      setToken(data.data.token);
      setUser(data.data.user);
      return { success: true, user: data.data.user, mustChangePassword: Boolean(data.data.user?.must_change_password) };
    }
    return { success: false, message: data ? data.message : 'Login failed' };
  };

  const logout = useCallback(async ({ skipServer = false } = {}) => {
    lockOfflineVault();
    setOfflineVaultReady(false);
    setUser(null);
    setToken(null);
    setOfflineVaultError(null);
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('healthsync-session');
      channel.postMessage({ type: 'logout' });
      channel.close();
    }
    let cleanupError = null;
    try {
      localStorage.setItem('hs_logout_pending', JSON.stringify({ userId: user?.user_id || null, startedAt: Date.now() }));
    } catch (error) {
      cleanupError = error;
    }
    try {
      if (!skipServer) {
        try {
          await apiLogout();
        } catch (error) {
          console.error('Unable to revoke the online session during signout.', error);
        }
      } else {
        localStorage.removeItem('hs_token');
        localStorage.removeItem('hs_user');
      }
    } catch (error) {
      console.error('Unable to complete local signout storage cleanup.', error);
      cleanupError = cleanupError || error;
    }
    try {
      clearOfflineSession();
      localStorage.removeItem('hs_token');
      localStorage.removeItem('hs_user');
      localStorage.setItem('hs_session_ended', String(Date.now()));
    } catch (error) {
      cleanupError = cleanupError || error;
    }
    if (cleanupError) {
      setSessionCleanupError('Sign-out cleanup is incomplete. The app remains locked; reload to retry cleanup.');
      throw new Error('Sign-out cleanup failed. HealthSync remains locked; retry cleanup before signing in again.');
    }
    try {
      localStorage.removeItem('hs_logout_pending');
      setSessionCleanupError(null);
    } catch (error) {
      setSessionCleanupError('Sign-out cleanup is incomplete. The app remains locked; reload to retry cleanup.');
      throw new Error('Sign-out cleanup failed. HealthSync remains locked; retry cleanup before signing in again.');
    }
  }, [user]);

  const updateUser = useCallback((nextUser) => {
    setUser(nextUser);
    const stored = getAuth();
    if (stored && stored.token) setAuth(stored.token, nextUser);
  }, []);

  const checkOnlineDeviceAuthorization = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.onLine || !user?.device_id || !getOfflineSession()) return true;
    if (authorizationCheckInFlight.current) return authorizationCheckInFlight.current;
    const request = checkDeviceAuthorization(user)
      .then(() => true)
      .catch((error) => {
        lockOfflineVault(user.user_id);
        setOfflineVaultReady(false);
        if (!error.response?.data?.errorCode) {
          setOfflineVaultError('Device authorization could not be verified online. HealthSync is locked until the server can confirm this device.');
        }
        return false;
      })
      .finally(() => { authorizationCheckInFlight.current = null; });
    authorizationCheckInFlight.current = request;
    return request;
  }, [user]);

  const unlockOfflineAccess = useCallback(async (credential) => {
    const ownerId = user?.user_id;
    const grant = getOfflineSession();
    if (ownerId === undefined || ownerId === null || user?.must_change_password ||
        user?.offline_pin_setup_required ||
        !grant || String(grant.userId) !== String(ownerId) || grant.role !== user.role) {
      throw new Error('Offline authorization is unavailable for this account and device. Reconnect and sign in online.');
    }
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const authorized = await checkOnlineDeviceAuthorization();
      if (!authorized) throw new Error('Device authorization could not be verified. Reconnect and try again.');
    }
    const metadata = await unlockOfflineVault({ userId: ownerId, credential });
    if (metadata.role !== grant.role || metadata.role !== user.role) {
      lockOfflineVault(ownerId);
      throw new Error('Offline authorization does not match this account role. Reconnect and sign in online.');
    }
    setOfflineVaultReady(true);
    setOfflineVaultError(null);
    await migrateLegacyQueueSafely(ownerId, setOfflineVaultError);
    return true;
  }, [checkOnlineDeviceAuthorization, user]);

  const lockOfflineAccess = useCallback(({ broadcast = true } = {}) => {
    if (user?.user_id !== undefined) lockOfflineVault(user.user_id);
    setOfflineVaultReady(false);
    if (broadcast && typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('healthsync-session');
      channel.postMessage({ type: 'lock' });
      channel.close();
    }
  }, [user]);

  const lockForAccountSwitch = useCallback(() => {
    lockOfflineVault();
    setOfflineVaultReady(false);
    setUser(null);
    setToken(null);
  }, []);

  useEffect(() => {
    if (!user?.device_id || !getOfflineSession()) return undefined;
    const verifyWhenOnline = () => {
      if (navigator.onLine) checkOnlineDeviceAuthorization();
    };
    verifyWhenOnline();
    window.addEventListener('online', verifyWhenOnline);
    const intervalId = window.setInterval(verifyWhenOnline, 60 * 1000);
    return () => {
      window.removeEventListener('online', verifyWhenOnline);
      window.clearInterval(intervalId);
    };
  }, [checkOnlineDeviceAuthorization, user?.device_id]);

  useEffect(() => {
    const handleAuthorizationRevoked = (event) => {
      lockOfflineVault();
      setOfflineVaultReady(false);
      setUser(null);
      setToken(null);
      setOfflineVaultError(event.detail?.reason === 'ACCOUNT_DEACTIVATED'
        ? 'This account has been disabled. Pending offline changes are preserved; contact an administrator.'
        : 'This device authorization has been revoked. Pending offline changes are preserved.');
      try {
        clearOfflineSession();
        localStorage.removeItem('hs_token');
        localStorage.removeItem('hs_user');
        localStorage.setItem('hs_session_ended', String(Date.now()));
      } catch (error) {
        setSessionCleanupError('Device revocation cleanup is incomplete. HealthSync remains locked.');
      }
    };
    window.addEventListener('healthsync:offline-authorization-revoked', handleAuthorizationRevoked);
    return () => window.removeEventListener('healthsync:offline-authorization-revoked', handleAuthorizationRevoked);
  }, []);

  const completePasswordChange = useCallback(async (nextToken, nextUser, pin) => {
    setOfflineVaultReady(false);
    setOfflineVaultError(null);
    setAuth(nextToken, nextUser);
    setToken(nextToken);
    setUser(nextUser);
    if (!nextUser?.offline_pin_setup_required) {
      if (nextUser?.offline_pin_enrolled) {
        if (!getOfflineSession()) {
          createOfflineSession({ userId: nextUser.user_id, role: nextUser.role, deviceId: nextUser.device_id });
        }
      } else {
        const ownerId = nextUser?.user_id;
        const metadata = ownerId === undefined ? null : await getOfflineVaultMetadata(ownerId);
        if (metadata?.credentialType !== 'pin' && metadata && isOfflineVaultUnlocked(ownerId)) {
          const hadGrant = Boolean(getOfflineSession());
          if (!hadGrant) createOfflineSession({ userId: ownerId, role: nextUser.role, deviceId: nextUser.device_id });
          try {
            await changeOfflineVaultCredential({
              userId: ownerId,
              credential: pin,
              credentialType: 'password',
            });
          } finally {
            if (!hadGrant) clearOfflineSession();
            lockOfflineVault(ownerId);
          }
        }
      }
      setOfflineVaultError(null);
      return true;
    }
    try {
      const ownerId = nextUser?.user_id;
      if (ownerId === undefined || ownerId === null) throw new Error('The signed-in account is missing its account identifier.');
      if (!/^\d{6}$/.test(pin)) throw new Error('PIN must contain exactly six digits.');
      createOfflineSession({ userId: ownerId, role: nextUser.role, deviceId: nextUser.device_id });
      const metadata = await getOfflineVaultMetadata(ownerId);
      let updated;
      if (metadata?.credentialType === 'pin') {
        if (!isOfflineVaultUnlocked(ownerId)) await unlockOfflineVault({ userId: ownerId, credential: pin });
        updated = metadata;
      } else if (metadata) {
        if (!isOfflineVaultUnlocked(ownerId)) {
          throw new Error('Existing offline data is locked. Sign in with the current account password and retry PIN setup.');
        }
        updated = await changeOfflineVaultCredential({ userId: ownerId, credential: pin, credentialType: 'pin' });
      } else {
        updated = await createOfflineVault({ userId: ownerId, role: nextUser.role, credential: pin, credentialType: 'pin' });
      }
      if (updated.role !== nextUser.role) throw new Error('Offline access must be refreshed after an account role change.');
      const response = await api.post('/auth/complete-offline-setup', { pin });
      if (!response.data?.success) throw new Error(response.data?.message || 'Unable to save PIN enrollment.');
      const completedUser = { ...nextUser, offline_pin_enrolled: true, offline_pin_setup_required: false };
      setAuth(nextToken, completedUser);
      setUser(completedUser);
      setOfflineVaultReady(true);
      await migrateLegacyQueueSafely(ownerId, setOfflineVaultError);
      return true;
    } catch (error) {
      if (nextUser?.user_id !== undefined) lockOfflineVault(nextUser.user_id);
      setOfflineVaultError(error.message || 'PIN setup could not be completed. Retry setup before using HealthSync.');
      return false;
    }
  }, []);

  return (
    <AuthContext.Provider value={{
      user, token, login, logout, updateUser, completePasswordChange, loading,
      offlineVaultReady, offlineVaultError, unlockOfflineAccess, lockOfflineAccess,
      sessionCleanupError, lockForAccountSwitch,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

async function migrateLegacyQueueSafely(userId, setError) {
  try {
    const result = await migrateLegacyQueue(userId);
    if (result.unowned > 0 || result.skipped > 0) {
      setError('Some older queued changes could not be safely associated with this account and were preserved but not migrated.');
    }
    if (result.migrated > 0 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('healthsync:queue-changed'));
    }
  } catch {
    setError('Some older queued changes could not be secured and were preserved. Review them before clearing this device.');
  }
}
