import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api/apiClient';
import UserManagementPage from './UserManagementPage';

jest.mock('../../services/api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

const user = {
  user_id: 7,
  full_name: 'Sample User',
  username: 'sample.user',
  contact_number: '',
  email: '',
  role: 'bhw',
  is_active: true,
  is_locked: false,
  must_change_password: false,
  profile_photo: null,
  created_at: '2026-01-15T10:00:00Z',
  created_by_name: 'System setup',
  activity: [],
};

function renderUsersPage() {
  return render(
    <AuthContext.Provider value={{ user: { user_id: 1, role: 'admin', device_id: 'current-device' }, logout: jest.fn() }}>
      <MemoryRouter>
        <UserManagementPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockImplementation((path) => {
    if (path === '/users') {
      return Promise.resolve({
        data: {
          success: true,
          data: [user],
          total: 1,
          counts: { total: 1, active: 1, inactive: 0, locked: 0, temporary: 0, active_admins: 1 },
        },
      });
    }
    if (path === '/dashboard/admin-summary') {
      return Promise.resolve({ data: { success: true, data: { usersByRole: { bhw: 3, official: 2 } } } });
    }
    if (path === '/users/7') return Promise.resolve({ data: { success: true, data: user } });
    if (path === '/users/7/offline-devices') return Promise.resolve({ data: { success: true, data: [] } });
    return Promise.resolve({ data: { success: true, data: [] } });
  });
});

test('shows server-backed role totals and opens user details in a centered dialog', async () => {
  renderUsersPage();

  expect(await screen.findByRole('heading', { name: 'System Users' })).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: /BHW Accounts/ })).toHaveTextContent('3');
  expect(screen.getByRole('button', { name: /Official Accounts/ })).toHaveTextContent('2');

  const row = screen.getByRole('row', { name: /Open Sample User/ });
  fireEvent.click(row);

  const dialog = await screen.findByRole('dialog', { name: 'Sample User' });
  expect(dialog.parentElement).toHaveClass('users-detail-modal');
  expect(document.body.style.overflow).toBe('hidden');
  expect(screen.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('heading', { name: 'Personal information' })).toBeInTheDocument();
  expect(screen.getAllByText('Not provided')).toHaveLength(2);
  expect(screen.getByRole('heading', { name: 'Account information' })).toBeInTheDocument();

  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sample User' })).not.toBeInTheDocument());
  expect(document.body.style.overflow).toBe('');
  await waitFor(() => expect(row).toHaveFocus());
});

test('keeps security device data cached when switching between detail tabs', async () => {
  const defaultGet = api.get.getMockImplementation();
  api.get.mockImplementation((path, ...args) => path === '/users/7/offline-devices'
    ? new Promise((resolve) => window.setTimeout(() => resolve({ data: { success: true, data: [] } }), 20))
    : defaultGet(path, ...args));

  renderUsersPage();
  fireEvent.click(await screen.findByRole('row', { name: /Open Sample User/ }));

  const securityTab = await screen.findByRole('tab', { name: 'Security' });
  fireEvent.click(securityTab);
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/users/7/offline-devices'));
  expect(await screen.findByText('Loading devices…')).toBeInTheDocument();
  expect(await screen.findByText('No device registrations.')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: 'Profile' }));
  fireEvent.click(securityTab);
  await waitFor(() => expect(api.get.mock.calls.filter(([path]) => path === '/users/7/offline-devices')).toHaveLength(1));
  expect(api.get.mock.calls.filter(([path]) => path === '/users/7')).toHaveLength(1);
});

test('asks before leaving a profile edit with unsaved changes', async () => {
  renderUsersPage();
  fireEvent.click(await screen.findByRole('row', { name: /Open Sample User/ }));
  await screen.findByRole('dialog', { name: 'Sample User' });
  fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }));

  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Updated User' } });
  fireEvent.click(screen.getByRole('tab', { name: 'Security' }));

  const discardDialog = await screen.findByRole('dialog', { name: 'Discard unsaved changes?' });
  fireEvent.click(within(discardDialog).getByRole('button', { name: 'Discard changes' }));

  expect(screen.getByRole('tab', { name: 'Security' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
});

test('role summary cards apply the existing URL-backed role filter', async () => {
  renderUsersPage();
  fireEvent.click(await screen.findByRole('button', { name: /BHW Accounts/ }));

  await waitFor(() => {
    expect(api.get).toHaveBeenLastCalledWith('/users', {
      params: expect.objectContaining({ role: 'bhw', page: 1 }),
    });
  });
});
