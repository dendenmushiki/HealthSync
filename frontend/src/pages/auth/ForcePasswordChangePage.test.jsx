import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
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
    'HealthSyncStrongPassword9!'
  );
});
