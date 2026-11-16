export function publishNotification(category, title, description) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('healthsync:notification', {
    detail: { category, title, description, id: `${Date.now()}-${Math.random()}`, createdAt: new Date().toISOString() },
  }));
}
