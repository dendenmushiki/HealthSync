import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import LoginLoadingScreen from './LoginLoadingScreen';

export const LoginTransitionContext = createContext({
  beginLoginTransition: () => {},
  reportDashboardReady: () => {},
});

export const useLoginTransition = () => useContext(LoginTransitionContext);

export function LoginTransitionProvider({ children }) {
  const [transition, setTransition] = useState(null);
  const navigate = useNavigate();
  const { logout } = useContext(AuthContext);

  const beginLoginTransition = useCallback(() => {
    try {
      if (window.sessionStorage.getItem('hs_login_intro_active') === 'true') return;
      window.sessionStorage.setItem('hs_login_intro_active', 'true');
    } catch (storageError) {
      // Session storage is optional; the in-memory transition still works.
    }
    setTransition({ ready: false, error: null });
  }, []);

  const reportDashboardReady = useCallback((error) => {
    setTransition((current) => {
      if (!current || current.ready || current.error) return current;
      return error
        ? { ...current, error: error.message || 'The dashboard could not load.' }
        : { ...current, ready: true };
    });
  }, []);

  const reportTransitionError = useCallback((message) => {
    setTransition((current) => current && !current.ready
      ? { ...current, error: message }
      : current);
  }, []);

  const finishTransition = useCallback(() => {
    setTransition(null);
    try {
      window.sessionStorage.removeItem('hs_login_intro_active');
    } catch (storageError) {
      // The transition has already finished; storage cleanup is best effort.
    }
    window.requestAnimationFrame(() => {
      document.querySelector('.healthsync-content-panel')?.focus();
    });
  }, []);

  const returnToLogin = useCallback(async () => {
    setTransition(null);
    try {
      window.sessionStorage.removeItem('hs_login_intro_active');
    } catch (storageError) {
      // The in-memory transition is still cleared.
    }
    try {
      await logout();
    } catch (logoutError) {
      console.error('Unable to finish signing out after the dashboard failed to load.', logoutError);
    } finally {
      navigate('/login', { replace: true });
    }
  }, [logout, navigate]);

  useEffect(() => {
    try {
      window.sessionStorage.removeItem('hs_login_intro_active');
    } catch (storageError) {
      // Session restore never starts an animation; no storage is required.
    }
  }, []);

  return (
    <LoginTransitionContext.Provider value={{
      beginLoginTransition,
      reportDashboardReady,
    }}>
      <div inert={Boolean(transition)} aria-hidden={Boolean(transition)}>
        {children}
      </div>
      {transition && (
        <LoginLoadingScreen
          ready={transition.ready}
          error={transition.error}
          onError={reportTransitionError}
          onExit={finishTransition}
          onBackToLogin={returnToLogin}
        />
      )}
    </LoginTransitionContext.Provider>
  );
}
