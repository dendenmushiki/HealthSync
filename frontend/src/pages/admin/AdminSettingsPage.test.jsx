import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    <MemoryRouter initialEntries={['/admin-settings?tab=security']}>
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

  const pinInput = await screen.findByLabelText('New six-digit PIN');
  const confirmationInput = screen.getByLabelText('Confirm new PIN');
  expect(screen.queryByLabelText('Current account password')).not.toBeInTheDocument();

  fireEvent.change(pinInput, { target: { value: '012345' } });
  fireEvent.change(confirmationInput, { target: { value: '012345' } });
  fireEvent.click(screen.getByRole('button', { name: 'Set up PIN' }));

  const passwordInput = await screen.findByLabelText('Current account password');
  expect(passwordInput).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Save PIN' })).toBeInTheDocument();
  await waitFor(() => expect(api.post).not.toHaveBeenCalled());
});
