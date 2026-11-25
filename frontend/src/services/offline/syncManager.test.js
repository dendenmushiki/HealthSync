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
    getResidentIdMapping: jest.fn(),
    putResidentIdMapping: jest.fn(),
    rewriteResidentReferences: jest.fn(),
  },
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
  offlineQueue.getResidentIdMapping.mockResolvedValue(null);
  offlineQueue.putResidentIdMapping.mockResolvedValue(null);
  offlineQueue.rewriteResidentReferences.mockResolvedValue(0);
  api.request.mockReset();
  api.post.mockReset();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('processes queued items in sequence instead of device-clock order', async () => {
  const laterClock = {
    offlineOperationId: 'second-operation',
    userId: '7',
    operation: 'CREATE',
    table: 'health_records',
    sequence: 2,
    createdAt: '2026-11-20T00:00:00.000Z',
    status: 'PENDING',
    payload: { resident_id: 5 },
    request: { method: 'POST', url: '/health-records', data: { resident_id: 5 } },
  };
  const earlierClock = {
    offlineOperationId: 'first-operation',
    userId: '7',
    operation: 'CREATE',
    table: 'residents',
    sequence: 1,
    createdAt: '2026-11-25T00:00:00.000Z',
    status: 'PENDING',
    payload: { first_name: 'First', last_name: 'Resident' },
    request: { method: 'POST', url: '/residents', data: { first_name: 'First', last_name: 'Resident' } },
  };
  queue = [laterClock, earlierClock];
  const attempted = [];
  api.request.mockImplementation(async ({ headers }) => {
    attempted.push(headers['X-Idempotency-Key']);
    return headers['X-Idempotency-Key'] === 'first-operation'
      ? { data: { success: true, data: { resident_id: 77 } } }
      : { data: { success: true, data: { id: 12 } } };
  });

  await runSync();

  expect(attempted).toEqual(['first-operation', 'second-operation']);
  expect(earlierClock.status).toBe('SYNCED');
  expect(laterClock.status).toBe('SYNCED');
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
      'X-HealthSync-Offline-Sync': 'true',
      Authorization: 'Bearer account-a-token',
    }),
  }));
  expect(child.status).toBe('SYNCED');
});

test('persists resident ID mappings and rewrites dependents after the parent syncs', async () => {
  const resident = {
    offlineOperationId: 'resident-operation',
    userId: '7',
    operation: 'CREATE',
    table: 'residents',
    status: 'PENDING',
    sequence: 1,
    payload: { first_name: 'Offline', last_name: 'Resident' },
    localRecord: {
      resident_id: 'offline:resident-operation',
      offlineResidentId: 'offline:resident-operation',
    },
    request: { method: 'POST', url: '/residents', data: { first_name: 'Offline', last_name: 'Resident' } },
  };
  const dependent = {
    offlineOperationId: 'clinical-operation',
    userId: '7',
    operation: 'CREATE',
    table: 'patient_clinical_records',
    status: 'PENDING',
    sequence: 2,
    payload: { resident_id: 'offline:resident-operation' },
    request: {
      method: 'POST',
      url: '/resident-medical-records/offline:resident-operation/clinical',
      data: { resident_id: 'offline:resident-operation' },
    },
  };
  queue = [resident, dependent];
  api.request
    .mockResolvedValueOnce({ data: { success: true, data: { resident_id: 77 } } })
    .mockResolvedValueOnce({ data: { success: true, data: { id: 12 } } });

  await runSync();

  expect(resident.status).toBe('SYNCED');
  expect(resident.serverRecordId).toBe(77);
  expect(offlineQueue.putResidentIdMapping).toHaveBeenCalledWith(
    'offline:resident-operation',
    77,
    '7'
  );
  expect(offlineQueue.rewriteResidentReferences).toHaveBeenCalledWith(
    'offline:resident-operation',
    77,
    '7'
  );
  expect(dependent.status).toBe('SYNCED');
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
  api.request
    .mockRejectedValueOnce(new Error('Network Error'))
    .mockResolvedValueOnce({ data: { success: true, data: { health_record_id: 15 } } });

  await runSync();
  expect(item.status).toBe('CONFLICT');
  expect(item.savedOffline).toBe(true);
  expect(item.lastError).toContain('same operation key');

  await runSync({ manual: true });

  expect(api.request).toHaveBeenCalledTimes(2);
  expect(api.request.mock.calls.map(([request]) => request.headers['X-Idempotency-Key']))
    .toEqual([item.offlineOperationId, item.offlineOperationId]);
  expect(api.request.mock.calls.every(([request]) => request.headers['X-HealthSync-Offline-Sync'] === 'true')).toBe(true);
  expect(item.status).toBe('SYNCED');
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
  expect(queue.every((item) => item.status === 'CONFLICT')).toBe(true);

  await runSync({ manual: true });

  expect(queue.every((item) => item.status === 'SYNCED')).toBe(true);
  const orderedKeys = [...tables].sort((first, second) => first.localeCompare(second))
    .map((table) => `${table}-operation`);
  expect(api.request.mock.calls.map(([request]) => request.headers['X-Idempotency-Key']))
    .toEqual([...orderedKeys, ...orderedKeys]);
});

test('does not synchronize legacy report remark queue entries', async () => {
  const remark = {
    offlineOperationId: 'legacy-report-remark',
    userId: '7',
    operation: 'UPDATE',
    table: 'report_remarks',
    status: 'PENDING',
    request: { method: 'PUT', url: '/reports/fhsis/remarks', data: { remark: 'Draft' } },
  };
  queue = [remark];

  await runSync();

  expect(api.request).not.toHaveBeenCalled();
  expect(remark.status).toBe('PENDING');
});

test('preserves queued changes when the cross-tab lease cannot be stored', async () => {
  const item = {
    offlineOperationId: 'lease-storage-unavailable',
    userId: '7',
    operation: 'CREATE',
    table: 'health_records',
    status: 'PENDING',
    request: { method: 'POST', url: '/health-records', data: { resident_id: 5 } },
  };
  queue = [item];
  const originalSetItem = Storage.prototype.setItem;
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(key, value) {
    if (key.startsWith('healthsync_sync_lease_')) throw new Error('Storage unavailable');
    return originalSetItem.call(this, key, value);
  });

  await expect(runSync()).resolves.toMatchObject({ skipped: true });

  expect(api.request).not.toHaveBeenCalled();
  expect(item.status).toBe('PENDING');
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
  expect(item.status).toBe('CONFLICT');

  await runSync({ manual: true });

  expect(api.post).toHaveBeenCalledTimes(2);
  expect(api.post.mock.calls.map(([, , config]) => config.headers['X-Idempotency-Key']))
    .toEqual([item.offlineOperationId, item.offlineOperationId]);
  expect(api.post.mock.calls.every(([, , config]) => config.headers['X-HealthSync-Offline-Sync'] === 'true')).toBe(true);
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
  expect(item.lastError).toContain('rolled back this attempt');
  await runSync({ manual: true });

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
    operation: 'UPDATE',
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

test('replays an uncertain create with the same key and stores the table record ID', async () => {
  const item = {
    offlineOperationId: '123e4567-e89b-42d3-a456-426614174000',
    userId: '7',
    operation: 'CREATE',
    table: 'adult_bmi_records',
    status: 'PENDING',
    request: {
      method: 'POST',
      url: '/adult-bmi',
      data: { resident_id: 5, date_recorded: '2026-11-21', height_cm: 170, weight_kg: 65 },
    },
    localRecord: { resident_id: 5, record_type: 'Adult BMI' },
  };
  queue = [item];
  api.request
    .mockRejectedValueOnce({
      response: {
        status: 409,
        data: { errorCode: 'IDEMPOTENCY_OUTCOME_UNKNOWN' },
      },
    })
    .mockResolvedValueOnce({
      data: { success: true, data: { bmi_id: 91, resident_id: 5 } },
    });

  await runSync();

  expect(item.status).toBe('CONFLICT');
  expect(item.retryCount).toBe(1);
  await runSync({ manual: true });

  expect(api.request).toHaveBeenCalledTimes(2);
  expect(api.request.mock.calls.map(([request]) => request.headers['X-Idempotency-Key']))
    .toEqual([item.offlineOperationId, item.offlineOperationId]);
  expect(item.status).toBe('SYNCED');
  expect(item.serverRecordId).toBe(91);
  expect(item.localRecord.id).toBe(91);
});

test('rechecks older uncertain create entries using their original idempotency key', async () => {
  const item = {
    offlineOperationId: '123e4567-e89b-42d3-a456-426614174000',
    userId: '7',
    operation: 'CREATE',
    table: 'residents',
    status: 'CONFLICT',
    retryCount: 1,
    request: { method: 'POST', url: '/residents', data: { first_name: 'Offline', last_name: 'Resident' } },
    localRecord: { first_name: 'Offline', last_name: 'Resident', resident_id: 'offline:resident' },
  };
  queue = [item];
  api.request.mockResolvedValue({
    data: { success: true, data: { resident_id: 37, first_name: 'Offline', last_name: 'Resident' } },
  });

  await runSync();

  expect(api.request).toHaveBeenCalledWith(expect.objectContaining({
    headers: expect.objectContaining({ 'X-Idempotency-Key': item.offlineOperationId }),
  }));
  expect(item.status).toBe('SYNCED');
  expect(item.serverRecordId).toBe(37);
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

test('pauses the queue on an expired session without failing queued changes', async () => {
  const first = {
    offlineOperationId: 'expired-session-operation',
    userId: '7',
    operation: 'CREATE',
    table: 'health_records',
    status: 'PENDING',
    request: { method: 'POST', url: '/health-records', data: { resident_id: 5 } },
  };
  const second = {
    ...first,
    offlineOperationId: 'later-operation',
  };
  queue = [first, second];
  api.request.mockRejectedValue({
    response: { status: 401, data: { message: 'Session expired' } },
  });

  const result = await runSync();

  expect(result.authRequired).toBe(true);
  expect(api.request).toHaveBeenCalledTimes(1);
  expect(first.status).toBe('PENDING');
  expect(first.lastError).toBe('Sign in again to sync this saved change.');
  expect(first.lastErrorCode).toBe('AUTH_REQUIRED');
  expect(first.attempts).toBe(2);
  expect(first.lastAttemptAt).toBeTruthy();
  expect(first.nextRetryAt).toBeNull();
  expect(second.status).toBe('PENDING');
});

test('marks permanent 400 and 422 responses for attention without automatic retry', async () => {
  queue = [
    {
      offlineOperationId: 'bad-400',
      userId: '7',
      operation: 'CREATE',
      table: 'health_records',
      status: 'PENDING',
      request: { method: 'POST', url: '/health-records', data: { resident_id: 5 } },
    },
    {
      offlineOperationId: 'bad-422',
      userId: '7',
      operation: 'CREATE',
      table: 'adult_bmi_records',
      status: 'PENDING',
      request: { method: 'POST', url: '/adult-bmi', data: { resident_id: 5 } },
    },
  ];
  api.request
    .mockRejectedValueOnce({
      response: { status: 400, data: { errorCode: 'VALIDATION_ERROR' } },
    })
    .mockRejectedValueOnce({
      response: { status: 422, data: { errorCode: 'INVALID_BMI_VALUE' } },
    });

  const result = await runSync();

  expect(result.failed).toBe(2);
  expect(queue[0]).toEqual(expect.objectContaining({
    status: 'FAILED',
    lastErrorCode: 'VALIDATION_ERROR',
    nextRetryAt: null,
  }));
  expect(queue[1]).toEqual(expect.objectContaining({
    status: 'FAILED',
    lastErrorCode: 'INVALID_BMI_VALUE',
    nextRetryAt: null,
  }));
});

test('respects Retry-After and marks 429 changes as transient', async () => {
  const item = {
    offlineOperationId: 'rate-limited-operation',
    userId: '7',
    operation: 'CREATE',
    table: 'health_records',
    status: 'PENDING',
    request: { method: 'POST', url: '/health-records', data: { resident_id: 5 } },
  };
  queue = [item];
  api.request.mockRejectedValue({
    response: {
      status: 429,
      headers: { 'retry-after': '120' },
      data: { errorCode: 'RATE_LIMITED' },
    },
  });

  await runSync();

  expect(item.status).toBe('PENDING');
  expect(item.nextRetryAt).toBeTruthy();
  expect(Date.parse(item.nextRetryAt)).toBeGreaterThan(Date.now() + 100000);
  expect(item.lastError).toContain('rate-limiting');
});

test('leaves a dependent record blocked while its offline resident needs attention', async () => {
  const parent = {
    offlineOperationId: 'resident-parent',
    userId: '7',
    operation: 'CREATE',
    table: 'residents',
    status: 'FAILED',
    lastErrorCode: 'VALIDATION_ERROR',
    localRecord: { resident_id: 'offline:resident-parent', offlineResidentId: 'offline:resident-parent' },
  };
  const dependent = {
    offlineOperationId: 'clinical-dependent',
    userId: '7',
    operation: 'CREATE',
    table: 'patient_clinical_records',
    status: 'PENDING',
    payload: { resident_id: 'offline:resident-parent' },
    request: { method: 'POST', url: '/resident-medical-records/offline:resident-parent/clinical', data: { resident_id: 'offline:resident-parent' } },
  };
  queue = [parent, dependent];

  const result = await runSync();

  expect(api.request).not.toHaveBeenCalled();
  expect(result.blocked).toBe(1);
  expect(dependent.status).toBe('BLOCKED');
  expect(dependent.lastError).toContain('Resident registration needs attention');
});
