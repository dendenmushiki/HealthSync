import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import useSyncStatus, { SyncStatusProvider } from './useSyncStatus';
import offlineQueue from './offlineQueueService';

jest.mock('./offlineQueueService', () => ({
  __esModule: true,
  default: { getQueueItems: jest.fn() },
  SYNCABLE_QUEUE_TABLES: new Set([
    'residents',
    'health_records',
    'child_health_records',
    'operation_timbang',
    'adolescent_bmi_records',
    'adult_bmi_records',
    'senior_citizen_records',
    'patient_clinical_records',
    'child_records',
    'maternal_records',
    'immunization_records',
  ]),
}));

jest.mock('./networkService', () => ({
  __esModule: true,
  default: {
    startNetworkMonitor: jest.fn(),
    subscribe: () => () => {},
  },
}));

function StatusProbe() {
  const { error, waiting } = useSyncStatus();
  return <><output data-testid="sync-error">{error || ''}</output><output data-testid="sync-waiting">{waiting}</output></>;
}

test('reports the actual queue access reason instead of a generic locked message', async () => {
  offlineQueue.getQueueItems.mockRejectedValueOnce(
    new Error('Offline access is not prepared for this device.')
  );
  render(<SyncStatusProvider><StatusProbe /></SyncStatusProvider>);

  await waitFor(() => expect(screen.getByTestId('sync-error'))
    .toHaveTextContent('Offline access is not prepared for this device.'));
});

test('does not count report remarks as offline synchronization status', async () => {
  offlineQueue.getQueueItems.mockResolvedValueOnce([
    { offlineOperationId: 'remark', table: 'report_remarks', status: 'PENDING' },
    { offlineOperationId: 'resident', table: 'residents', status: 'PENDING' },
  ]);
  render(<SyncStatusProvider><StatusProbe /></SyncStatusProvider>);

  await waitFor(() => expect(screen.getByTestId('sync-waiting')).toHaveTextContent('1'));
});
