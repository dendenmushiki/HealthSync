import React, { createContext, useState, useEffect, useCallback } from 'react';
import { login as apiLogin, setAuth, logout as apiLogout, getAuth } from '../services/auth/authService';
import { clearOfflineSession, createOfflineSession, getOfflineSession } from '../services/offline/offlineSessionService';
import {
  changeOfflineVaultCredential,
  createOfflineVault,
  getOfflineVaultMetadata,
  lockOfflineVault,
  unlockOfflineVault,
} from '../services/offline/offlineVaultService';
import { migrateLegacyQueue } from '../services/offline/offlineQueueService';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [offlineVaultReady, setOfflineVaultReady] = useState(false);
  const [offlineVaultError, setOfflineVaultError] = useState(null);

  useEffect(() => {
    const stored = getAuth();
    if (stored && stored.token) {
      setToken(stored.token);
      setUser(stored.user);
    }
    setLoading(false);
  }, []);

  const login = async (username, password) => {
    lockOfflineVault();
    clearOfflineSession();
    setOfflineVaultReady(false);
    setOfflineVaultError(null);
    const data = await apiLogin(username, password);
    if (data && data.success) {
      const signedInUser = data.data.user;
      setAuth(data.data.token, signedInUser);
      if (signedInUser?.must_change_password) {
        clearOfflineSession();
        try {
          const ownerId = signedInUser?.user_id;
          if (ownerId === undefined || ownerId === null) {
            throw new Error('The signed-in account is missing its account identifier.');
          }
          const metadata = await getOfflineVaultMetadata(ownerId);
          if (metadata) {
            const unlocked = await unlockOfflineVault({ userId: ownerId, credential: password });
            if (unlocked.role !== signedInUser.role) {
              throw new Error('Offline access must be refreshed after an account role change.');
            }
          }
        } catch {
          if (signedInUser?.user_id !== undefined) lockOfflineVault(signedInUser.user_id);
          setOfflineVaultError('Existing offline data could not be prepared for the required password change.');
        }
      } else {
        try {
          const ownerId = signedInUser?.user_id;
          if (ownerId === undefined || ownerId === null) {
            throw new Error('The signed-in account is missing its account identifier.');
          }
          const metadata = await getOfflineVaultMetadata(ownerId);
          const unlocked = metadata
            ? await unlockOfflineVault({ userId: ownerId, credential: password })
            : await createOfflineVault({ userId: ownerId, role: signedInUser.role, credential: password });
          if (unlocked.role !== signedInUser.role) {
            throw new Error('Offline access must be refreshed after an account role change.');
          }
          createOfflineSession({ userId: ownerId, role: signedInUser.role });
          setOfflineVaultReady(true);
          await migrateLegacyQueueSafely(ownerId, setOfflineVaultError);
        } catch {
          if (signedInUser?.user_id !== undefined) lockOfflineVault(signedInUser.user_id);
          clearOfflineSession();
          setOfflineVaultError('Secure offline data could not be unlocked. Continue online; cached offline data is unavailable.');
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
    try {
      if (skipServer) {
        localStorage.removeItem('hs_token');
        localStorage.removeItem('hs_user');
      } else {
        await apiLogout();
      }
    } catch (error) {
      console.error('Unable to revoke the server-side session during logout.', error);
    } finally {
      lockOfflineVault();
      clearOfflineSession();
      setOfflineVaultReady(false);
      setOfflineVaultError(null);
      localStorage.setItem('hs_session_ended', String(Date.now()));
      setUser(null);
      setToken(null);
    }
  }, []);

  const updateUser = useCallback((nextUser) => {
    setUser(nextUser);
    const stored = getAuth();
    if (stored && stored.token) setAuth(stored.token, nextUser);
  }, []);

  const unlockOfflineAccess = useCallback(async (credential) => {
    const ownerId = user?.user_id;
    const grant = getOfflineSession();
    if (ownerId === undefined || ownerId === null || user?.must_change_password ||
        !grant || String(grant.userId) !== String(ownerId) || grant.role !== user.role) {
      throw new Error('Offline authorization is unavailable or expired. Reconnect and sign in online.');
    }
    const metadata = await unlockOfflineVault({ userId: ownerId, credential });
    if (metadata.role !== grant.role || metadata.role !== user.role) {
      lockOfflineVault(ownerId);
      throw new Error('Offline authorization does not match this account role. Reconnect and sign in online.');
    }
    setOfflineVaultReady(true);
    setOfflineVaultError(null);
    return true;
  }, [user]);

  const lockOfflineAccess = useCallback(() => {
    if (user?.user_id !== undefined) lockOfflineVault(user.user_id);
    setOfflineVaultReady(false);
  }, [user]);

  const completePasswordChange = useCallback(async (nextToken, nextUser, newPassword) => {
    setOfflineVaultReady(false);
    setOfflineVaultError(null);
    let vaultReady = false;
    try {
      const ownerId = nextUser?.user_id;
      if (ownerId === undefined || ownerId === null) throw new Error('The signed-in account is missing its account identifier.');
      createOfflineSession({ userId: ownerId, role: nextUser.role });
      const metadata = await getOfflineVaultMetadata(ownerId);
      const updated = metadata
        ? await changeOfflineVaultCredential({ userId: ownerId, credential: newPassword })
        : await createOfflineVault({ userId: ownerId, role: nextUser.role, credential: newPassword });
      if (updated.role !== nextUser.role) throw new Error('Offline access must be refreshed after an account role change.');
      setOfflineVaultReady(true);
      vaultReady = true;
      await migrateLegacyQueueSafely(ownerId, setOfflineVaultError);
    } catch {
      if (nextUser?.user_id !== undefined) lockOfflineVault(nextUser.user_id);
      clearOfflineSession();
      setOfflineVaultError('Secure offline data could not be prepared. Continue online; cached offline data is unavailable.');
    }
    setAuth(nextToken, nextUser);
    setToken(nextToken);
    setUser(nextUser);
    return vaultReady;
  }, []);

  return (
    <AuthContext.Provider value={{
      user, token, login, logout, updateUser, completePasswordChange, loading,
      offlineVaultReady, offlineVaultError, unlockOfflineAccess, lockOfflineAccess,
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
