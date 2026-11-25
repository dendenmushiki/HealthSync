import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { AppContent } from './App.jsx';
import DashboardPage from './pages/dashboard/DashboardPage';
import api from './services/api/apiClient';
import { AuthContext } from './context/AuthContext';

jest.mock('./services/api/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
  },
}));

jest.mock('./services/offline/indexedDbService', () => ({
  __esModule: true,
  default: {
    getAllFromStore: jest.fn().mockResolvedValue([]),
    getFromStore: jest.fn().mockResolvedValue(undefined),
    putToStore: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('./services/offline/useSyncStatus', () => ({
  __esModule: true,
  default: () => {
    const React = require('react');
    const refresh = React.useCallback(() => Promise.resolve(), []);
    return {
      pending: 0,
      failed: 0,
      waiting: 0,
      syncing: false,
      signInRequired: false,
      error: null,
      connectivity: { state: 'online', lastChecked: null, lastError: null },
      checkNow: React.useCallback(() => Promise.resolve(true), []),
      online: true,
      dashboardRequestFailed: false,
      setDashboardRequestFailed: jest.fn(),
      refresh,
    };
  },
  SyncStatusProvider: ({ children }) => children,
}));

const dashboardSummary = {
  generatedAt: '2026-10-31T00:00:00.000Z',
  range: { range: 'this_month', from: '2026-10-01', to: '2026-10-31' },
  kpis: {
    totalResidents: 240,
    addedCurrentMonth: 3,
    addedPreviousMonth: 2,
    seniorCitizens: { value: 26, eligible: 28, unregistered: 2 },
    childrenUnder5: { value: 18, weighedThisYear: 12, eligibleThisYear: 18 },
    recordsThisMonth: { value: 36, previousMonth: 0 },
    nutritionCases: 4,
  },
  population: {
    male: 118,
    female: 122,
    unspecified: 0,
    ageSex: [
      { ageGroup: '0-4', sex: 'male', count: 8 },
      { ageGroup: '0-4', sex: 'female', count: 10 },
      { ageGroup: '5-19', sex: 'male', count: 26 },
      { ageGroup: '5-19', sex: 'female', count: 30 },
      { ageGroup: '20-59', sex: 'male', count: 70 },
      { ageGroup: '20-59', sex: 'female', count: 72 },
      { ageGroup: '60+', sex: 'male', count: 14 },
      { ageGroup: '60+', sex: 'female', count: 10 },
    ],
  },
  recordsTrend: [
    { month: '2026-10', clinical: 20, child: 7, maternal: 4, immunization: 5 },
  ],
  nutrition: {
    child: [{ category: 'Normal', count: 8 }, { category: 'Underweight', count: 2 }],
    adolescent: [{ category: 'Normal', count: 20 }, { category: 'Thinness', count: 3 }],
    adult: [{ category: 'Normal', count: 80 }, { category: 'Overweight', count: 10 }],
    assessed: { child: 10, adolescent: 23, adult: 90 },
    eligible: { child: 18, adolescent: 56, adult: 166 },
  },
  sitio: [
    { label: 'Purok 1', count: 80, isNoSitio: false },
    { label: 'Purok 2', count: 65, isNoSitio: false },
  ],
  timbang: { eligible: 18, weighed: 12, coveragePercent: 67, byResult: {} },
  attention: [],
  recentActivity: [
    {
      id: 'clinical-1',
      residentId: 1,
      residentName: 'Resident Name',
      type: 'clinical',
      label: 'Clinical record',
      summary: 'Sensitive clinical summary',
      recordedBy: 'Health Worker',
      date: '2026-10-20',
      createdAt: '2026-10-20T08:30:00.000Z',
    },
  ],
  sync: { pending: 0, failed: 0, lastSync: null },
};

const bhwUser = {
  user_id: 7,
  first_name: 'Mina',
  role: 'bhw',
};

const officialUser = {
  user_id: 8,
  first_name: 'Lina',
  role: 'official',
};

test('renders the HealthSync login screen by default', () => {
  render(<App />);
  expect(screen.getAllByAltText(/HealthSync logo/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Welcome back/i).length).toBeGreaterThan(0);
});

test('does not require the offline PIN after an online sign-in', async () => {
  localStorage.clear();
  localStorage.setItem('hs_offline_device_id', 'device-local');
  localStorage.setItem('hs_offline_session', JSON.stringify({
    version: 2,
    userId: '8',
    role: 'official',
    deviceId: 'device-local',
    createdAt: Date.now(),
  }));

  render(
    <AuthContext.Provider value={{
      user: {
        user_id: 8,
        role: 'official',
        username: 'lina',
        device_id: 'device-local',
        offline_pin_enrolled: true,
      },
      loading: false,
      token: 'server-token',
      offlineVaultReady: false,
      offlineVaultError: null,
      sessionCleanupError: null,
      updateUser: jest.fn(),
      unlockOfflineAccess: jest.fn(),
      logout: jest.fn(),
      lockOfflineAccess: jest.fn(),
      lockForAccountSwitch: jest.fn(),
    }}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppContent />
      </MemoryRouter>
    </AuthContext.Provider>
  );

  expect(await screen.findByRole('link', { name: 'Settings' })).toBeInTheDocument();
  expect(screen.queryByLabelText('PIN digit 1 of 6')).not.toBeInTheDocument();
  localStorage.clear();
});

test('uses the existing unlock screen for a legacy PIN-only vault without a prepare workflow', async () => {
  localStorage.clear();
  localStorage.setItem('hs_offline_device_id', 'device-local');
  localStorage.setItem('hs_offline_session', JSON.stringify({
    version: 2,
    userId: '7',
    role: 'bhw',
    deviceId: 'device-local',
    createdAt: Date.now(),
  }));
  render(
    <AuthContext.Provider value={{
      user: { ...bhwUser, device_id: 'device-local', offline_pin_enrolled: true },
      loading: false,
      token: 'server-token',
      offlineVaultReady: false,
      offlineVaultNeedsUnlock: true,
      offlineVaultMigrationRequired: true,
      offlineVaultError: null,
      sessionCleanupError: null,
      updateUser: jest.fn(),
      unlockOfflineAccess: jest.fn(),
      logout: jest.fn(),
      lockOfflineAccess: jest.fn(),
      lockForAccountSwitch: jest.fn(),
    }}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppContent />
      </MemoryRouter>
    </AuthContext.Provider>
  );

  expect(await screen.findByLabelText('PIN digit 1 of 6')).toBeInTheDocument();
  expect(screen.getByText(/Enter your current 6-digit PIN once to migrate this older offline queue/)).toBeInTheDocument();
  expect(screen.queryByText(/Prepare automatic sync/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Prepare automatic sync/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Unlock offline queue' })).not.toBeInTheDocument();
  localStorage.clear();
});

test('shows the PIN form for a previously authorized device after an offline refresh', async () => {
  const previousOnLine = navigator.onLine;
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  localStorage.clear();
  localStorage.setItem('hs_offline_device_id', 'device-local');
  localStorage.setItem('hs_offline_session', JSON.stringify({
    version: 2,
    userId: '7',
    role: 'bhw',
    deviceId: 'device-local',
    createdAt: Date.now(),
  }));
  render(
    <AuthContext.Provider value={{
      user: { ...bhwUser, device_id: 'device-local', offline_pin_enrolled: true },
      loading: false,
      token: 'server-token',
      offlineVaultReady: false,
      offlineVaultNeedsUnlock: false,
      offlineVaultError: null,
      sessionCleanupError: null,
      updateUser: jest.fn(),
      unlockOfflineAccess: jest.fn(),
      logout: jest.fn(),
      lockOfflineAccess: jest.fn(),
      lockForAccountSwitch: jest.fn(),
    }}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppContent />
      </MemoryRouter>
    </AuthContext.Provider>
  );

  expect(screen.getByLabelText('PIN digit 1 of 6')).toBeInTheDocument();
  expect(screen.queryByText(/Offline authorization is unavailable for this account or device/)).not.toBeInTheDocument();
  localStorage.clear();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: previousOnLine });
});

test('explains missing local authorization without showing a PIN form offline', async () => {
  const previousOnLine = navigator.onLine;
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  localStorage.clear();
  render(
    <AuthContext.Provider value={{
      user: { ...bhwUser, device_id: 'device-local', offline_pin_enrolled: true },
      loading: false,
      token: 'server-token',
      offlineVaultReady: false,
      offlineVaultNeedsUnlock: false,
      offlineVaultError: null,
      sessionCleanupError: null,
      updateUser: jest.fn(),
      unlockOfflineAccess: jest.fn(),
      logout: jest.fn(),
      lockOfflineAccess: jest.fn(),
      lockForAccountSwitch: jest.fn(),
    }}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppContent />
      </MemoryRouter>
    </AuthContext.Provider>
  );

  expect(screen.getByText(/Offline authorization is unavailable for this account or device/)).toBeInTheDocument();
  expect(screen.queryByLabelText('PIN digit 1 of 6')).not.toBeInTheDocument();
  localStorage.clear();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: previousOnLine });
});

test('keeps content inert while the navigation drawer is open and exposes account actions', () => {
  localStorage.clear();
  render(
    <AuthContext.Provider value={{
      user: { ...bhwUser, username: 'mina' },
      loading: false,
      offlineVaultReady: true,
      offlineVaultNeedsUnlock: false,
      offlineVaultMigrationRequired: false,
      offlineVaultError: null,
      sessionCleanupError: null,
      updateUser: jest.fn(),
      unlockOfflineAccess: jest.fn(),
      logout: jest.fn(),
      lockOfflineAccess: jest.fn(),
      lockForAccountSwitch: jest.fn(),
    }}>
      <MemoryRouter initialEntries={['/not-authorized']}>
        <AppContent />
      </MemoryRouter>
    </AuthContext.Provider>
  );

  const navigationButton = screen.getByRole('button', { name: 'Open navigation menu' });
  const sidebarIcons = document.querySelectorAll('.healthsync-sidebar .healthsync-nav-icon');
  expect(sidebarIcons.length).toBeGreaterThan(0);
  expect(Array.from(sidebarIcons).every((icon) => icon.classList.contains('lucide'))).toBe(true);

  fireEvent.click(navigationButton);
  expect(navigationButton).toHaveAttribute('aria-expanded', 'true');
  expect(document.getElementById('healthsync-content')).toHaveAttribute('inert');

  fireEvent.keyDown(window, { key: 'Escape' });
  expect(navigationButton).toHaveAttribute('aria-expanded', 'false');
  expect(document.getElementById('healthsync-content')).not.toHaveAttribute('inert');
  expect(document.activeElement).toBe(navigationButton);

  const accountButton = screen.getByRole('button', { name: 'Account options for mina' });
  fireEvent.click(accountButton);
  const accountDialog = screen.getByRole('dialog', { name: 'Account options' });
  expect(within(accountDialog).getByText('bhw')).toBeInTheDocument();

  fireEvent.keyDown(window, { key: 'Escape' });
  expect(accountButton).toHaveAttribute('aria-expanded', 'false');
  expect(document.activeElement).toBe(accountButton);
  localStorage.clear();
});

test('preserves the same-tab offline unlock across a page refresh', () => {
  const lockOfflineAccess = jest.fn();
  render(
    <AuthContext.Provider value={{
      user: { ...bhwUser, username: 'mina' },
      loading: false,
      offlineVaultReady: true,
      offlineVaultNeedsUnlock: false,
      offlineVaultMigrationRequired: false,
      offlineVaultError: null,
      sessionCleanupError: null,
      updateUser: jest.fn(),
      unlockOfflineAccess: jest.fn(),
      logout: jest.fn(),
      lockOfflineAccess,
      lockForAccountSwitch: jest.fn(),
    }}>
      <MemoryRouter initialEntries={['/not-authorized']}>
        <AppContent />
      </MemoryRouter>
    </AuthContext.Provider>
  );

  fireEvent(window, new Event('pagehide'));

  expect(lockOfflineAccess).toHaveBeenCalledWith({
    broadcast: false,
    preserveSessionUnlock: true,
  });
  localStorage.clear();
});

test('renders actual dashboard summary metrics and method-specific charts', async () => {
  api.get.mockResolvedValue({
    data: { success: true, data: dashboardSummary },
  });

  render(
    <MemoryRouter>
      <AuthContext.Provider value={{ user: bhwUser }}>
        <DashboardPage />
      </AuthContext.Provider>
    </MemoryRouter>
  );

  expect(await screen.findByRole('heading', { name: /population distribution/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /health records trend/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /nutrition classifications/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /operation timbang/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /community updates/i })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /add resident/i })).toHaveAttribute('href', '/residents/new');
  expect(screen.queryByText('Resident Name')).not.toBeInTheDocument();
  expect(screen.queryByText('Sensitive clinical summary')).not.toBeInTheDocument();
});

test('keeps official dashboard actions within the official role permissions', async () => {
  api.get.mockResolvedValue({
    data: { success: true, data: dashboardSummary },
  });

  render(
    <MemoryRouter>
      <AuthContext.Provider value={{ user: officialUser }}>
        <DashboardPage />
      </AuthContext.Provider>
    </MemoryRouter>
  );

  expect(await screen.findByRole('heading', { name: /population distribution/i })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /view reports/i })).toHaveAttribute('href', '/reports');
  expect(screen.queryByRole('link', { name: /^nutrition$/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /operation timbang/i })).not.toBeInTheDocument();
  expect(screen.getByText('Nutrition follow-up').closest('a')).toBeNull();
  expect(screen.queryByRole('link', { name: /add resident/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /health records/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /resident name/i })).not.toBeInTheDocument();
});

test('does not synthesize dashboard metrics from a legacy or incomplete response', async () => {
  api.get.mockResolvedValue({
    data: { success: true, data: { totalResidents: 240, healthRecordsThisMonth: 36 } },
  });

  render(
    <MemoryRouter>
      <AuthContext.Provider value={{ user: bhwUser }}>
        <DashboardPage />
      </AuthContext.Provider>
    </MemoryRouter>
  );

  expect(await screen.findByText(/couldn't complete that request/i)).toBeInTheDocument();
  const banner = screen.getByText(/couldn't complete that request/i).closest('.hs-status-banner');
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
  expect(banner).toHaveTextContent(/did not contain a valid community summary/i);
  expect(screen.queryByText('240')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /population distribution/i })).not.toBeInTheDocument();
});
