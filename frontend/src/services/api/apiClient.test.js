import api from './apiClient';
import { enqueueOperation, getOperation, updateOperationStatus } from '../offline/offlineQueueService';

jest.mock('../offline/offlineQueueService', () => ({
  __esModule: true,
  enqueueOperation: jest.fn(),
  getOperation: jest.fn(),
  updateOperationStatus: jest.fn(),
}));

jest.mock('../offline/networkService', () => ({
  setBackendAvailability: jest.fn(),
}));

function setActiveAccount() {
  localStorage.setItem('hs_user', JSON.stringify({ user_id: 7, role: 'bhw' }));
  localStorage.setItem('hs_token', 'active-token');
}

beforeEach(() => {
  jest.clearAllMocks();
  setActiveAccount();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  enqueueOperation.mockImplementation(async (operation) => ({
    ...operation,
    offlineOperationId: operation.offlineOperationId,
  }));
  updateOperationStatus.mockResolvedValue({});
});

test('a confirmed online write is sent directly without creating a queue item', async () => {
  api.defaults.adapter = jest.fn(async (config) => ({
    data: { success: true, data: { record_id: 91 } },
    status: 201,
    statusText: 'Created',
    headers: {},
    config,
  }));

  const response = await api.post('/adult-bmi', { resident_id: 12, bmi: 21 });

  expect(response.data.success).toBe(true);
  expect(response.config.headers['X-Idempotency-Key']).toBeTruthy();
  expect(enqueueOperation).not.toHaveBeenCalled();
  expect(getOperation).not.toHaveBeenCalled();
  expect(updateOperationStatus).not.toHaveBeenCalled();
});

test('an unconfirmed network write is queued with the idempotency key used by the request', async () => {
  api.defaults.adapter = jest.fn(async (config) => {
    const error = new Error('Network Error');
    error.code = 'ERR_NETWORK';
    error.config = config;
    throw error;
  });

  const response = await api.post('/adult-bmi', { resident_id: 12, bmi: 21 });
  const [{ offlineOperationId, request }] = enqueueOperation.mock.calls[0];

  expect(response.data).toMatchObject({ success: true, offline: true, queued: true });
  expect(request.method).toBe('POST');
  expect(response.config.headers['X-Idempotency-Key']).toBe(offlineOperationId);
  expect(updateOperationStatus).toHaveBeenCalledWith(
    offlineOperationId,
    expect.objectContaining({ status: 'PENDING' }),
    '7',
  );
});

test('a successful HTTP response without application confirmation is preserved as uncertain', async () => {
  api.defaults.adapter = jest.fn(async (config) => ({
    data: { message: 'No success result returned' },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  }));

  const response = await api.post('/adult-bmi', { resident_id: 12, bmi: 21 });
  const [{ offlineOperationId }] = enqueueOperation.mock.calls[0];

  expect(response.data.success).toBeUndefined();
  expect(updateOperationStatus).toHaveBeenCalledWith(
    offlineOperationId,
    expect.objectContaining({ status: 'CONFLICT' }),
    '7',
  );
});
