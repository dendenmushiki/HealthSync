import React, { createContext, useState, useEffect, useCallback } from 'react';
import { login as apiLogin, setAuth, logout as apiLogout, getAuth } from '../services/auth/authService';
import { clearOfflineSession } from '../services/offline/offlineSessionService';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = getAuth();
    if (stored && stored.token) {
      setToken(stored.token);
      setUser(stored.user);
    }
    setLoading(false);
  }, []);

  const login = async (username, password) => {
    const data = await apiLogin(username, password);
    if (data && data.success) {
      if (data.data.user?.must_change_password) clearOfflineSession();
      setAuth(data.data.token, data.data.user);
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

  const completePasswordChange = useCallback((nextToken, nextUser) => {
    setAuth(nextToken, nextUser);
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, updateUser, completePasswordChange, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
