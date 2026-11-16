import {
  clearOfflineSession,
  createOfflineSession,
  getOfflineSession,
} from './offlineSessionService';

beforeEach(() => {
  localStorage.clear();
});

test('creates an account- and role-scoped offline authorization grant', () => {
  const grant = createOfflineSession({ userId: 7, role: 'bhw' });

  expect(grant).toEqual({
    userId: '7',
    role: 'bhw',
    createdAt: expect.any(Number),
    expiresAt: expect.any(Number),
  });
  expect(getOfflineSession()).toEqual(grant);
});

test('rejects invalid grants and clears expired authorization', () => {
  expect(() => createOfflineSession({ userId: 7, role: '' })).toThrow('valid account and role');
  localStorage.setItem('hs_offline_session', JSON.stringify({
    userId: '7',
    role: 'bhw',
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() - 1,
  }));

  expect(getOfflineSession()).toBeNull();
  expect(localStorage.getItem('hs_offline_session')).toBeNull();
});

test('clears only offline authorization metadata', () => {
  createOfflineSession({ userId: 7, role: 'bhw' });
  localStorage.setItem('hs_token', 'server-token');

  clearOfflineSession();

  expect(getOfflineSession()).toBeNull();
  expect(localStorage.getItem('hs_token')).toBe('server-token');
});
