const listeners = new Set();
const RETRY_DELAYS = [2000, 5000, 10000, 30000, 60000];

let state = {
  state: 'server-unreachable',
  online: false,
  backendAvailable: false,
  lastChecked: null,
  lastOnlineAt: null,
  lastError: null,
};
let failureCount = 0;
let healthCheckPromise = null;
let retryTimer = null;
let started = false;
let browserOnlineHint = typeof navigator === 'undefined' || navigator.onLine;

function notify() {
  listeners.forEach((listener) => listener({ ...state }));
}

function updateState(nextState, lastError = state.lastError) {
  const wasOnline = state.state === 'online';
  const isOnline = nextState === 'online';
  state = {
    ...state,
    state: nextState,
    online: isOnline,
    backendAvailable: isOnline,
    lastChecked: new Date().toISOString(),
    lastOnlineAt: isOnline ? new Date().toISOString() : state.lastOnlineAt,
    lastError,
  };
  notify();
  if (!wasOnline && isOnline && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('healthsync:connectivity-online'));
  }
}

function clearRetry() {
  if (retryTimer !== null) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleRetry() {
  if (typeof window === 'undefined' || retryTimer !== null) return;
  const delay = RETRY_DELAYS[Math.min(failureCount - 1, RETRY_DELAYS.length - 1)] || RETRY_DELAYS[0];
  const jitter = Math.floor(delay * (Math.random() * 0.2 - 0.1));
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    checkNow();
  }, Math.max(1000, delay + jitter));
}

function recordFailure(message, httpStatus = null) {
  failureCount += 1;
  if (httpStatus !== null) {
    updateState('server-unreachable', `Health check returned HTTP ${httpStatus}.`);
  } else if (failureCount >= 2) {
    updateState(browserOnlineHint ? 'server-unreachable' : 'offline', message);
  } else {
    state = {
      ...state,
      lastChecked: new Date().toISOString(),
      lastError: message,
    };
    notify();
  }
  scheduleRetry();
}

export function getConnectivityState() {
  return { ...state };
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function reportApiSuccess(status = 200) {
  if (Number(status) >= 500) {
    failureCount += 1;
    updateState('server-unreachable', `API request returned HTTP ${status}.`);
    scheduleRetry();
    return;
  }
  clearRetry();
  failureCount = 0;
  updateState('online', null);
}

export function reportNetworkFailure() {
  recordFailure('A network request could not reach the server.');
}

export function setBackendAvailability(available, status = 200) {
  if (available) reportApiSuccess(status);
  else reportNetworkFailure();
}

export function isBackendUnavailable() {
  return state.state === 'server-unreachable';
}

export function isOffline() {
  return state.state === 'offline' ||
    (!state.lastChecked && typeof navigator !== 'undefined' && navigator.onLine === false);
}

export async function checkNow() {
  if (healthCheckPromise) return healthCheckPromise;
  browserOnlineHint = typeof navigator === 'undefined' || navigator.onLine;
  const apiBase = (process.env.REACT_APP_API_URL || 'http://localhost:5000/api').replace(/\/+$/, '');
  const separator = apiBase.includes('?') ? '&' : '?';
  const url = `${apiBase}/health${separator}_=${Date.now()}`;
  healthCheckPromise = (async () => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? window.setTimeout(() => controller.abort(), 4000) : null;
    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (response.ok) {
        clearRetry();
        failureCount = 0;
        updateState('online', null);
        return true;
      }
      const httpStatus = Number(response.status) || 0;
      if (httpStatus >= 500) {
        recordFailure(`Health check returned HTTP ${httpStatus}.`, httpStatus);
        return false;
      } else {
        clearRetry();
        failureCount = 0;
        updateState('online', null);
        return true;
      }
    } catch (error) {
      const timedOut = error?.name === 'AbortError';
      recordFailure(timedOut ? 'The server health check timed out.' : 'The server health check failed due to a network error.');
      return false;
    } finally {
      if (timeout !== null) window.clearTimeout(timeout);
    }
  })().finally(() => { healthCheckPromise = null; });
  return healthCheckPromise;
}

export function healthCheck() {
  return checkNow();
}

function updateBrowserHint() {
  browserOnlineHint = typeof navigator === 'undefined' || navigator.onLine;
  checkNow();
}

export function startNetworkMonitor() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', updateBrowserHint);
  window.addEventListener('offline', updateBrowserHint);
  window.addEventListener('focus', checkNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkNow();
  });
  checkNow();
}

const networkService = {
  startNetworkMonitor,
  subscribe,
  healthCheck,
  checkNow,
  getConnectivityState,
  reportApiSuccess,
  reportNetworkFailure,
  isBackendUnavailable,
  isOffline,
  setBackendAvailability,
};

export default networkService;
