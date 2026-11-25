let networkService;

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  global.fetch = jest.fn();
  networkService = require('./networkService');
});

afterEach(() => {
  jest.useRealTimers();
  delete global.fetch;
});

test('requires two network probe failures before declaring no network', async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  window.dispatchEvent(new Event('offline'));
  await Promise.resolve();
  global.fetch.mockRejectedValue(new Error('Network Error'));

  await networkService.checkNow();
  expect(networkService.getConnectivityState().state).toBe('server-unreachable');

  await networkService.checkNow();
  expect(networkService.getConnectivityState().state).toBe('offline');
});

test('a successful cache-busted API health probe restores online state', async () => {
  const onlineEvent = jest.fn();
  window.addEventListener('healthsync:connectivity-online', onlineEvent);
  global.fetch.mockResolvedValue({ ok: true, status: 200 });

  await networkService.checkNow();

  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringMatching(/\/health\?_=/),
    expect.objectContaining({ cache: 'no-store', method: 'GET' })
  );
  expect(networkService.getConnectivityState().state).toBe('online');
  expect(onlineEvent).toHaveBeenCalledTimes(1);
  window.removeEventListener('healthsync:connectivity-online', onlineEvent);
});

test('HTTP errors are treated as server responses, not as offline network failures', () => {
  networkService.reportApiSuccess(401);
  expect(networkService.getConnectivityState().state).toBe('online');

  networkService.reportApiSuccess(503);
  expect(networkService.getConnectivityState().state).toBe('server-unreachable');
});

test('health probe HTTP 404 and 401 are reachability successes', async () => {
  global.fetch
    .mockResolvedValueOnce({ ok: false, status: 404 })
    .mockResolvedValueOnce({ ok: false, status: 401 });

  await expect(networkService.checkNow()).resolves.toBe(true);
  expect(networkService.getConnectivityState().state).toBe('online');
  await expect(networkService.checkNow()).resolves.toBe(true);
  expect(networkService.getConnectivityState().state).toBe('online');
});

test('health probe 5xx responses report server unreachable', async () => {
  global.fetch.mockResolvedValue({ ok: false, status: 503 });

  await expect(networkService.checkNow()).resolves.toBe(false);
  expect(networkService.getConnectivityState()).toMatchObject({
    state: 'server-unreachable',
  });
});

test('passive 401 and 404 API responses mark the server reachable', () => {
  networkService.reportApiSuccess(401);
  expect(networkService.getConnectivityState().state).toBe('online');

  networkService.reportApiSuccess(404);
  expect(networkService.getConnectivityState().state).toBe('online');
});

test('a network failure schedules a capped backoff probe', async () => {
  global.fetch.mockRejectedValue(new Error('Network Error'));

  await networkService.checkNow();
  expect(global.fetch).toHaveBeenCalledTimes(1);

  jest.advanceTimersByTime(2200);
  await Promise.resolve();
  expect(global.fetch).toHaveBeenCalledTimes(2);
});
