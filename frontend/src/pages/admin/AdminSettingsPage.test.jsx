import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api/apiClient';
import AdminSettingsPage from './AdminSettingsPage';

jest.mock('../../services/api/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const user = {
  user_id: 7,
  username: 'test-user',
  role: 'bhw',
  device_id: 'device-1',
  offline_pin_enrolled: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockImplementation((path) => {
    if (path === '/admin-settings/account') {
      return Promise.resolve({
        data: { success: true, data: { preferences: {}, loginHistory: [] } },
      });
    }
    if (path === '/auth/devices') {
      return Promise.resolve({ data: { success: true, data: [] } });
    }
    return Promise.resolve({ data: { success: true, data: {} } });
  });
});

test('asks for the account password only after PIN confirmation and Set up PIN', async () => {
  render(
    <MemoryRouter
      initialEntries={['/admin-settings?tab=security']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthContext.Provider value={{
        user,
        updateUser: jest.fn(),
        logout: jest.fn(),
        unlockOfflineAccess: jest.fn(),
      }}>
        <AdminSettingsPage />
      </AuthContext.Provider>
    </MemoryRouter>
  );

  const pinGroup = await screen.findByRole('group', { name: 'New six-digit PIN' });
  const confirmationGroup = screen.getByRole('group', { name: 'Confirm new PIN' });
  const pinInput = within(pinGroup).getByLabelText('PIN digit 1 of 6');
  const confirmationInput = within(confirmationGroup).getByLabelText('PIN digit 1 of 6');
  expect(screen.queryByLabelText('Current account password')).not.toBeInTheDocument();

  fireEvent.paste(pinInput, { clipboardData: { getData: () => '012345' } });
  fireEvent.paste(confirmationInput, { clipboardData: { getData: () => '012345' } });
  fireEvent.click(screen.getByRole('button', { name: 'Set up PIN' }));

  const passwordInput = await screen.findByLabelText('Current account password');
  expect(passwordInput).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Save PIN' })).toBeInTheDocument();
  await waitFor(() => expect(api.post).not.toHaveBeenCalled());
});
