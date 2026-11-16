import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SyncStatus from './SyncStatus';
import offlineQueue from '../services/offline/offlineQueueService';
import useSyncStatus from '../services/offline/useSyncStatus';

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
