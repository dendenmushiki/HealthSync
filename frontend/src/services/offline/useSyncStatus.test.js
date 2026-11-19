import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import useSyncStatus from './useSyncStatus';
import offlineQueue from './offlineQueueService';

jest.mock('./offlineQueueService', () => ({
  __esModule: true,
  default: { getQueueItems: jest.fn() },
}));

jest.mock('./networkService', () => ({
  __esModule: true,
  default: {
    startNetworkMonitor: jest.fn(),
    subscribe: () => () => {},
  },
}));

function StatusProbe() {
  const { error } = useSyncStatus();
  return <output data-testid="sync-error">{error || ''}</output>;
}

test('reports the actual queue access reason instead of a generic locked message', async () => {
  offlineQueue.getQueueItems.mockRejectedValueOnce(
    new Error('Offline access is not prepared for this device.')
  );
  render(<StatusProbe />);

  await waitFor(() => expect(screen.getByTestId('sync-error'))
    .toHaveTextContent('Offline access is not prepared for this device.'));
});
