const listeners = new Set();
let backendAvailable = null;
let healthCheckPromise = null;

function notify(status) {
  for (const l of listeners) l(status);
}

export function setBackendAvailability(available) {
  backendAvailable = Boolean(available);
  notify({ online: typeof navigator === 'undefined' ? true : navigator.onLine, backendAvailable });
}

export function isBackendUnavailable() {
  return backendAvailable === false;
}

export function isOffline() {
  return (typeof navigator !== 'undefined' && !navigator.onLine) || isBackendUnavailable();
}

export function startNetworkMonitor() {
  const update = () => notify({ online: navigator.onLine, backendAvailable });
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  // initial
  update();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function healthCheck() {
  if (healthCheckPromise) return healthCheckPromise;
  const apiBase = (process.env.REACT_APP_API_URL || 'http://localhost:5000/api').replace(/\/+$/, '');
  const url = `${apiBase}/health`;
  healthCheckPromise = (async () => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? window.setTimeout(() => controller.abort(), 4000) : null;
    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        ...(controller ? { signal: controller.signal } : {}),
      });
      setBackendAvailability(response.ok);
      return response.ok;
    } catch (error) {
      setBackendAvailability(false);
      return false;
    } finally {
      if (timeout !== null) window.clearTimeout(timeout);
    }
  })().finally(() => { healthCheckPromise = null; });
  return healthCheckPromise;
}

const networkService = {
  startNetworkMonitor,
  subscribe,
  healthCheck,
  isBackendUnavailable,
  isOffline,
  setBackendAvailability,
};

export default networkService;
