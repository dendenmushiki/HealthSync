import offlineQueue from './offlineQueueService';
import api from '../api/apiClient';
import { runSync } from './syncManager';

jest.mock('./offlineQueueService', () => ({
  __esModule: true,
  default: {
    getPendingOperations: jest.fn(),
    getQueueItems: jest.fn(),
    getOperation: jest.fn(),
    updateOperationStatus: jest.fn(),
  },
}));

jest.mock('../api/apiClient', () => ({
  __esModule: true,
  default: { request: jest.fn(), post: jest.fn() },
}));

let queue;

beforeEach(() => {
  queue = [];
  Object.defineProperty(global.navigator, 'onLine', { configurable: true, value: true });
  offlineQueue.getPendingOperations.mockImplementation(async () => queue.filter((item) => item.status === 'PENDING'));
  offlineQueue.getQueueItems.mockImplementation(async () => queue);
  offlineQueue.getOperation.mockImplementation(async (id) => queue.find((item) => item.offlineOperationId === id));
  offlineQueue.updateOperationStatus.mockImplementation(async (id, updates) => {
    const item = queue.find((entry) => entry.offlineOperationId === id);
    Object.assign(item, updates);
    return item;
  });
  api.request.mockReset();
  api.post.mockReset();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('maps locally created resident IDs to server IDs before syncing dependent records', async () => {
  const resident = {
    offlineOperationId: 'resident-operation',
    operation: 'CREATE',
    table: 'residents',
    status: 'SYNCED',
    serverRecordId: 77,
    localRecord: { resident_id: 'offline:resident-operation', offlineResidentId: 'offline:resident-operation' },
  };
  const child = {
    offlineOperationId: 'clinical-operation',
    operation: 'CREATE',
    table: 'patient_clinical_records',
    status: 'PENDING',
    payload: { resident_id: 'offline:resident-operation', record_data: {} },
    request: {
      method: 'POST',
      url: '/resident-medical-records/offline:resident-operation/clinical',
      data: { resident_id: 'offline:resident-operation', record_data: {} },
    },
  };
  queue = [resident, child];
  api.request.mockResolvedValue({ data: { success: true, data: { id: 12 } } });

  await runSync();

  expect(api.request).toHaveBeenCalledWith(expect.objectContaining({
    url: '/resident-medical-records/77/clinical',
    data: expect.objectContaining({ resident_id: 77 }),
    headers: expect.objectContaining({ 'X-Idempotency-Key': 'clinical-operation' }),
  }));
  expect(child.status).toBe('SYNCED');
});

test('retries interrupted direct requests with the same idempotency key', async () => {
  const item = {
    offlineOperationId: '123e4567-e89b-42d3-a456-426614174000',
    operation: 'CREATE',
    table: 'health_records',
    status: 'PENDING',
    payload: { resident_id: 5 },
    request: { method: 'POST', url: '/health-records', data: { resident_id: 5 } },
  };
  queue = [item];
  api.request.mockRejectedValue(new Error('Network Error'));

  await runSync();
  expect(item.status).toBe('PENDING');
  expect(item.lastError).toContain('same idempotency key');

  await runSync();

  expect(api.request).toHaveBeenCalledTimes(2);
  expect(api.request.mock.calls.map(([request]) => request.headers['X-Idempotency-Key']))
    .toEqual([item.offlineOperationId, item.offlineOperationId]);
  expect(item.status).toBe('PENDING');
});

test('requires attention when the idempotency service reports an unknown server outcome', async () => {
  const item = {
    offlineOperationId: '123e4567-e89b-42d3-a456-426614174000',
    operation: 'CREATE',
    table: 'health_records',
    status: 'PENDING',
    request: { method: 'POST', url: '/health-records', data: { resident_id: 5 } },
  };
  queue = [item];
  api.request.mockRejectedValue({
    response: {
      status: 409,
      data: { errorCode: 'IDEMPOTENCY_OUTCOME_UNKNOWN' },
    },
  });

  await runSync();

  expect(item.status).toBe('CONFLICT');
  expect(item.lastError).toContain('outcome is unknown');
});

test('marks unknown generic sync outcomes for review instead of retrying them', async () => {
  const item = {
    offlineOperationId: '123e4567-e89b-42d3-a456-426614174000',
    operation: 'CREATE',
    module: 'residents',
    table: 'residents',
    payload: { first_name: 'Test' },
    status: 'PENDING',
  };
  queue = [item];
  api.post.mockRejectedValue({
    response: {
      status: 409,
      data: { errorCode: 'IDEMPOTENCY_OUTCOME_UNKNOWN' },
    },
  });

  await runSync();
  await runSync();

  expect(api.post).toHaveBeenCalledTimes(1);
  expect(item.status).toBe('CONFLICT');
});
