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
  localStorage.clear();
  localStorage.setItem('hs_user', JSON.stringify({ user_id: 7, role: 'bhw' }));
  localStorage.setItem('hs_token', 'account-a-token');
  Object.defineProperty(global.navigator, 'onLine', { configurable: true, value: true });
  offlineQueue.getPendingOperations.mockImplementation(async (userId) => queue
    .filter((item) => item.status === 'PENDING' && String(item.userId) === String(userId)));
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
    userId: '7',
    operation: 'CREATE',
    table: 'residents',
    status: 'SYNCED',
    serverRecordId: 77,
    localRecord: { resident_id: 'offline:resident-operation', offlineResidentId: 'offline:resident-operation' },
  };
  const child = {
    offlineOperationId: 'clinical-operation',
    userId: '7',
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
    headers: expect.objectContaining({
      'X-Idempotency-Key': 'clinical-operation',
      Authorization: 'Bearer account-a-token',
    }),
  }));
  expect(child.status).toBe('SYNCED');
});

test('retries interrupted direct requests with the same idempotency key', async () => {
  const item = {
    offlineOperationId: '123e4567-e89b-42d3-a456-426614174000',
    userId: '7',
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
  expect(item.savedOffline).toBe(true);
  expect(item.lastError).toContain('same idempotency key');

  await runSync();

  expect(api.request).toHaveBeenCalledTimes(2);
  expect(api.request.mock.calls.map(([request]) => request.headers['X-Idempotency-Key']))
    .toEqual([item.offlineOperationId, item.offlineOperationId]);
  expect(item.status).toBe('PENDING');
});

test('automatically retries supported direct record types with their original keys', async () => {
  const tables = [
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
    'report_remarks',
  ];
  queue = tables.map((table) => ({
    offlineOperationId: `${table}-operation`,
    userId: '7',
    operation: 'CREATE',
    table,
    status: 'PENDING',
    request: { method: 'POST', url: `/${table}`, data: { resident_id: 5 } },
  }));
  const attemptedKeys = new Set();
  api.request.mockImplementation(async ({ headers }) => {
    const key = headers['X-Idempotency-Key'];
    if (!attemptedKeys.has(key)) {
      attemptedKeys.add(key);
      throw new Error('Network Error');
    }
    return { data: { success: true, data: { id: 91 } } };
  });

  await runSync();
  expect(queue.every((item) => item.status === 'PENDING')).toBe(true);

  await runSync();

  expect(queue.every((item) => item.status === 'SYNCED')).toBe(true);
  expect(api.request.mock.calls.map(([request]) => request.headers['X-Idempotency-Key']))
    .toEqual([...tables.map((table) => `${table}-operation`), ...tables.map((table) => `${table}-operation`)]);
});

test('automatically retries generic sync operations after network loss using the same key', async () => {
  const item = {
    offlineOperationId: 'generic-health-record-operation',
    userId: '7',
    operation: 'CREATE',
    module: 'health_records',
    table: 'health_records',
    payload: { resident_id: 5, diagnosis: 'Test' },
    status: 'PENDING',
  };
  queue = [item];
  api.post
    .mockRejectedValueOnce(new Error('Network Error'))
    .mockResolvedValueOnce({ data: { success: true, data: { serverRecordId: 91 } } });

  await runSync();
  expect(item.status).toBe('PENDING');

  await runSync();

  expect(api.post).toHaveBeenCalledTimes(2);
  expect(api.post.mock.calls.map(([, , config]) => config.headers['X-Idempotency-Key']))
    .toEqual([item.offlineOperationId, item.offlineOperationId]);
  expect(item.status).toBe('SYNCED');
});

test('retries a confirmed safe rollback with the same key and surfaces the backend message', async () => {
  const item = {
    offlineOperationId: '123e4567-e89b-42d3-a456-426614174000',
    userId: '7',
    operation: 'CREATE',
    table: 'adult_bmi_records',
    status: 'PENDING',
    request: { method: 'POST', url: '/adult-bmi', data: { resident_id: 5 } },
  };
  queue = [item];
  api.request
    .mockRejectedValueOnce({
      response: {
        status: 503,
        data: {
          errorCode: 'IDEMPOTENCY_RETRY_SAFE',
          message: 'The transaction rolled back. Retry this change.',
        },
      },
    })
    .mockResolvedValueOnce({ data: { success: true, data: { bmi_id: 91 } } });

  await runSync();

  expect(item.status).toBe('PENDING');
  expect(item.lastError).toBe('The transaction rolled back. Retry this change.');
  await runSync();

  expect(api.request).toHaveBeenCalledTimes(2);
  expect(api.request.mock.calls.map(([request]) => request.headers['X-Idempotency-Key']))
    .toEqual([item.offlineOperationId, item.offlineOperationId]);
  expect(item.status).toBe('SYNCED');
});

test('does not process Account A operations while Account B is active', async () => {
  const accountAOperation = {
    offlineOperationId: 'account-a-operation',
    userId: '7',
    operation: 'CREATE',
    table: 'adult_bmi_records',
    status: 'PENDING',
    request: { method: 'POST', url: '/adult-bmi', data: { resident_id: 12 } },
  };
  queue = [accountAOperation];
  localStorage.setItem('hs_user', JSON.stringify({ user_id: 8, role: 'bhw' }));
  localStorage.setItem('hs_token', 'account-b-token');

  await runSync();

  expect(api.request).not.toHaveBeenCalled();
  expect(accountAOperation.status).toBe('PENDING');
  expect(offlineQueue.getPendingOperations).toHaveBeenCalledWith('8');
});

test('pins a synchronization request to Account A and stops local updates if the account switches in flight', async () => {
  const accountAOperation = {
    offlineOperationId: 'account-a-operation',
    userId: '7',
    operation: 'CREATE',
    table: 'adult_bmi_records',
    status: 'PENDING',
    request: { method: 'POST', url: '/adult-bmi', data: { resident_id: 12 } },
  };
  queue = [accountAOperation];
  api.request.mockImplementation(async () => {
    localStorage.setItem('hs_user', JSON.stringify({ user_id: 8, role: 'bhw' }));
    localStorage.setItem('hs_token', 'account-b-token');
    return { data: { success: true, data: { bmi_id: 91 } } };
  });

  await runSync();

  expect(api.request).toHaveBeenCalledWith(expect.objectContaining({
    headers: expect.objectContaining({ Authorization: 'Bearer account-a-token' }),
  }));
  expect(accountAOperation.status).toBe('SYNCING');
  expect(accountAOperation.syncComplete).not.toBe(true);
});

test('uses an exclusive browser lock to avoid concurrent synchronization in separate tabs', async () => {
  const previousLocks = navigator.locks;
  const requestLock = jest.fn((name, options, callback) => callback({ name }));
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: requestLock },
  });
  queue = [{
    offlineOperationId: 'locked-sync-operation',
    userId: '7',
    operation: 'CREATE',
    table: 'health_records',
    status: 'PENDING',
    request: { method: 'POST', url: '/health-records', data: { resident_id: 5 } },
  }];
  api.request.mockResolvedValue({ data: { success: true, data: { id: 91 } } });

  try {
    await runSync();
    expect(requestLock).toHaveBeenCalledWith(
      'healthsync-offline-sync:7%3Aunknown-device',
      { mode: 'exclusive', ifAvailable: true },
      expect.any(Function)
    );
    expect(queue[0].status).toBe('SYNCED');
  } finally {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: previousLocks });
  }
});

test('requires attention when the idempotency service reports an unknown server outcome', async () => {
  const item = {
    offlineOperationId: '123e4567-e89b-42d3-a456-426614174000',
    userId: '7',
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
  await runSync();
  expect(api.request).toHaveBeenCalledTimes(1);
});

test('marks unknown generic sync outcomes for review instead of retrying them', async () => {
  const item = {
    offlineOperationId: '123e4567-e89b-42d3-a456-426614174000',
    userId: '7',
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
