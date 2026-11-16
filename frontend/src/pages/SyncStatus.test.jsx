import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SyncStatus from './SyncStatus';
import idb from '../services/offline/indexedDbService';
import useSyncStatus from '../services/offline/useSyncStatus';

jest.mock('../services/offline/indexedDbService', () => ({
  __esModule: true,
  default: {
    getFromStore: jest.fn(),
    deleteFromStore: jest.fn(),
  },
}));

jest.mock('../services/offline/useSyncStatus', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../services/offline/offlineQueueService', () => ({
  __esModule: true,
  default: { updateOperationStatus: jest.fn() },
}));

jest.mock('../services/offline/syncManager', () => ({
  __esModule: true,
  default: { runSync: jest.fn() },
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
});

test('synced changes cannot be discarded from Sync Status', async () => {
  renderSyncStatus(makeItem('SYNCED'));

  const drawer = await screen.findByRole('dialog', { name: 'Sync change details' });
  expect(within(drawer).queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Discard this queued change?' })).not.toBeInTheDocument();
});

test('a change that syncs before discard confirmation is preserved', async () => {
  const pendingItem = makeItem('PENDING');
  idb.getFromStore.mockResolvedValue({ ...pendingItem, status: 'SYNCED' });
  renderSyncStatus(pendingItem);

  const drawer = await screen.findByRole('dialog', { name: 'Sync change details' });
  fireEvent.click(within(drawer).getByRole('button', { name: 'Discard' }));
  fireEvent.click(screen.getByRole('checkbox', { name: /I understand this cannot be undone/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Discard change' }));

  expect(await screen.findByText(/already synced and cannot be discarded/i)).toBeInTheDocument();
  expect(idb.deleteFromStore).not.toHaveBeenCalled();
  await waitFor(() => expect(idb.getFromStore).toHaveBeenCalledWith('offlineQueue', 'offline-1'));
});
