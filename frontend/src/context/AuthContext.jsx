import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';
import { login as apiLogin, setAuth, logout as apiLogout, getAuth, checkDeviceAuthorization } from '../services/auth/authService';
import {
  clearOfflineSession,
  createOfflineSession,
  getOfflineSession,
  isOfflinePinRequired,
  setOfflinePinRequired,
} from '../services/offline/offlineSessionService';
import {
  addOfflineVaultPasswordWrapper,
  changeOfflineVaultCredential,
  createOfflineVault,
  getOfflineVaultMetadata,
  hasOfflineVaultSessionUnlock,
  isOfflineVaultUnlocked,
  lockOfflineVault,
  restoreOfflineVaultSession,
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
  const [offlineVaultNeedsUnlock, setOfflineVaultNeedsUnlock] = useState(false);
  const [offlineVaultMigrationRequired, setOfflineVaultMigrationRequired] = useState(false);
  const [offlineVaultError, setOfflineVaultError] = useState(null);
  const [sessionCleanupError, setSessionCleanupError] = useState(null);
  const authorizationCheckInFlight = useRef(null);
  const pendingOnlinePassword = useRef(null);

  useEffect(() => {
    let active = true;
    const initializeSession = async () => {
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
        const ownerId = stored?.user?.user_id;
        const grantMatchesUser = ownerId !== undefined && ownerId !== null && grant &&
          String(grant.userId) === String(ownerId) && grant.role === stored.user.role;
        const needsInactivityPin = grantMatchesUser && isOfflinePinRequired(ownerId);
        const isOnline = typeof navigator === 'undefined' || navigator.onLine;
        if (stored?.user && (stored.token || grant)) {
          if (grant && !grantMatchesUser) {
            lockOfflineVault();
            clearOfflineSession();
            localStorage.removeItem('hs_token');
            localStorage.removeItem('hs_user');
          } else {
            setToken(stored.token);
            setUser(stored.user);
            setOfflineVaultNeedsUnlock(Boolean(grantMatchesUser && needsInactivityPin));
            const restoreSessionUnlock = Boolean(
              grantMatchesUser && stored.token && isOnline && !needsInactivityPin &&
              !stored.user.must_change_password && !stored.user.offline_pin_setup_required &&
              hasOfflineVaultSessionUnlock({
                userId: ownerId,
                role: grant.role,
                deviceId: grant.deviceId,
              })
            );
            if (needsInactivityPin) {
              lockOfflineVault(ownerId);
              setOfflineVaultReady(false);
            } else if (restoreSessionUnlock) {
              try {
                const restored = await restoreOfflineVaultSession({
                  userId: ownerId,
                  role: grant.role,
                  deviceId: grant.deviceId,
                });
                if (!restored) throw new Error('The saved offline session could not be restored.');
                const response = await api.get('/auth/me');
                const serverUser = response?.data?.data?.user;
                if (!response?.data?.success || !serverUser ||
                    String(serverUser.user_id) !== String(ownerId) || serverUser.role !== grant.role) {
                  throw new Error('The online account session could not be verified.');
                }
                const vaultMetadata = await getOfflineVaultMetadata(ownerId);
                if (vaultMetadata?.credentialType === 'pin' && !serverUser.offline_pin_enrolled) {
                  throw new Error('The shared PIN changed. Reconnect and unlock this device again.');
                }
                if (!active) return;
                const verifiedUser = { ...stored.user, ...serverUser, device_id: stored.user.device_id };
                setToken(stored.token);
                setUser(verifiedUser);
                setAuth(stored.token, verifiedUser);
                setOfflineVaultReady(true);
                setOfflineVaultNeedsUnlock(false);
                setOfflineVaultError(null);
              } catch (error) {
                if (active) {
                  lockOfflineVault(ownerId);
                  setOfflineVaultReady(false);
                  const confirmedRevocation = ['DEVICE_REVOKED', 'ACCOUNT_DEACTIVATED']
                    .includes(error.response?.data?.errorCode);
                  setOfflineVaultNeedsUnlock(Boolean(grantMatchesUser && !confirmedRevocation));
                  setOfflineVaultError(!confirmedRevocation && (
                    !error.response || Number(error.response.status) >= 500
                  )
                    ? 'The server could not confirm this device right now. You can still unlock local data with your PIN; synchronization will resume when the server is available.'
                    : error.message || 'The online session could not be verified. Offline data remains locked.');
                }
              }
            } else {
              if (!isOnline && grantMatchesUser) {
                lockOfflineVault(ownerId);
                setOfflineVaultReady(false);
              } else {
                setOfflineVaultReady(Boolean(grantMatchesUser && isOfflineVaultUnlocked(ownerId)));
              }
            }
          }
        }
      } catch (error) {
        if (active) {
          lockOfflineVault();
          setSessionCleanupError('Sign-out cleanup is incomplete. Reload the page to retry before signing in.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    initializeSession();
    return () => { active = false; };
  }, []);

  const login = async (identifier, password) => {
    let migrationRequired = false;
    lockOfflineVault();
    setOfflineVaultReady(false);
    setOfflineVaultNeedsUnlock(false);
    setOfflineVaultMigrationRequired(false);
    pendingOnlinePassword.current = null;
    setOfflineVaultError(null);
    if (sessionCleanupError || localStorage.getItem('hs_logout_pending')) {
      throw new Error('Sign-out cleanup is incomplete. Reload the page to retry before signing in.');
    }
    const data = await apiLogin(identifier, password);
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
          if (signedInUser.offline_pin_setup_required && !signedInUser.must_change_password) {
            pendingOnlinePassword.current = password;
          }
          if (metadata) {
            if (signedInUser.must_change_password &&
                (metadata.credentialType === 'password' || metadata.hasOnlinePasswordWrapper)) {
              await checkDeviceAuthorization(signedInUser);
              const unlocked = await unlockOfflineVault({
                userId: ownerId,
                credential: password,
                ...(metadata.credentialType === 'pin' ? { credentialType: 'online-password' } : {}),
              });
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
        try {
          const ownerId = signedInUser.user_id;
          createOfflineSession({
            userId: ownerId,
            role: signedInUser.role,
            deviceId: signedInUser.device_id,
          });
          await checkDeviceAuthorization(signedInUser);

          let metadata = await getOfflineVaultMetadata(ownerId);
          if (!metadata) {
            metadata = await createOfflineVault({
              userId: ownerId,
              role: signedInUser.role,
              credential: password,
              credentialType: 'password',
              onlinePassword: password,
            });
          }

          if (metadata.credentialType === 'pin' && !metadata.hasOnlinePasswordWrapper) {
            setOfflineVaultNeedsUnlock(true);
            setOfflineVaultMigrationRequired(true);
            pendingOnlinePassword.current = password;
            migrationRequired = true;
          } else {
            const unlocked = await unlockOfflineVault({
              userId: ownerId,
              credential: password,
              ...(metadata.credentialType === 'pin' ? { credentialType: 'online-password' } : {}),
            });
            if (unlocked.role !== signedInUser.role) {
              throw new Error('Offline access must be refreshed after an account role change.');
            }
            setOfflineVaultReady(true);
            setOfflineVaultNeedsUnlock(false);
            setOfflinePinRequired(ownerId, false);
            await migrateLegacyQueueSafely(ownerId, setOfflineVaultError);
          }
        } catch (error) {
          setOfflineVaultError(error.message || 'Offline authorization could not be saved on this device.');
        }
      }
      if (data.data.preferences) {
        localStorage.setItem('hs_preferences', JSON.stringify(data.data.preferences));
        window.dispatchEvent(new CustomEvent('healthsync:preferences-updated', { detail: data.data.preferences }));
      }
      setToken(data.data.token);
      setUser(data.data.user);
      return {
        success: true,
        user: data.data.user,
        mustChangePassword: Boolean(data.data.user?.must_change_password),
        offlineVaultMigrationRequired: migrationRequired,
      };
    }
    return { success: false, message: data ? data.message : 'Login failed' };
  };

  const logout = useCallback(async ({ skipServer = false } = {}) => {
    lockOfflineVault();
    setOfflineVaultReady(false);
    setOfflineVaultNeedsUnlock(false);
    setOfflineVaultMigrationRequired(false);
    pendingOnlinePassword.current = null;
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
      .then((status) => {
        if (typeof status?.pinEnrolled === 'boolean' &&
            typeof status?.accountPinEnrolled === 'boolean' &&
            (status.pinEnrolled !== user.offline_pin_enrolled ||
              status.accountPinEnrolled !== user.offline_account_pin_enrolled)) {
          updateUser({
            ...user,
            offline_pin_enrolled: status.pinEnrolled,
            offline_account_pin_enrolled: status.accountPinEnrolled,
          });
        }
        return true;
      })
      .catch((error) => {
        const errorCode = error.response?.data?.errorCode;
        const confirmedRevocation = ['DEVICE_REVOKED', 'ACCOUNT_DEACTIVATED'].includes(errorCode);
        const localIdentityFailure = ['OFFLINE_DEVICE_IDENTITY_MISSING', 'OFFLINE_DEVICE_IDENTITY_MISMATCH']
          .includes(error.code);
        const transientServerFailure = !error.response ||
          Number(error.response.status) >= 500 ||
          [408, 429].includes(Number(error.response.status));
        if (confirmedRevocation || localIdentityFailure || !transientServerFailure) {
          lockOfflineVault(user.user_id);
          setOfflineVaultReady(false);
          if (!errorCode) setOfflineVaultError(error.message || 'Device authorization could not be verified.');
          return false;
        }
        setOfflineVaultError('The server could not confirm this device right now. Local PIN unlock remains available; synchronization will resume when the server is available.');
        if (!isOfflineVaultUnlocked(user.user_id)) setOfflineVaultNeedsUnlock(true);
        return true;
      })
      .finally(() => { authorizationCheckInFlight.current = null; });
    authorizationCheckInFlight.current = request;
    return request;
  }, [updateUser, user]);

  const unlockOfflineAccess = useCallback(async (credential, onlinePassword) => {
    const ownerId = user?.user_id;
    const grant = getOfflineSession();
    if (ownerId === undefined || ownerId === null || user?.must_change_password ||
        user?.offline_pin_setup_required ||
        !grant || String(grant.userId) !== String(ownerId) || grant.role !== user.role ||
        grant.deviceId !== user.device_id ||
        grant.deviceId !== localStorage.getItem('hs_offline_device_id')) {
      throw new Error('Offline authorization is unavailable for this account and device. Reconnect and sign in online.');
    }
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const authorized = await checkOnlineDeviceAuthorization();
      if (!authorized) throw new Error('Device authorization could not be verified. Reconnect and try again.');
    }
    try {
      const vaultMetadata = await getOfflineVaultMetadata(ownerId);
      if (vaultMetadata && vaultMetadata.credentialType !== 'pin') {
        throw new Error('This device’s offline vault is password-protected, not PIN-protected. Sign out and sign in online with your account password. Encrypted queued changes will be preserved.');
      }
      const metadata = await unlockOfflineVault({ userId: ownerId, credential, credentialType: 'pin' });
      if (metadata.role !== grant.role || metadata.role !== user.role) {
        throw new Error('Offline authorization does not match this account role. Reconnect and sign in online.');
      }
      const passwordToWrap = onlinePassword || pendingOnlinePassword.current;
      if (passwordToWrap && metadata.credentialType === 'pin') {
        await addOfflineVaultPasswordWrapper({ userId: ownerId, credential: passwordToWrap });
        pendingOnlinePassword.current = null;
        setOfflineVaultMigrationRequired(false);
      }
      setOfflineVaultReady(true);
      setOfflineVaultNeedsUnlock(false);
      setOfflineVaultError(null);
      setOfflinePinRequired(ownerId, false);
      await migrateLegacyQueueSafely(ownerId, setOfflineVaultError);
      return true;
    } catch (error) {
      lockOfflineVault(ownerId);
      setOfflineVaultReady(false);
      setOfflineVaultNeedsUnlock(true);
      throw error;
    }
  }, [checkOnlineDeviceAuthorization, user]);

  const lockOfflineAccess = useCallback(({ broadcast = true, requirePin = false } = {}) => {
    if (user?.user_id !== undefined) {
      if (requirePin) setOfflinePinRequired(user.user_id, true);
      const wasUnlocked = isOfflineVaultUnlocked(user.user_id);
      lockOfflineVault(user.user_id);
      if (wasUnlocked) setOfflineVaultNeedsUnlock(true);
    }
    pendingOnlinePassword.current = null;
    setOfflineVaultReady(false);
    if (broadcast && typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('healthsync-session');
      channel.postMessage({ type: 'lock', requirePin });
      channel.close();
    }
  }, [user]);

  const lockForAccountSwitch = useCallback(() => {
    lockOfflineVault();
    setOfflineVaultReady(false);
    setOfflineVaultNeedsUnlock(false);
    setOfflineVaultMigrationRequired(false);
    pendingOnlinePassword.current = null;
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

  const completePasswordChange = useCallback(async (nextToken, nextUser, pin, onlinePassword) => {
    let migrationPending = false;
    setOfflineVaultReady(false);
    setOfflineVaultError(null);
    setAuth(nextToken, nextUser);
    setToken(nextToken);
    setUser(nextUser);
    const passwordForWrapper = onlinePassword || pendingOnlinePassword.current;
    if (!nextUser?.offline_pin_setup_required) {
      if (nextUser?.offline_pin_enrolled) {
        if (!getOfflineSession()) {
          createOfflineSession({ userId: nextUser.user_id, role: nextUser.role, deviceId: nextUser.device_id });
        }
        const ownerId = nextUser?.user_id;
        const metadata = ownerId === undefined ? null : await getOfflineVaultMetadata(ownerId);
        if (metadata?.credentialType === 'pin' && passwordForWrapper && isOfflineVaultUnlocked(ownerId)) {
          await addOfflineVaultPasswordWrapper({ userId: ownerId, credential: passwordForWrapper });
          setOfflineVaultReady(true);
          setOfflineVaultNeedsUnlock(false);
          await migrateLegacyQueueSafely(ownerId, setOfflineVaultError);
        } else if (metadata?.credentialType === 'password' && passwordForWrapper && isOfflineVaultUnlocked(ownerId)) {
          await changeOfflineVaultCredential({
            userId: ownerId,
            credential: passwordForWrapper,
            credentialType: 'password',
          });
          setOfflineVaultReady(true);
          setOfflineVaultNeedsUnlock(false);
          await migrateLegacyQueueSafely(ownerId, setOfflineVaultError);
        } else if (metadata?.credentialType === 'pin' && passwordForWrapper && !metadata.hasOnlinePasswordWrapper) {
          pendingOnlinePassword.current = passwordForWrapper;
          setOfflineVaultNeedsUnlock(true);
          setOfflineVaultMigrationRequired(true);
          migrationPending = true;
        } else {
          setOfflineVaultNeedsUnlock(Boolean(metadata && !isOfflineVaultUnlocked(ownerId)));
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
              credential: passwordForWrapper || pin,
              credentialType: 'password',
            });
          } finally {
            if (!hadGrant) clearOfflineSession();
            lockOfflineVault(ownerId);
          }
        }
      }
      if (!migrationPending) pendingOnlinePassword.current = null;
      if (isOfflineVaultUnlocked(nextUser.user_id)) setOfflinePinRequired(nextUser.user_id, false);
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
          if (!passwordForWrapper) {
            throw new Error('Existing offline data is locked. Sign in with the current account password and retry PIN setup.');
          }
          await unlockOfflineVault({ userId: ownerId, credential: passwordForWrapper });
        }
        updated = await changeOfflineVaultCredential({ userId: ownerId, credential: pin, credentialType: 'pin' });
      } else {
        updated = await createOfflineVault({
          userId: ownerId,
          role: nextUser.role,
          credential: pin,
          credentialType: 'pin',
          ...(passwordForWrapper ? { onlinePassword: passwordForWrapper } : {}),
        });
      }
      if (passwordForWrapper && metadata && !metadata.hasOnlinePasswordWrapper) {
        await addOfflineVaultPasswordWrapper({ userId: ownerId, credential: passwordForWrapper });
      }
      if (updated.role !== nextUser.role) throw new Error('Offline access must be refreshed after an account role change.');
      const response = await api.post('/auth/complete-offline-setup', { pin });
      if (!response.data?.success) throw new Error(response.data?.message || 'Unable to save PIN enrollment.');
      const completedUser = {
        ...nextUser,
        offline_pin_enrolled: true,
        offline_account_pin_enrolled: true,
        offline_pin_setup_required: false,
      };
      setAuth(nextToken, completedUser);
      setUser(completedUser);
      setOfflineVaultReady(true);
      setOfflineVaultNeedsUnlock(false);
      setOfflineVaultMigrationRequired(false);
      pendingOnlinePassword.current = null;
      await migrateLegacyQueueSafely(ownerId, setOfflineVaultError);
      return true;
    } catch (error) {
      if (nextUser?.user_id !== undefined) lockOfflineVault(nextUser.user_id);
      setOfflineVaultReady(false);
      setOfflineVaultNeedsUnlock(true);
      setOfflineVaultError(error.message || 'PIN setup could not be completed. Retry setup before using HealthSync.');
      return false;
    }
  }, []);

  return (
    <AuthContext.Provider value={{
      user, token, login, logout, updateUser, completePasswordChange, loading,
      offlineVaultReady, offlineVaultNeedsUnlock, offlineVaultMigrationRequired,
      offlineVaultError, unlockOfflineAccess, lockOfflineAccess,
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
