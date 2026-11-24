import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import OfflineUnlockScreen from './OfflineUnlockScreen';
import { getPinAttemptStatus } from '../../services/offline/offlineVaultService';

jest.mock('../../services/offline/offlineVaultService', () => ({
  getPinAttemptStatus: jest.fn(),
}));

function CurrentPath() {
  const location = useLocation();
  return <output data-testid="current-path">{location.pathname}</output>;
}

function renderScreen({
  authorized = true,
  online = false,
  unlockOfflineAccess = jest.fn().mockResolvedValue(true),
  logout = jest.fn().mockResolvedValue(undefined),
} = {}) {
  getPinAttemptStatus.mockResolvedValue({ maxAttempts: 5, lockoutDurationMinutes: 15, attemptsRemaining: 3, lockedUntil: 0 });
  const onUnlockTransition = jest.fn();
  render(
    <MemoryRouter
      initialEntries={['/login']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route
          path="*"
          element={(
            <>
              <OfflineUnlockScreen
                user={{ user_id: 7, full_name: 'Juan Dela Cruz', role: 'bhw' }}
                unlockOfflineAccess={unlockOfflineAccess}
                logout={logout}
                online={online}
                authorized={authorized}
                onUnlockTransition={onUnlockTransition}
              />
              <CurrentPath />
            </>
          )}
        />
      </Routes>
    </MemoryRouter>
  );
  return { logout, onUnlockTransition, unlockOfflineAccess };
}

beforeEach(() => {
  localStorage.clear();
  getPinAttemptStatus.mockReset();
});

test('explains unavailable offline access without presenting a PIN form', () => {
  renderScreen({ authorized: false });

  expect(screen.getByText(/Offline authorization is unavailable for this account or device/)).toBeInTheDocument();
  expect(screen.queryByLabelText('PIN digit 1 of 6')).not.toBeInTheDocument();
});

test('unlocks with the entered PIN and returns from the login route to the dashboard', async () => {
  const { onUnlockTransition, unlockOfflineAccess } = renderScreen();
  const firstDigit = screen.getByLabelText('PIN digit 1 of 6');
  fireEvent.paste(firstDigit, {
    clipboardData: { getData: () => '004321' },
  });

  await waitFor(() => expect(unlockOfflineAccess).toHaveBeenCalledWith('004321'));
  expect(onUnlockTransition).toHaveBeenCalledWith(true);
  await waitFor(() => expect(screen.getByTestId('current-path')).toHaveTextContent('/dashboard'));
  expect(onUnlockTransition).toHaveBeenLastCalledWith(false);
});

test('clears a rejected PIN, shows the remaining attempts, and offers a retry', async () => {
  getPinAttemptStatus
    .mockResolvedValueOnce({ maxAttempts: 5, lockoutDurationMinutes: 15, attemptsRemaining: 5, lockedUntil: 0 })
    .mockResolvedValueOnce({ maxAttempts: 5, lockoutDurationMinutes: 15, attemptsRemaining: 4, lockedUntil: 0 });
  const { unlockOfflineAccess } = renderScreen({
    unlockOfflineAccess: jest.fn().mockRejectedValue(new Error('PIN is incorrect.')),
  });
  const firstDigit = screen.getByLabelText('PIN digit 1 of 6');
  fireEvent.paste(firstDigit, {
    clipboardData: { getData: () => '123456' },
  });

  expect(await screen.findByText(/We couldn’t unlock HealthSync/)).toBeInTheDocument();
  await waitFor(() => expect(unlockOfflineAccess).toHaveBeenCalledWith('123456'));
  expect(screen.getByText(/4 attempts left before a 15-minute temporary lockout/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  expect(Array.from({ length: 6 }, (_, index) => screen.getByLabelText(`PIN digit ${index + 1} of 6`))
    .map((input) => input.value).join('')).toBe('');
});

test('explains that online password sign-in preserves queued changes after a password-vault mismatch', async () => {
  const { logout } = renderScreen({ online: true });

  fireEvent.click(screen.getByRole('button', { name: 'Sign in with password instead' }));

  expect(screen.getByRole('dialog')).toHaveTextContent(
    'On the sign-in page, use your normal account password.'
  );
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'Signing out keeps encrypted queued changes on this device.'
  );

  fireEvent.click(screen.getByRole('button', { name: 'Sign out and continue' }));
  await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
});
