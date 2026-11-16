import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
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
    return { pending: 0, failed: 0, refresh };
  },
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
  expect(screen.getByText(/Welcome back/i)).toBeInTheDocument();
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
  expect(screen.getByRole('link', { name: /^nutrition$/i })).toHaveAttribute('href', '/nutrition');
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

  expect(await screen.findByRole('alert')).toHaveTextContent(/did not contain a valid community summary/i);
  expect(screen.queryByText('240')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /population distribution/i })).not.toBeInTheDocument();
});
