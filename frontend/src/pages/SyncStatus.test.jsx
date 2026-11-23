import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  localRecord: { first_name: 'Test', last_name: 'Resident' },
  savedOffline: true,
  userId: '7',
  createdAt: '2026-11-16T00:00:00.000Z',
  status,
  retryCount: 0,
  ...(status === 'SYNCED' ? { syncedAt: '2026-11-16T00:01:00.000Z' } : {}),
});

async function renderSyncStatus(item) {
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
      <AuthContext.Provider value={{ user: { user_id: 7, role: 'bhw' }, offlineVaultReady: true }}>
        <SyncStatus />
      </AuthContext.Provider>
    </MemoryRouter>
  );
  if (item.status !== 'SYNCED') {
    fireEvent.click(screen.getByRole('button', { name: /Details for/ }));
  }
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockResolvedValue({ data: { success: true, data: { items: [] } } });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('Synced status shows other BHWs server records and opens full saved details', async () => {
  api.get.mockImplementation((path) => {
    if (path === '/sync/activity') {
      return Promise.resolve({
        data: {
          success: true,
          data: {
            items: [{
              sync_activity_id: 42,
              table_name: 'adult_bmi_records',
              operation: 'POST',
              server_record_id: 91,
              created_at: '2026-11-16T00:01:00.000Z',
              actor_id: 8,
              actor_name: 'BHW Account A',
            }],
          },
        },
      });
    }
    if (path === '/sync/activity/42') {
      return Promise.resolve({
        data: {
          success: true,
          data: {
            record_details: {
              bmi_id: 91,
              resident_id: 24,
              bmi: 22.4,
              bmi_category: 'Normal',
            },
          },
        },
      });
    }
    throw new Error(`Unexpected API request: ${path}`);
  });
  await renderSyncStatus(makeItem('SYNCED'));
  expect(api.get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Synced' }));

  const historySummary = /Added Adult BMI · Record #91 · Synced by BHW Account A/;
  expect((await screen.findAllByRole('button', { name: historySummary })).length).toBeGreaterThan(0);
  expect(api.get).toHaveBeenCalledWith('/sync/activity', { params: { scope: 'all' } });
  fireEvent.click(screen.getByRole('button', { name: /Details for Added Adult BMI/ }));
  const drawer = await screen.findByRole('dialog', { name: 'Synced record details' });
  expect(within(drawer).getByText('Saved to server')).toBeInTheDocument();
  expect(await within(drawer).findByText('Normal')).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith('/sync/activity/42');
  expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Discard this queued change?' })).not.toBeInTheDocument();
});

test('shared synced history refreshes after a synchronization completes', async () => {
  api.get
    .mockResolvedValueOnce({ data: { success: true, data: { items: [] } } })
    .mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          items: [{
            sync_activity_id: 104,
            table_name: 'health_records',
            operation: 'PUT',
            server_record_id: 104,
            created_at: '2026-11-16T00:01:00.000Z',
            actor_id: 9,
            actor_name: 'BHW Account B',
          }],
        },
      },
    });
  await renderSyncStatus(makeItem('SYNCED'));
  fireEvent.click(screen.getByRole('button', { name: 'Synced' }));
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
  expect(api.get).toHaveBeenCalledTimes(1);

  await act(async () => {
    window.dispatchEvent(new Event('healthsync:sync-complete'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect((await screen.findAllByRole('button', {
    name: /Updated Clinical record · Record #104 · Synced by BHW Account B/,
  })).length).toBeGreaterThan(0);
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
});

test('synced history can be scoped to the current BHW or all BHW accounts', async () => {
  const ownSync = {
    sync_activity_id: 1,
    table_name: 'health_records',
    operation: 'CREATE',
    server_record_id: 101,
    created_at: '2026-11-16T00:01:00.000Z',
    actor_id: 7,
    actor_name: 'My BHW account',
  };
  const otherSync = {
    ...ownSync,
    sync_activity_id: 2,
    server_record_id: 102,
    actor_id: 8,
    actor_name: 'Another BHW account',
  };
  api.get
    .mockResolvedValueOnce({ data: { success: true, data: { items: [ownSync, otherSync] } } })
    .mockResolvedValueOnce({ data: { success: true, data: { items: [ownSync] } } });
  await renderSyncStatus(makeItem('SYNCED'));
  fireEvent.click(screen.getByRole('button', { name: 'Synced' }));

  expect((await screen.findAllByText(/Synced by Another BHW account/)).length).toBeGreaterThan(0);
  fireEvent.change(screen.getByRole('combobox', { name: 'Synced history account filter' }), {
    target: { value: 'mine' },
  });

  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/sync/activity', { params: { scope: 'mine' } }));
  expect((await screen.findAllByText(/Synced by My BHW account/)).length).toBeGreaterThan(0);
  expect(screen.queryByText(/Synced by Another BHW account/)).not.toBeInTheDocument();
});

test('pending details show BHW-friendly status without internal operation data', async () => {
  const pendingItem = {
    ...makeItem('PENDING'),
    offlineOperationId: 'private-operation-id',
    payload: {
      first_name: 'Test',
      last_name: 'Resident',
      idempotency_key: 'private-idempotency-key',
    },
    request: { url: '/internal/endpoint' },
  };
  await renderSyncStatus(pendingItem);

  const drawer = await screen.findByRole('dialog', { name: 'Saved change details' });
  expect(within(drawer).getByText('Waiting to sync')).toBeInTheDocument();
  expect(within(drawer).getByText(/saved on this device.*synchronize when a connection is available/i)).toBeInTheDocument();
  expect(within(drawer).queryByText(/private-operation-id|private-idempotency-key|internal\/endpoint/i)).not.toBeInTheDocument();
});

test('a change that syncs before discard confirmation is preserved', async () => {
  const pendingItem = makeItem('PENDING');
  offlineQueue.getOperation.mockResolvedValue({ ...pendingItem, status: 'SYNCED' });
  await renderSyncStatus(pendingItem);

  const drawer = await screen.findByRole('dialog', { name: 'Saved change details' });
  fireEvent.click(within(drawer).getByRole('button', { name: 'Discard' }));
  fireEvent.click(screen.getByRole('checkbox', { name: /I understand this cannot be undone/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Discard change' }));

  expect(await screen.findByText(/already synced and cannot be discarded/i)).toBeInTheDocument();
  expect(offlineQueue.deleteOperation).not.toHaveBeenCalled();
  await waitFor(() => expect(offlineQueue.getOperation).toHaveBeenCalledWith('offline-1'));
});

test('unknown outcomes cannot be retried or discarded as unsent changes', async () => {
  await renderSyncStatus(makeItem('CONFLICT'));

  const drawer = await screen.findByRole('dialog', { name: 'Saved change details' });
  expect(offlineQueue.updateOperationStatus).not.toHaveBeenCalled();
  expect(within(drawer).getByText(/could not confirm whether this change was saved/i)).toBeInTheDocument();
  expect(within(drawer).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  expect(within(drawer).queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
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

test('shared sync activity errors are surfaced instead of showing an empty success state', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  api.get.mockRejectedValue(new Error('Shared synced history is unavailable.'));
  await renderSyncStatus(makeItem('SYNCED'));
  fireEvent.click(screen.getByRole('button', { name: 'Synced' }));

  expect(await screen.findByText('Shared synced history is unavailable.')).toBeInTheDocument();
});

test('non-BHW accounts do not request shared synced history', async () => {
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

  render(
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { user_id: 7, role: 'official' }, offlineVaultReady: false }}>
        <SyncStatus />
      </AuthContext.Provider>
    </MemoryRouter>
  );

  expect(api.get).not.toHaveBeenCalled();
  expect(screen.queryByRole('region', { name: 'Synced history' })).not.toBeInTheDocument();
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
