import {
  clearOfflineSession,
  createOfflineSession,
  getOfflineSession,
} from './offlineSessionService';

beforeEach(() => {
  localStorage.clear();
});

test('creates an account- and role-scoped offline authorization grant', () => {
  const grant = createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-7' });

  expect(grant).toEqual({
    version: 2,
    userId: '7',
    role: 'bhw',
    deviceId: 'device-7',
    createdAt: expect.any(Number),
  });
  expect(getOfflineSession()).toEqual(grant);
});

test('keeps authorization valid after long periods without an expiry', () => {
  const grant = createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-7' });
  localStorage.setItem('hs_offline_session', JSON.stringify({
    ...grant,
    createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
  }));

  expect(getOfflineSession()).toEqual(expect.objectContaining({ deviceId: 'device-7' }));
});

test('rejects incomplete grants without silently deleting persisted authorization metadata', () => {
  expect(() => createOfflineSession({ userId: 7, role: '' })).toThrow('valid account, role');
  const legacyGrant = JSON.stringify({
    userId: '7',
    role: 'bhw',
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() - 1,
  });
  localStorage.setItem('hs_offline_session', legacyGrant);

  expect(getOfflineSession()).toBeNull();
  expect(localStorage.getItem('hs_offline_session')).toBe(legacyGrant);
});

test('clears only offline authorization metadata', () => {
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-7' });
  localStorage.setItem('hs_token', 'server-token');

  clearOfflineSession();

  expect(getOfflineSession()).toBeNull();
  expect(localStorage.getItem('hs_token')).toBe('server-token');
});
