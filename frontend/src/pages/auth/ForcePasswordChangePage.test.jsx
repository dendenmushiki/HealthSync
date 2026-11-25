import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import { ThemeProvider } from '../../context/ThemeContext';
import api from '../../services/api/apiClient';
import ForcePasswordChangePage from './ForcePasswordChangePage';

jest.mock('../../services/api/apiClient', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

test('preserves leading zeroes while completing first-login password and PIN setup', async () => {
  const user = {
    user_id: 7,
    role: 'bhw',
    must_change_password: true,
    offline_pin_setup_required: true,
  };
  const completePasswordChange = jest.fn().mockResolvedValue(true);
  api.post.mockResolvedValue({
    data: {
      success: true,
      data: { token: 'new-token', user },
    },
  });

  render(
    <ThemeProvider>
      <MemoryRouter
        initialEntries={['/change-password']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <AuthContext.Provider value={{
          user,
          token: 'token',
          completePasswordChange,
          logout: jest.fn(),
          offlineVaultError: null,
        }}>
          <ForcePasswordChangePage />
        </AuthContext.Provider>
      </MemoryRouter>
    </ThemeProvider>
  );

  expect(screen.getByRole('heading', { name: 'Set your password and account PIN' })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Six-digit PIN' })).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('New password'), {
    target: { value: 'HealthSyncStrongPassword9!' },
  });
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: 'HealthSyncStrongPassword9!' },
  });
  fireEvent.paste(
    within(screen.getByRole('group', { name: 'Six-digit PIN' }))
      .getByLabelText('PIN digit 1 of 6'),
    { clipboardData: { getData: () => '000042' } }
  );
  fireEvent.paste(
    within(screen.getByRole('group', { name: 'Confirm six-digit PIN' }))
      .getByLabelText('PIN digit 1 of 6'),
    { clipboardData: { getData: () => '000042' } }
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save password and PIN' }));

  expect(await screen.findByText('PIN registered')).toBeInTheDocument();
  expect(completePasswordChange).toHaveBeenCalledWith(
    'new-token',
    user,
    '000042',
    'HealthSyncStrongPassword9!',
    undefined,
    undefined
  );
});

test('requires an existing vault credential when completing an admin-triggered PIN reset', async () => {
  const user = {
    user_id: 7,
    role: 'bhw',
    must_change_password: false,
    offline_pin_setup_required: true,
    offline_pin_enrolled: true,
    offline_account_pin_enrolled: true,
  };
  const completePasswordChange = jest.fn().mockResolvedValue(true);

  render(
    <ThemeProvider>
      <MemoryRouter
        initialEntries={['/change-password']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <AuthContext.Provider value={{
          user,
          token: 'token',
          completePasswordChange,
          logout: jest.fn(),
          offlineVaultError: null,
        }}>
          <ForcePasswordChangePage />
        </AuthContext.Provider>
      </MemoryRouter>
    </ThemeProvider>
  );

  expect(screen.getByRole('heading', { name: 'Reset your offline PIN' })).toBeInTheDocument();
  expect(screen.getAllByText(/existing offline vault/).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'Save PIN' })).toBeDisabled();

  fireEvent.paste(
    within(screen.getByRole('group', { name: 'Current six-digit PIN' }))
      .getByLabelText('PIN digit 1 of 6'),
    { clipboardData: { getData: () => '000123' } }
  );
  fireEvent.paste(
    within(screen.getByRole('group', { name: 'Six-digit PIN' }))
      .getByLabelText('PIN digit 1 of 6'),
    { clipboardData: { getData: () => '000456' } }
  );
  fireEvent.paste(
    within(screen.getByRole('group', { name: 'Confirm six-digit PIN' }))
      .getByLabelText('PIN digit 1 of 6'),
    { clipboardData: { getData: () => '000456' } }
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }));

  expect(await screen.findByText('Offline PIN reset')).toBeInTheDocument();
  expect(completePasswordChange).toHaveBeenCalledWith(
    'token',
    user,
    '000456',
    undefined,
    '000123',
    undefined
  );
});
