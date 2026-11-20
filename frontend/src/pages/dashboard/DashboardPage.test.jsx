import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from './DashboardPage';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api/apiClient';
import idb from '../../services/offline/indexedDbService';
import useSyncStatus from '../../services/offline/useSyncStatus';

jest.mock('../../services/api/apiClient', () => ({ __esModule: true, default: { get: jest.fn() } }));
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
const syncState = {
  online: true,
  pending: 0,
  failed: 0,
  dashboardRequestFailed: false,
  setDashboardRequestFailed: jest.fn((value) => { syncState.dashboardRequestFailed = value; }),
  refresh: jest.fn().mockResolvedValue(undefined),
};

function renderDashboard() {
  useSyncStatus.mockReturnValue(syncState);
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { user_id: 7, role: 'bhw', first_name: 'Test' } }}>
        <DashboardPage />
      </AuthContext.Provider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  syncState.dashboardRequestFailed = false;
  syncState.setDashboardRequestFailed = jest.fn((value) => { syncState.dashboardRequestFailed = value; });
  useSyncStatus.mockReturnValue(syncState);
  api.get.mockRejectedValue({
    code: 'ECONNABORTED',
    message: 'timeout of 10000ms exceeded',
  });
  idb.getFromStore.mockResolvedValue({
    savedAt: '2026-11-20T03:00:00.000Z',
    value: summary,
  });
  idb.putToStore.mockResolvedValue(undefined);
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

test('a successful manual retry dismisses the banner and announces the dashboard update', async () => {
  api.get
    .mockRejectedValueOnce({ code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' })
    .mockResolvedValueOnce({ data: { success: true, data: summary } });
  renderDashboard();

  const message = await screen.findByText(/Showing saved data from/);
  const retryButton = within(message.closest('.hs-status-banner')).getByRole('button', { name: 'Try again' });
  await waitFor(() => expect(retryButton).toBeEnabled());
  fireEvent.click(retryButton);
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  expect(await screen.findByText('Dashboard updated')).toBeInTheDocument();
  expect(screen.queryByText(/Showing saved data from/)).not.toBeInTheDocument();
});
