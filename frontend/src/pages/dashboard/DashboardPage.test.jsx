import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from './DashboardPage';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api/apiClient';
import { getResidents } from '../../services/api/residentService';
import idb from '../../services/offline/indexedDbService';
import useSyncStatus from '../../services/offline/useSyncStatus';

jest.mock('../../services/api/apiClient', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../../services/api/residentService', () => ({ getResidents: jest.fn() }));
jest.mock('../../services/offline/indexedDbService', () => ({
  __esModule: true,
  default: { getFromStore: jest.fn(), putToStore: jest.fn() },
}));
jest.mock('../../services/offline/syncManager', () => ({ __esModule: true, default: { runSync: jest.fn() } }));
jest.mock('../../services/offline/useSyncStatus', () => ({ __esModule: true, default: jest.fn() }));

const summary = {
  kpis: {},
  population: {},
  recordsTrend: [],
  sitio: [],
  nutrition: {},
  timbang: {},
  attention: [],
  recentActivity: [],
};
const recentActivityPath = '/dashboard/recent-activity';
const syncState = {
  online: true,
  pending: 0,
  failed: 0,
  dashboardRequestFailed: false,
  setDashboardRequestFailed: jest.fn((value) => { syncState.dashboardRequestFailed = value; }),
  refresh: jest.fn().mockResolvedValue(undefined),
};

function mockDashboardApi(summaryResponse, activityItems = []) {
  api.get.mockImplementation((url) => {
    if (url === recentActivityPath) {
      const items = typeof activityItems === 'function' ? activityItems() : activityItems;
      return Promise.resolve({ data: { success: true, data: items } });
    }
    return typeof summaryResponse === 'function' ? summaryResponse() : Promise.resolve(summaryResponse);
  });
}

const summaryRequestCount = () => api.get.mock.calls
  .filter(([url]) => url === '/dashboard/summary')
  .length;

function renderDashboard(onInitialLoad) {
  useSyncStatus.mockReturnValue(syncState);
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { user_id: 7, role: 'bhw', first_name: 'Test' } }}>
        <DashboardPage onInitialLoad={onInitialLoad} />
      </AuthContext.Provider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  syncState.dashboardRequestFailed = false;
  syncState.setDashboardRequestFailed = jest.fn((value) => { syncState.dashboardRequestFailed = value; });
  useSyncStatus.mockReturnValue(syncState);
  getResidents.mockResolvedValue({ success: true, data: { items: [] } });
  mockDashboardApi(() => Promise.reject({
    code: 'ECONNABORTED',
    message: 'timeout of 10000ms exceeded',
  }));
  idb.getFromStore.mockResolvedValue({
    savedAt: '2026-11-20T03:00:00.000Z',
    value: summary,
  });
  idb.putToStore.mockResolvedValue(undefined);
});

test('reports dashboard readiness only after its initial summary request resolves', async () => {
  let resolveSummary;
  const onInitialLoad = jest.fn();
  mockDashboardApi(() => new Promise((resolve) => { resolveSummary = resolve; }));
  renderDashboard(onInitialLoad);

  await waitFor(() => expect(resolveSummary).toBeDefined());
  expect(onInitialLoad).not.toHaveBeenCalled();

  resolveSummary({ data: { success: true, data: summary } });
  await waitFor(() => expect(onInitialLoad).toHaveBeenCalledWith(null));
});

test('shows one friendly saved-data banner and keeps timeout details collapsed', async () => {
  renderDashboard();

  const message = await screen.findByText(/Showing saved data from/);
  const banner = message.closest('.hs-status-banner');
  expect(banner).toHaveTextContent(/Showing saved data from/);
  expect(banner).toHaveTextContent(/Your work is safe on this device/);
  expect(screen.queryByText(/timeout of 10000ms exceeded/)).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
  expect(banner).toHaveTextContent('timeout of 10000ms exceeded');
});

test('places the reporting period control in the greeting banner without a dashboard toolbar', async () => {
  mockDashboardApi({ data: { success: true, data: summary } });
  const { container } = renderDashboard();
  const banner = container.querySelector('.page-banner-dashboard');
  const rangeSelect = screen.getByRole('combobox', { name: 'Reporting period' });

  expect(banner).toContainElement(rangeSelect);
  expect(container.querySelector('.dashboard-toolbar')).not.toBeInTheDocument();
  expect(banner.querySelector('.dashboard-banner-range .lucide-calendar-days')).toBeInTheDocument();

  fireEvent.change(rangeSelect, { target: { value: 'custom' } });
  expect(screen.getByLabelText('From')).toBeInTheDocument();
  expect(screen.getByLabelText('To')).toBeInTheDocument();
  await waitFor(() => expect(summaryRequestCount()).toBe(2));
  await waitFor(() => expect(idb.putToStore).toHaveBeenCalled());
});

test('a successful manual retry dismisses the banner and announces the dashboard update', async () => {
  let summaryRequests = 0;
  mockDashboardApi(() => {
    summaryRequests += 1;
    return summaryRequests === 1
      ? Promise.reject({ code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' })
      : Promise.resolve({ data: { success: true, data: summary } });
  });
  renderDashboard();

  const message = await screen.findByText(/Showing saved data from/);
  const retryButton = within(message.closest('.hs-status-banner')).getByRole('button', { name: 'Try again' });
  await waitFor(() => expect(retryButton).toBeEnabled());
  fireEvent.click(retryButton);
  await waitFor(() => expect(summaryRequestCount()).toBe(2));
  expect(await screen.findByText('Dashboard updated')).toBeInTheDocument();
  expect(screen.queryByText(/Showing saved data from/)).not.toBeInTheDocument();
});

test('renders the redesigned dashboard panels with summary data from the server', async () => {
  const recentActivity = [{
    id: 'clinical-1',
    residentId: 8,
    residentName: 'Maria Santos',
    type: 'clinical',
    label: 'Clinical record',
    recordedBy: 'Test worker',
    date: '2026-11-21',
    createdAt: '2026-11-21T09:30:00.000Z',
  }];
  getResidents.mockResolvedValue({
    success: true,
    data: {
      items: [{
        resident_id: 8,
        first_name: 'Maria',
        last_name: 'Santos',
        age: 35,
        sex: 'female',
        resident_status: 'Active',
        created_at: '2026-11-21',
      }],
    },
  });
  mockDashboardApi({
    data: {
      success: true,
      data: {
        ...summary,
        kpis: {
          totalResidents: 10,
          seniorCitizens: { value: 1, eligible: 1, unregistered: 0 },
          childrenUnder5: { value: 3, weighedThisYear: 2, eligibleThisYear: 4 },
          nutritionCases: 1,
        },
        population: { ageSex: [{ ageGroup: '0-4', sex: 'female', count: 3 }] },
        nutrition: {
          child: [{ category: 'Normal', count: 3 }],
          adolescent: [
            { category: 'Normal', count: 2 },
            { category: 'Severe Thinness', count: 1 },
          ],
          adult: [
            { category: 'Overweight', count: 1 },
            { category: 'Obese', count: 2 },
          ],
        },
        nutritionTrend: [{ month: '2026-11', assessed: 1, normal: 100, underweight: 0, overweight: 0 }],
        timbang: { eligible: 4, weighed: 2, coveragePercent: 50 },
        timbangMonthly: [{ month: '2026-11', count: 2 }],
        recentResidents: [{
          id: 8,
          name: 'Maria Santos',
          age: 35,
          sex: 'female',
          status: 'Active',
          registeredOn: '2026-11-21',
        }],
        attention: [{
          severity: 'high',
          count: 1,
          title: 'Nutrition cases need follow-up',
          description: 'Recorded nutrition risk.',
          filter: '/nutrition',
        }],
        recentActivity,
      },
    },
  }, recentActivity);

  renderDashboard();

  expect(await screen.findByRole('heading', { name: 'Nutritional Status Distribution' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Monthly Nutrition Trends' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Operation Timbang Statistics' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Age Group Distribution' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Recent Resident Registrations' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Health Alerts and Notifications' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Recent Activities' })).toBeInTheDocument();
  expect(screen.getByText('Registered residents')).toBeInTheDocument();
  expect(screen.getByText('Children monitored')).toBeInTheDocument();
  expect(screen.getByText('Normal child assessments')).toBeInTheDocument();
  expect(screen.getByText('Nutrition risk cases')).toBeInTheDocument();
  expect(screen.getByText('Registered seniors')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: '9 total nutritional assessments' })).toBeInTheDocument();
  expect(screen.getByText('55.6%')).toBeInTheDocument();
  expect(screen.getByText('Severely Underweight')).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Nutritional assessment method' })).not.toBeInTheDocument();
  expect(within(screen.getByRole('table')).getByText('Maria Santos')).toBeInTheDocument();
  expect(screen.getByText('Nutrition cases need follow-up')).toBeInTheDocument();
  expect(screen.getByText('Clinical record')).toBeInTheDocument();
});

test('refreshes recent activity from the live endpoint when the dashboard regains focus', async () => {
  const activity = {
    id: 'maternal-19',
    residentId: 19,
    residentName: 'Current Resident',
    type: 'maternal',
    label: 'New maternal record',
    recordedBy: 'Health Worker',
    date: '2026-11-22',
    createdAt: '2026-11-22T08:30:00.000Z',
  };
  let activityRequests = 0;
  mockDashboardApi(
    { data: { success: true, data: summary } },
    () => {
      activityRequests += 1;
      return activityRequests === 1 ? [] : [activity];
    }
  );

  renderDashboard();
  expect(await screen.findByText('No recent health records are available.')).toBeInTheDocument();

  fireEvent.focus(window);

  expect(await screen.findByText('New maternal record')).toBeInTheDocument();
  expect(screen.getByText('Current Resident')).toBeInTheDocument();
  expect(activityRequests).toBeGreaterThanOrEqual(2);
});

test('uses the newest resident list instead of stale summary rows', async () => {
  mockDashboardApi({
    data: {
      success: true,
      data: {
        ...summary,
        kpis: { totalResidents: 1 },
        recentResidents: [{
          id: 7,
          name: 'Older Resident',
          age: 40,
          sex: 'male',
          status: 'Active',
          registeredOn: '2026-11-10',
        }],
      },
    },
  });
  getResidents.mockResolvedValue({
    success: true,
    data: {
      items: [{
        resident_id: 8,
        first_name: 'Maria',
        last_name: 'Santos',
        age: 35,
        sex: 'female',
        resident_status: 'Active',
        created_at: '2026-11-21',
      }],
    },
  });

  renderDashboard();

  const table = await screen.findByRole('table');
  expect(getResidents).toHaveBeenCalledWith({ page: 1, limit: 5, sort: 'newest', order: 'asc' });
  expect(within(table).getByText('Maria Santos')).toBeInTheDocument();
  expect(within(table).queryByText('Older Resident')).not.toBeInTheDocument();
  expect(within(table).getByText('35')).toBeInTheDocument();
  expect(within(table).getByText('F')).toBeInTheDocument();
  expect(within(table).getByText('Nov 21, 2026')).toBeInTheDocument();
  expect(within(table).getByText('Active')).toBeInTheDocument();
  expect(within(table).getByText('Gender')).toBeInTheDocument();
  expect(within(table).getByText('Date registered')).toBeInTheDocument();
});
