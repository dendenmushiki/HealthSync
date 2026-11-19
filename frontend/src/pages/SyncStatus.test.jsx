import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import SyncStatus from './SyncStatus';
import offlineQueue from '../services/offline/offlineQueueService';
import useSyncStatus from '../services/offline/useSyncStatus';
import api from '../services/api/apiClient';
import {
  downloadOfflineData,
  getActiveResidentSnapshot,
} from '../services/offline/offlineDataDownloadService';

jest.mock('../services/offline/useSyncStatus', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../services/offline/offlineQueueService', () => ({
  __esModule: true,
  default: {
    deleteOperation: jest.fn(),
    getOperation: jest.fn(),
    updateOperationStatus: jest.fn(),
  },
}));

jest.mock('../services/offline/syncManager', () => ({
  __esModule: true,
  default: { runSync: jest.fn() },
}));

jest.mock('../services/offline/offlineDataDownloadService', () => ({
  downloadOfflineData: jest.fn(),
  getActiveResidentSnapshot: jest.fn(),
  getOfflineSnapshotReadiness: jest.fn((snapshot) => snapshot ? 'complete' : 'unavailable'),
}));

jest.mock('../services/api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const makeItem = (status) => ({
  offlineOperationId: 'offline-1',
  operation: 'CREATE',
  table: 'residents',
  payload: { first_name: 'Test', last_name: 'Resident' },
  createdAt: '2026-11-16T00:00:00.000Z',
  status,
  retryCount: 0,
  ...(status === 'SYNCED' ? { syncedAt: '2026-11-16T00:01:00.000Z' } : {}),
});

function renderSyncStatus(item) {
  useSyncStatus.mockReturnValue({
    items: [item],
    online: true,
    syncing: false,
    setSyncing: jest.fn(),
    loaded: true,
    refresh: jest.fn().mockResolvedValue(undefined),
    pending: item.status === 'PENDING' ? 1 : 0,
    failed: 0,
    syncingCount: 0,
    syncedToday: item.status === 'SYNCED' ? 1 : 0,
    conflicts: 0,
    waiting: item.status === 'PENDING' ? 1 : 0,
    lastSynced: item.syncedAt || null,
  });

  render(
    <MemoryRouter>
      <SyncStatus />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole('button', { name: /Details for/ }));
}

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockResolvedValue({ data: { success: true, data: { items: [] } } });
});

test('synced changes cannot be discarded from Sync Status', async () => {
  renderSyncStatus(makeItem('SYNCED'));

  const drawer = await screen.findByRole('dialog', { name: 'Sync change details' });
  expect(within(drawer).queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Discard this queued change?' })).not.toBeInTheDocument();
});

test('a change that syncs before discard confirmation is preserved', async () => {
  const pendingItem = makeItem('PENDING');
  offlineQueue.getOperation.mockResolvedValue({ ...pendingItem, status: 'SYNCED' });
  renderSyncStatus(pendingItem);

  const drawer = await screen.findByRole('dialog', { name: 'Sync change details' });
  fireEvent.click(within(drawer).getByRole('button', { name: 'Discard' }));
  fireEvent.click(screen.getByRole('checkbox', { name: /I understand this cannot be undone/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Discard change' }));

  expect(await screen.findByText(/already synced and cannot be discarded/i)).toBeInTheDocument();
  expect(offlineQueue.deleteOperation).not.toHaveBeenCalled();
  await waitFor(() => expect(offlineQueue.getOperation).toHaveBeenCalledWith('offline-1'));
});

test('unknown outcomes cannot be retried or discarded as unsent changes', async () => {
  renderSyncStatus(makeItem('CONFLICT'));

  const drawer = await screen.findByRole('dialog', { name: 'Sync change details' });
  fireEvent.click(within(drawer).getByRole('button', { name: 'Retry' }));
  expect(offlineQueue.updateOperationStatus).not.toHaveBeenCalled();
  expect(screen.getByText(/server outcome is unknown/i)).toBeInTheDocument();

  fireEvent.click(within(drawer).getByRole('button', { name: 'Discard' }));
  expect(screen.getByRole('dialog', { name: 'This change needs attention' })).toBeInTheDocument();
  expect(screen.getByText(/cannot be safely retried or discarded/i)).toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Discard change' })).not.toBeInTheDocument();
});

test('BHWs can download offline data from Sync Status and inspect included datasets', async () => {
  const snapshot = {
    recordCount: 12,
    nutritionRecordCount: 8,
    medicalRecordCount: 4,
    legacyClinicalRecordCount: 3,
    legacyChildRecordCount: 2,
    seniorCitizenRecordCount: 1,
    downloadedAt: '2026-11-16T00:00:00.000Z',
  };
  useSyncStatus.mockReturnValue({
    items: [],
    online: true,
    syncing: false,
    setSyncing: jest.fn(),
    loaded: true,
    refresh: jest.fn().mockResolvedValue(undefined),
    pending: 0,
    failed: 0,
    syncingCount: 0,
    syncedToday: 0,
    conflicts: 0,
    waiting: 0,
    lastSynced: null,
  });
  getActiveResidentSnapshot.mockResolvedValue(snapshot);
  downloadOfflineData.mockResolvedValue(snapshot);

  render(
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { user_id: 7, role: 'bhw' }, offlineVaultReady: true }}>
        <SyncStatus />
      </AuthContext.Provider>
    </MemoryRouter>
  );

  expect(await screen.findByText('Residents: 12')).toBeInTheDocument();
  fireEvent.click(screen.getByText('What’s included in the download'));
  expect(screen.getByText(/Operation Timbang, Adult BMI, and Adolescent BMI/)).toBeInTheDocument();
  expect(screen.getByText(/clinical, child, maternal, and immunization/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Refresh offline data' }));
  await waitFor(() => expect(downloadOfflineData).toHaveBeenCalledTimes(1));
});

test('BHWs see server-confirmed activity separately from their private local queue', async () => {
  useSyncStatus.mockReturnValue({
    items: [],
    online: true,
    syncing: false,
    setSyncing: jest.fn(),
    loaded: true,
    refresh: jest.fn().mockResolvedValue(undefined),
    pending: 0,
    failed: 0,
    syncingCount: 0,
    syncedToday: 0,
    conflicts: 0,
    waiting: 0,
    lastSynced: null,
  });
  api.get.mockResolvedValue({
    data: {
      success: true,
      data: {
        items: [{
          table_name: 'adult_bmi_records',
          operation: 'POST',
          server_record_id: 91,
          actor_name: 'BHW Account A',
          created_at: '2026-11-16T00:01:00.000Z',
        }],
      },
    },
  });

  render(
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { user_id: 8, role: 'bhw' }, offlineVaultReady: true }}>
        <SyncStatus />
      </AuthContext.Provider>
    </MemoryRouter>
  );

  expect(await screen.findByText(/Synced by BHW Account A/)).toBeInTheDocument();
  expect(screen.getByText('Adult BMI record')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open nutrition records' })).toHaveAttribute('href', '/nutrition?type=Adult%20BMI');
  expect(api.get).toHaveBeenCalledWith('/sync/activity');
});

test('locked local queue is not described as fully synchronized', async () => {
  useSyncStatus.mockReturnValue({
    items: [],
    online: true,
    syncing: false,
    setSyncing: jest.fn(),
    loaded: true,
    refresh: jest.fn().mockResolvedValue(undefined),
    pending: 0,
    failed: 0,
    syncingCount: 0,
    syncedToday: 0,
    conflicts: 0,
    waiting: 0,
    lastSynced: null,
    error: 'Secure sync data is locked or unavailable for this account.',
  });

  render(
    <MemoryRouter>
      <AuthContext.Provider value={{
        user: { user_id: 7, role: 'bhw', offline_pin_enrolled: true },
        offlineVaultReady: false,
      }}>
        <SyncStatus />
      </AuthContext.Provider>
    </MemoryRouter>
  );

  expect(screen.getAllByText('Offline queue unavailable').length).toBeGreaterThan(0);
  expect(screen.queryByText('Everything is synced')).not.toBeInTheDocument();
  expect(screen.getByText(/has not been counted as synchronized/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Unlock offline queue' })).not.toBeInTheDocument();
});
