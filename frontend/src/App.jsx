import React, { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AuthProvider, AuthContext } from './context/AuthContext';
import LoginPage from './pages/auth/LoginPage';
import ForcePasswordChangePage from './pages/auth/ForcePasswordChangePage';
import ProtectedRoute from './components/layout/ProtectedRoute';
import OfflineSyncCoordinator from './components/common/OfflineSyncCoordinator';
import ResidentsPage from './pages/residents/ResidentsPage';
import ResidentForm from './pages/residents/ResidentForm';
import ResidentDetails from './pages/residents/ResidentDetails';
import ResidentMedicalRecords from './pages/residents/ResidentMedicalRecords';
import DashboardPage from './pages/dashboard/DashboardPage';
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import AdminSettingsPage from './pages/admin/AdminSettingsPage';
import HealthRecordsPage from './pages/health-records/HealthRecordsPage';
import HealthRecordDetailPage from './pages/health-records/HealthRecordDetailPage';
import ClinicalRecordsPage from './pages/health-records/ClinicalRecordsPage';
import ChildHealthPage from './pages/child-health/ChildHealthPage';
import NutritionPage from './pages/nutrition/NutritionPage';
import SeniorRegistryPage from './pages/senior-citizens/SeniorRegistryPage';
import AuditLogsPage from './pages/audit/AuditLogsPage';
import UserManagementPage from './pages/users/UserManagementPage';
import RoleGuard from './components/layout/RoleGuard';
import SyncStatus from './pages/SyncStatus';
import ReportsPage from './pages/reports/ReportsPage';
import { getProfilePhotoUrl } from './utils/profilePhoto';
import useSyncStatus from './services/offline/useSyncStatus';
import { getOfflineSession } from './services/offline/offlineSessionService';
import './App.css';
import './nutrition.css';
import './pages/dashboard/Dashboard.css';

const NotAuthorized = () => (
  <div className="container mt-4"><h3>Not authorized</h3><p>You do not have permission to view this page.</p></div>
);

const LegacyMedicalRecordRedirect = ({ recordType }) => {
  const { id } = useParams();
  return <Navigate to={`/residents/${id}/medical-records/${recordType}`} replace />;
};

const LegacyHealthRecordDetailRedirect = () => {
  const { sourceTable, recordId } = useParams();
  const location = useLocation();
  const type = {
    health_records: 'clinical',
    patient_clinical_records: 'clinical',
    child_health_records: 'child',
    child_records: 'child',
    maternal_records: 'maternal',
    immunization_records: 'immunization'
  }[sourceTable];
  if (!type) return <Navigate to="/health-records" replace />;
  return <Navigate to={`/health-records/${type}/${encodeURIComponent(`${sourceTable}-${recordId}`)}`} replace state={location.state} />;
};

const SidebarIcon = ({ name }) => {
  const paths = {
    dashboard: 'M3 3h8v8H3z M13 3h8v5h-8z M13 10h8v11h-8z M3 13h8v8H3z',
    residents: 'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 8v6 M23 11h-6',
    senior: 'M12 14l-4 7 1-5-5-1 5-3-1-5 4 3 4-3-1 5 5 3-5 1 1 5z M12 14V3',
    records: 'M8 4h11a2 2 0 0 1 2 2v14H8a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z M5 7a3 3 0 0 1 3-3 M10 9h7 M10 13h7 M10 17h5',
    nutrition: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z M3 12h4l2-3 3 6 2-3h7',
    reports: 'M4 19V5 M4 19h17 M8 16v-5 M12 16V8 M16 16v-8 M20 16V4',
    sync: 'M20 7h-5V2 M4 17h5v5 M5.6 9A7 7 0 0 1 18 5l2 2 M4 17l2 2a7 7 0 0 0 12.4-4',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 2.9-.2-.1a1.7 1.7 0 0 0-1.8.2l-.1.1h-3.4l-.1-.2a1.7 1.7 0 0 0-1.6-1l-.2.1-2.9-1.7.1-.2a1.7 1.7 0 0 0-.2-1.8L7.6 15v-3.4l.2-.1a1.7 1.7 0 0 0 1-1.6l-.1-.2 1.7-2.9.2.1a1.7 1.7 0 0 0 1.8-.2l.1-.1h3.4l.1.2a1.7 1.7 0 0 0 1.6 1l.2-.1 2.9 1.7-.1.2a1.7 1.7 0 0 0 .2 1.8l.1.1V15z',
    users: 'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8',
    audit: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
    logout: 'M10 17l5-5-5-5 M15 12H3 M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6'
  };
  return <svg className="healthsync-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.dashboard} /></svg>;
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <ThemePreferenceManager />
        <AppContent />
      </Router>
    </AuthProvider>
  );
}

function ThemePreferenceManager() {
  useLayoutEffect(() => {
    const applyTheme = (preferences = {}) => {
      const theme = preferences.theme || 'system';
      const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
      const scales = { small: '0.875', default: '1', large: '1.125', 'extra-large': '1.25' };
      document.documentElement.dataset.theme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
      document.documentElement.dataset.themePreference = theme;
      document.documentElement.dataset.textSize = preferences.textSize || 'default';
      document.documentElement.style.setProperty('--hs-font-scale', scales[preferences.textSize] || scales.default);
    };
    const readPreferences = () => {
      try {
        applyTheme(JSON.parse(localStorage.getItem('hs_preferences') || '{}'));
      } catch (error) {
        applyTheme();
      }
    };
    const mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
    const handleSystemTheme = () => {
      if (document.documentElement.dataset.themePreference === 'system') readPreferences();
    };
    const handlePreferenceUpdate = (event) => {
      if (event.detail) applyTheme(event.detail);
    };
    const handleStorage = (event) => {
      if (event.key === 'hs_preferences') readPreferences();
    };
    readPreferences();
    mediaQuery?.addEventListener?.('change', handleSystemTheme);
    window.addEventListener('healthsync:preferences-updated', handlePreferenceUpdate);
    window.addEventListener('storage', handleStorage);
    return () => {
      mediaQuery?.removeEventListener?.('change', handleSystemTheme);
      window.removeEventListener('healthsync:preferences-updated', handlePreferenceUpdate);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  return null;
}

function AppContent() {
  const location = useLocation();
  const {
    user, loading, updateUser, offlineVaultReady, unlockOfflineAccess,
    sessionCleanupError,
  } = useContext(AuthContext);
  const isLoginRoute = location.pathname === '/login';
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  useEffect(() => {
    const updateNetworkState = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateNetworkState);
    window.addEventListener('offline', updateNetworkState);
    return () => {
      window.removeEventListener('online', updateNetworkState);
      window.removeEventListener('offline', updateNetworkState);
    };
  }, []);

  const offlineGrant = getOfflineSession();
  const offlineAuthorized = Boolean(offlineGrant && user &&
    String(offlineGrant.userId) === String(user.user_id) &&
    offlineGrant.role === user.role &&
    offlineGrant.deviceId === localStorage.getItem('hs_offline_device_id') &&
    user.offline_pin_enrolled && !user.must_change_password && !user.offline_pin_setup_required);

  useEffect(() => {
    const requirePasswordChange = () => {
      if (user && !user.must_change_password) updateUser({ ...user, must_change_password: true });
    };
    window.addEventListener('healthsync:password-change-required', requirePasswordChange);
    return () => window.removeEventListener('healthsync:password-change-required', requirePasswordChange);
  }, [updateUser, user]);

  if (loading) return null;
  if (sessionCleanupError) return <main className="container py-5"><div className="alert alert-danger" role="alert">{sessionCleanupError}</div></main>;
  if (location.pathname === '/change-password') {
    return user ? <ForcePasswordChangePage /> : <Navigate to="/login" replace />;
  }
  if (user?.must_change_password || user?.offline_pin_setup_required) {
    return <Navigate to="/change-password" replace />;
  }
  if (user && offlineAuthorized && !offlineVaultReady) {
    return <OfflineUnlockScreen user={user} unlockOfflineAccess={unlockOfflineAccess} online={online} />;
  }
  if (user && !online && (!offlineAuthorized || !offlineVaultReady)) {
    return <OfflineUnlockScreen user={user} unlockOfflineAccess={unlockOfflineAccess} online={online} />;
  }

  if (isLoginRoute) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return <><InactivityLockManager /><AppShell /></>;
}

function OfflineUnlockScreen({ user, unlockOfflineAccess, online }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const grant = getOfflineSession();
  const authorized = user.offline_pin_enrolled && !user.must_change_password &&
    !user.offline_pin_setup_required && grant &&
    String(grant.userId) === String(user.user_id) && grant.role === user.role &&
    grant.deviceId === localStorage.getItem('hs_offline_device_id');

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await unlockOfflineAccess(pin);
      setPin('');
    } catch (unlockError) {
      setError(unlockError.message || 'Unable to unlock secure offline data.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="container py-5">
      <section className="card mx-auto p-4" style={{ maxWidth: 480 }} aria-labelledby="offline-unlock-title">
        <h1 id="offline-unlock-title" className="h3">Unlock offline access</h1>
        {authorized ? (
          <>
            <p>Enter your six-digit PIN to unlock this device’s encrypted offline data. The offline authorization is device-bound and is not an API token.</p>
            {error && <div className="alert alert-danger" role="alert">{error}</div>}
            <form onSubmit={submit}>
              <label className="form-label" htmlFor="offline-account-pin">Six-digit PIN</label>
              <input
                id="offline-account-pin"
                className="form-control mb-3"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                pattern="[0-9]{6}"
                maxLength={6}
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                required
              />
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? 'Unlocking…' : 'Unlock HealthSync'}
              </button>
            </form>
          </>
        ) : (
          <div className="alert alert-warning mb-0" role="status">
            {online
              ? 'Offline access is not prepared for this device. Sign in online and set up your six-digit PIN in Settings → Security.'
              : 'Offline authorization is unavailable for this account or device. Reconnect and sign in online, then set up a PIN before using offline data.'}
          </div>
        )}
      </section>
    </main>
  );
}

function InactivityLockManager() {
  const { user, offlineVaultReady, lockOfflineAccess } = useContext(AuthContext);
  const [countdown, setCountdown] = useState(null);
  const resetTimerRef = useRef(() => {});

  useEffect(() => {
    if (!user || !offlineVaultReady) return undefined;
    let idleTimer;
    const resetTimer = () => {
      window.clearTimeout(idleTimer);
      setCountdown(null);
      idleTimer = window.setTimeout(() => setCountdown(20), 5 * 60 * 1000);
    };
    resetTimerRef.current = resetTimer;
    const activityEvents = ['pointerdown', 'keydown', 'touchstart', 'click'];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, resetTimer, { passive: true }));
    window.addEventListener('pagehide', lockOfflineAccess);
    resetTimer();
    return () => {
      window.clearTimeout(idleTimer);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, resetTimer));
      window.removeEventListener('pagehide', lockOfflineAccess);
    };
  }, [lockOfflineAccess, offlineVaultReady, user]);

  useEffect(() => {
    if (countdown === null) return undefined;
    if (countdown <= 0) {
      lockOfflineAccess();
      setCountdown(null);
      return undefined;
    }
    const timer = window.setTimeout(() => setCountdown((remaining) => remaining - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown, lockOfflineAccess]);

  if (countdown === null) return null;
  return (
    <div className="modal d-block" role="alertdialog" aria-modal="true" aria-labelledby="idle-lock-title">
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content p-4">
          <h2 id="idle-lock-title" className="h5">HealthSync will lock soon</h2>
          <p>For your privacy, HealthSync will lock in {countdown} seconds. Continue working to keep your session open.</p>
          <button type="button" className="btn btn-primary" onClick={() => resetTimerRef.current()}>
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
}

function SessionSyncGuard() {
  const { user, logout, lockOfflineAccess, lockForAccountSwitch } = useContext(AuthContext);
  const navigate = useNavigate();
  const userId = user?.user_id;

  useEffect(() => {
    if (!userId) return undefined;
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('healthsync-session') : null;
    const handleStorage = (event) => {
      if (event.key === 'hs_session_ended' && event.newValue) {
        lockForAccountSwitch();
        navigate('/login', { replace: true });
      }
    };
    const handleChannel = (event) => {
      if (event.data?.type === 'logout') {
        lockForAccountSwitch();
        navigate('/login', { replace: true });
      } else if (event.data?.type === 'lock') {
        lockOfflineAccess({ broadcast: false });
      } else if (event.data?.type === 'account-switch') {
        lockForAccountSwitch();
      }
    };
    window.addEventListener('storage', handleStorage);
    channel?.addEventListener('message', handleChannel);
    return () => {
      window.removeEventListener('storage', handleStorage);
      channel?.removeEventListener('message', handleChannel);
      channel?.close();
    };
  }, [lockForAccountSwitch, lockOfflineAccess, navigate, userId]);
  return null;
}

export default App;

function AppShell() {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [profilePhotoLoadError, setProfilePhotoLoadError] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationPreferences, setNotificationPreferences] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('hs_preferences') || '{}').notifications || {};
    } catch (error) {
      return {};
    }
  });
  const menuButtonRef = useRef(null);
  const sidebarRef = useRef(null);
  const isAdmin = user?.role === 'admin';
  const isOfficial = user?.role === 'official' || user?.role === 'barangay_official';
  const closeNavigation = useCallback(() => setNavigationOpen(false), []);
  const syncHeaderState = useSyncStatus();

  useEffect(() => {
    setProfilePhotoLoadError(false);
  }, [user?.profile_photo]);

  useEffect(() => {
    if (!user?.user_id) return;
    try {
      const storedNotifications = JSON.parse(localStorage.getItem(`hs_notifications_${user.user_id}`) || '[]');
      setNotifications(Array.isArray(storedNotifications) ? storedNotifications : []);
      const cached = JSON.parse(localStorage.getItem('hs_preferences') || '{}');
      setNotificationPreferences(cached.notifications || {});
    } catch (error) {
      setNotifications([]);
    }
  }, [user?.user_id]);

  useEffect(() => {
    if (user?.user_id) {
      localStorage.setItem(`hs_notifications_${user.user_id}`, JSON.stringify(notifications.slice(0, 20)));
    }
  }, [notifications, user?.user_id]);

  useEffect(() => {
    const handleOfflineQueue = (event) => navigate('/sync-status', { state: { queuedOperationId: event.detail?.offlineOperationId } });
    const handleOfflineNotification = () => handleNotification({
      detail: {
        category: 'offlineSyncAlerts',
        title: 'Changes queued for sync',
        description: 'Your changes are saved on this device and will synchronize when online.',
        id: `offline-${Date.now()}`,
        createdAt: new Date().toISOString(),
      },
    });
    const handleNotification = (event) => {
      const notification = event.detail;
      if (!user?.user_id || !notification?.category || notificationPreferences[notification.category] === false) return;
      setNotifications((current) => [{ ...notification, read: false }, ...current].slice(0, 20));
    };
    const handlePreferenceUpdate = (event) => {
      if (event.detail?.notifications) setNotificationPreferences(event.detail.notifications);
    };
    window.addEventListener('healthsync:offline-queued', handleOfflineQueue);
    window.addEventListener('healthsync:offline-queued', handleOfflineNotification);
    window.addEventListener('healthsync:notification', handleNotification);
    window.addEventListener('healthsync:preferences-updated', handlePreferenceUpdate);
    return () => {
      window.removeEventListener('healthsync:offline-queued', handleOfflineQueue);
      window.removeEventListener('healthsync:offline-queued', handleOfflineNotification);
      window.removeEventListener('healthsync:notification', handleNotification);
      window.removeEventListener('healthsync:preferences-updated', handlePreferenceUpdate);
    };
  }, [navigate, notificationPreferences, user?.user_id]);

  useEffect(() => {
    if (!user?.user_id || navigator.onLine || notificationPreferences.offlineSyncAlerts === false) return;
    setNotifications((current) => current.some((item) => item.id === 'offline-current')
      ? current
      : [{ id: 'offline-current', category: 'offlineSyncAlerts', title: 'You are offline', description: 'Changes will synchronize when a connection is available.', createdAt: new Date().toISOString(), read: false }, ...current].slice(0, 20));
  }, [notificationPreferences.offlineSyncAlerts, user?.user_id]);

  useEffect(() => {
    setNavigationOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navigationOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    const menuButton = menuButtonRef.current;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeNavigation();
        return;
      }

      if (event.key === 'Tab') {
        const focusableItems = sidebarRef.current?.querySelectorAll('a[href], button:not(:disabled)');
        if (!focusableItems?.length) return;
        const firstItem = focusableItems[0];
        const lastItem = focusableItems[focusableItems.length - 1];

        if (event.shiftKey && (document.activeElement === firstItem || !sidebarRef.current.contains(document.activeElement))) {
          event.preventDefault();
          lastItem.focus();
        } else if (!event.shiftKey && (document.activeElement === lastItem || !sidebarRef.current.contains(document.activeElement))) {
          event.preventDefault();
          firstItem.focus();
        }
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    const focusFrame = window.requestAnimationFrame(() => sidebarRef.current?.querySelector('a, button')?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      window.cancelAnimationFrame(focusFrame);
      menuButton?.focus();
    };
  }, [closeNavigation, navigationOpen]);

  const navGroups = isAdmin
    ? [
        { title: null, items: [{ to: '/admin-dashboard', label: 'Dashboard', icon: 'dashboard' }] },
        { title: 'System', items: [
          { to: '/users', label: 'Users', icon: 'users' },
          { to: '/audit-logs', label: 'Audit Logs', icon: 'audit' },
          { to: '/admin-settings', label: 'Settings', icon: 'settings' }
        ] }
      ]
    : isOfficial
      ? [
          { title: null, items: [{ to: '/dashboard', label: 'Dashboard', icon: 'dashboard' }] },
          { title: 'Monitoring', items: [
            { to: '/nutrition', label: 'Nutritional Monitoring', icon: 'nutrition' },
            { to: '/reports', label: 'Reports', icon: 'reports' }
          ] },
          { title: 'System', items: [{ to: '/admin-settings', label: 'Settings', icon: 'settings' }] }
        ]
      : [
          { title: null, items: [{ to: '/dashboard', label: 'Dashboard', icon: 'dashboard' }] },
          { title: 'Resident Management', items: [
            { to: '/residents', label: 'Residents', icon: 'residents' },
            { to: '/senior-citizens', label: 'Senior Registry', icon: 'senior' },
            { to: '/health-records', label: 'Health Records', icon: 'records' }
          ] },
          { title: 'Monitoring', items: [
            { to: '/nutrition', label: 'Nutritional Monitoring', icon: 'nutrition' },
            { to: '/reports', label: 'Reports', icon: 'reports' }
          ] },
          { title: 'System', items: [
            { to: '/sync-status', label: 'Sync Status', icon: 'sync' },
            { to: '/admin-settings', label: 'Settings', icon: 'settings' }
          ] }
        ];

  return (
    <div className="healthsync-shell">
      {navigationOpen && <button type="button" className="healthsync-drawer-backdrop" aria-label="Close navigation menu" onClick={closeNavigation} />}
      <aside ref={sidebarRef} className={`healthsync-sidebar ${navigationOpen ? 'is-open' : ''}`} id="healthsync-navigation">
        <div className="healthsync-brand">
          <div className="healthsync-brand-mark">
            <img src="/images/healthsynclogo.png" alt="HealthSync logo" />
          </div>
          <div><div className="healthsync-brand-name">HealthSync</div><small>Community Care</small></div>
        </div>
        <nav className="healthsync-nav" aria-label="Main navigation">
          {navGroups.map((group, groupIndex) => <div className={`healthsync-nav-group ${group.title === 'System' ? 'healthsync-nav-group-system' : ''}`} key={group.title || `main-${groupIndex}`}>
            {group.title && <h2 className="healthsync-nav-group-title">{group.title}</h2>}
            {group.items.map((item) => <NavLink key={item.to} to={item.to} onClick={closeNavigation} className={({ isActive }) => `healthsync-nav-link ${isActive ? 'active' : ''}`}><SidebarIcon name={item.icon} /><span>{item.label}</span>{item.to === '/sync-status' && syncHeaderState.waiting > 0 && <span className="healthsync-sync-badge">{syncHeaderState.waiting}</span>}</NavLink>)}
            {group.title === 'System' && <button type="button" className="healthsync-nav-link healthsync-nav-logout" onClick={() => { closeNavigation(); logout(); }}><SidebarIcon name="logout" /><span>Logout</span></button>}
          </div>)}
        </nav>
      </aside>
      <div className="healthsync-main">
        <header className="healthsync-topbar">
          <div className="healthsync-topbar-heading">
            <button ref={menuButtonRef} type="button" className="healthsync-mobile-menu" aria-label={navigationOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={navigationOpen} aria-controls="healthsync-navigation" onClick={() => setNavigationOpen((open) => !open)}>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={navigationOpen ? 'M6 6l12 12M18 6L6 18' : 'M4 6h16M4 12h16M4 18h16'} /></svg>
            </button>
            <div className="healthsync-topbar-title"><span>Barangay Health Monitoring</span></div>
          </div>
          <div className="healthsync-topbar-user" aria-label={user ? `Signed in as ${user.username || user.name || 'User'}, ${user.role || 'User'}` : 'Account'}>
            {!isAdmin && <NavLink className={`healthsync-sync-chip ${syncHeaderState.online ? 'online' : 'offline'}`} to="/sync-status" title="Open sync status"><span aria-hidden="true" />{syncHeaderState.syncing ? 'Syncing' : syncHeaderState.waiting ? `${syncHeaderState.waiting} waiting` : 'Synced'}</NavLink>}
            {user && <div className="healthsync-notification-wrap">
              <button type="button" className="healthsync-notification-button" aria-label={`Notifications${notifications.some((item) => !item.read) ? `, ${notifications.filter((item) => !item.read).length} unread` : ''}`} aria-expanded={notificationsOpen} onClick={() => { setNotificationsOpen((open) => !open); if (!notificationsOpen) setNotifications((items) => items.map((item) => ({ ...item, read: true }))); }}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
                {notifications.some((item) => !item.read) && <span className="healthsync-notification-count">{notifications.filter((item) => !item.read).length}</span>}
              </button>
              {notificationsOpen && <div className="healthsync-notification-panel" role="dialog" aria-label="Notifications">
                <div className="healthsync-notification-heading"><strong>Notifications</strong><button type="button" onClick={() => setNotificationsOpen(false)} aria-label="Close notifications">×</button></div>
                {notifications.length ? <ul>{notifications.map((item) => <li key={item.id}><strong>{item.title}</strong><span>{item.description}</span><small>{new Date(item.createdAt).toLocaleString()}</small></li>)}</ul> : <p className="healthsync-notification-empty">You’re all caught up.</p>}
              </div>}
            </div>}
            {user ? <>{user.profile_photo && !profilePhotoLoadError ? <img className="healthsync-user-avatar" src={getProfilePhotoUrl(user.profile_photo)} alt="" onError={() => setProfilePhotoLoadError(true)} /> : <span className="healthsync-user-avatar healthsync-user-avatar-placeholder" aria-hidden="true">{(user.full_name || user.username || 'U').charAt(0).toUpperCase()}</span>}<span className="healthsync-user-name">{user.username || user.name || 'User'}</span><span className="badge bg-primary-subtle text-primary">{user.role || 'User'}</span></> : <NavLink className="btn btn-sm btn-primary" to="/login">Login</NavLink>}
          </div>
        </header>
        <div className={`healthsync-page-shell ${pathname.startsWith('/health-records') ? 'health-records-scroll-shell' : ''}`}>
          <main className={`healthsync-content-panel ${pathname.startsWith('/health-records') ? 'health-records-scroll-content' : ''}`}>
            <OfflineSyncCoordinator />
            <Routes>
              <Route path="/admin-dashboard" element={<ProtectedRoute><RoleGuard allowed={['admin']}><AdminDashboardPage /></RoleGuard></ProtectedRoute>} />
              <Route path="/admin-settings" element={<ProtectedRoute><RoleGuard allowed={['admin', 'bhw', 'official']}><AdminSettingsPage /></RoleGuard></ProtectedRoute>} />
              <Route path="/dashboard" element={<ProtectedRoute><RoleGuard allowed={['bhw', 'official']}><DashboardPage /></RoleGuard></ProtectedRoute>} />
              <Route path="/residents" element={<ProtectedRoute><RoleGuard allowed={['bhw']}><ResidentsPage /></RoleGuard></ProtectedRoute>} />
              <Route path="/residents/new" element={<ProtectedRoute><RoleGuard allowed={['bhw']}><ResidentForm /></RoleGuard></ProtectedRoute>} />
              <Route path="/residents/:id" element={<ProtectedRoute><RoleGuard allowed={['bhw']}><ResidentDetails /></RoleGuard></ProtectedRoute>} />
              <Route path="/residents/:id/medical-records" element={<ProtectedRoute><RoleGuard allowed={['bhw']}><ResidentMedicalRecords /></RoleGuard></ProtectedRoute>} />
              <Route path="/residents/:id/medical-records/:recordType" element={<ProtectedRoute><RoleGuard allowed={['bhw']}><ResidentMedicalRecords /></RoleGuard></ProtectedRoute>} />
              <Route path="/residents/:id/clinical-records-legacy" element={<ProtectedRoute><RoleGuard allowed={['bhw']}><ClinicalRecordsPage /></RoleGuard></ProtectedRoute>} />
              <Route path="/residents/:id/child-health-records-legacy" element={<ProtectedRoute><RoleGuard allowed={['bhw']}><ChildHealthPage /></RoleGuard></ProtectedRoute>} />
              <Route path="/residents/:id/edit" element={<ProtectedRoute><RoleGuard allowed={['bhw']}><ResidentForm /></RoleGuard></ProtectedRoute>} />
              <Route path="/residents/:id/clinical-records" element={<LegacyMedicalRecordRedirect recordType="clinical" />} />
              <Route path="/residents/:id/child-health" element={<LegacyMedicalRecordRedirect recordType="child" />} />
              <Route path="/health-records" element={<ProtectedRoute><RoleGuard allowed={['bhw']}><HealthRecordsPage /></RoleGuard></ProtectedRoute>} />
              <Route path="/health-records/:sourceTable/:residentId/:recordId" element={<ProtectedRoute><RoleGuard allowed={['bhw']}><LegacyHealthRecordDetailRedirect /></RoleGuard></ProtectedRoute>} />
              <Route path="/health-records/:type/:recordKey" element={<ProtectedRoute><RoleGuard allowed={['bhw']}><HealthRecordDetailPage /></RoleGuard></ProtectedRoute>} />
              <Route path="/reports" element={<ProtectedRoute><RoleGuard allowed={['bhw', 'official']} denied={['admin']}><ReportsPage /></RoleGuard></ProtectedRoute>} />
              <Route path="/nutrition" element={<ProtectedRoute><RoleGuard allowed={['bhw', 'official']}><NutritionPage /></RoleGuard></ProtectedRoute>} />
              <Route path="/operation-timbang" element={<Navigate to="/nutrition" replace />} />
              <Route path="/adolescent-bmi" element={<Navigate to="/nutrition" replace />} />
              <Route path="/adult-bmi" element={<Navigate to="/nutrition" replace />} />
              <Route path="/senior-citizens" element={<ProtectedRoute><RoleGuard allowed={['bhw']}><SeniorRegistryPage /></RoleGuard></ProtectedRoute>} />
              <Route path="/senior-citizens/new" element={<ProtectedRoute><RoleGuard allowed={['bhw']}><SeniorRegistryPage /></RoleGuard></ProtectedRoute>} />
              <Route path="/senior-citizens/:id/edit" element={<ProtectedRoute><RoleGuard allowed={['bhw']}><SeniorRegistryPage /></RoleGuard></ProtectedRoute>} />
              <Route path="/audit-logs" element={<ProtectedRoute><RoleGuard allowed={['admin']}><AuditLogsPage /></RoleGuard></ProtectedRoute>} />
              <Route path="/users" element={<ProtectedRoute><RoleGuard allowed={['admin']}><UserManagementPage /></RoleGuard></ProtectedRoute>} />
              <Route path="/sync-status" element={<ProtectedRoute><RoleGuard allowed={['bhw']}><SyncStatus /></RoleGuard></ProtectedRoute>} />
              <Route path="/not-authorized" element={<NotAuthorized />} />
              <Route path="/" element={<Navigate to={isAdmin ? '/admin-dashboard' : '/dashboard'} replace />} />
            </Routes>
          </main>
        </div>
      </div>
      <SessionSyncGuard />
    </div>
  );
}
