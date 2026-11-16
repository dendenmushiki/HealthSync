const listeners = new Set();

function notify(status) {
  for (const l of listeners) l(status);
}

export function startNetworkMonitor() {
  const update = () => notify({ online: navigator.onLine });
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  // initial
  update();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function healthCheck(url = '/api/health') {
  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    return res.ok;
  } catch (err) {
    return false;
  }
}

const networkService = { startNetworkMonitor, subscribe, healthCheck };

export default networkService;
