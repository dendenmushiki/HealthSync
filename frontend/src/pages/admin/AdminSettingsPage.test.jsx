import React from 'react';
import { fireEvent, render as testingLibraryRender, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import { ThemeProvider } from '../../context/ThemeContext';
import api from '../../services/api/apiClient';
import AdminSettingsPage from './AdminSettingsPage';

jest.mock('../../services/offline/offlineVaultService', () => ({
  changeOfflineVaultCredential: jest.fn().mockResolvedValue({}),
  createOfflineVault: jest.fn().mockResolvedValue({}),
  getOfflineVaultMetadata: jest.fn().mockResolvedValue(null),
  isOfflineVaultUnlocked: jest.fn().mockReturnValue(true),
  unlockOfflineVault: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../services/offline/offlineSessionService', () => ({
  createOfflineSession: jest.fn(),
}));

jest.mock('../../services/api/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
  },
}));

const user = {
  user_id: 7,
  username: 'test-user',
  role: 'bhw',
  full_name: 'Test User',
  contact_number: '09171234567',
  email: 'test@example.com',
  device_id: 'device-1',
  offline_pin_enrolled: false,
};

const render = (ui, options) => testingLibraryRender(
  <ThemeProvider>{ui}</ThemeProvider>,
  options
);

function SettingsUrlProbe() {
  const [params] = useSearchParams();
  return <output data-testid="settings-url">{params.toString()}</output>;
}

beforeEach(() => {
  jest.clearAllMocks();
  api.post.mockResolvedValue({ data: { success: true } });
  api.put.mockResolvedValue({ data: { success: true, data: {} } });
  api.get.mockImplementation((path) => {
    if (path === '/admin-settings/account') {
      return Promise.resolve({
        data: {
          success: true,
          data: {
            profile: { full_name: user.full_name, username: user.username, contact_number: user.contact_number, email: user.email },
            preferences: {},
            loginHistory: [],
          },
        },
      });
    }
    if (path === '/auth/devices') {
      return Promise.resolve({ data: { success: true, data: [] } });
    }
    return Promise.resolve({ data: { success: true, data: {} } });
  });
});

test('loads and saves contact number and email from Profile settings', async () => {
  const updateUser = jest.fn();
  api.put.mockResolvedValue({
    data: {
      success: true,
      data: {
        user_id: user.user_id,
        full_name: user.full_name,
        username: user.username,
        contact_number: '+63 917-555-0101',
        email: 'updated@example.com',
      },
    },
  });
  render(
    <MemoryRouter
      initialEntries={['/admin-settings?tab=profile']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthContext.Provider value={{
        user,
        updateUser,
        logout: jest.fn(),
        unlockOfflineAccess: jest.fn(),
      }}>
        <AdminSettingsPage />
      </AuthContext.Provider>
    </MemoryRouter>
  );

  const contactInput = await screen.findByLabelText('Contact number');
  const emailInput = screen.getByLabelText('Email address');
  expect(contactInput).toHaveValue(user.contact_number);
  expect(emailInput).toHaveValue(user.email);

  fireEvent.change(contactInput, { target: { value: '+63 917-555-0101' } });
  fireEvent.change(emailInput, { target: { value: 'updated@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  await waitFor(() => {
    expect(api.put).toHaveBeenCalledWith('/admin-settings', {
      full_name: user.full_name,
      username: user.username,
      contact_number: '+63 917-555-0101',
      email: 'updated@example.com',
    });
  });
  expect(updateUser).toHaveBeenCalledWith(expect.objectContaining({
    contact_number: '+63 917-555-0101',
    email: 'updated@example.com',
  }));
});

test('renders URL-backed keyboard-accessible tabs without the old mini sidebar', async () => {
  render(
    <MemoryRouter
      initialEntries={['/admin-settings?tab=profile']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthContext.Provider value={{ user, updateUser: jest.fn(), logout: jest.fn(), unlockOfflineAccess: jest.fn() }}>
        <AdminSettingsPage />
        <SettingsUrlProbe />
      </AuthContext.Provider>
    </MemoryRouter>
  );

  const tabs = await screen.findByRole('tablist', { name: 'Settings sections' });
  const profileTab = within(tabs).getByRole('tab', { name: 'Profile' });
  expect(profileTab).toHaveAttribute('aria-selected', 'true');
  expect(document.querySelector('.settings-sidebar')).not.toBeInTheDocument();

  fireEvent.keyDown(profileTab, { key: 'ArrowRight' });
  expect(within(tabs).getByRole('tab', { name: 'Appearance' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByTestId('settings-url')).toHaveTextContent('tab=appearance');
});

test('confirms before discarding profile edits when switching tabs', async () => {
  render(
    <MemoryRouter
      initialEntries={['/admin-settings?tab=profile']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthContext.Provider value={{ user, updateUser: jest.fn(), logout: jest.fn(), unlockOfflineAccess: jest.fn() }}>
        <AdminSettingsPage />
        <SettingsUrlProbe />
      </AuthContext.Provider>
    </MemoryRouter>
  );

  const fullName = await screen.findByLabelText(/Full name/);
  fireEvent.change(fullName, { target: { value: 'Changed User' } });
  fireEvent.click(screen.getByRole('tab', { name: 'Appearance' }));
  expect(await screen.findByRole('dialog', { name: 'Discard changes?' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(screen.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true');

  fireEvent.click(screen.getByRole('tab', { name: 'Appearance' }));
  const discardDialog = await screen.findByRole('dialog', { name: 'Discard changes?' });
  fireEvent.click(within(discardDialog).getByRole('button', { name: 'Discard' }));
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Appearance' })).toHaveAttribute('aria-selected', 'true'));
  expect(screen.getByTestId('settings-url')).toHaveTextContent('tab=appearance');

  fireEvent.click(screen.getByRole('tab', { name: 'Profile' }));
  expect(await screen.findByLabelText(/Full name/)).toHaveValue(user.full_name);
});

test('asks for the account password only after PIN confirmation and account PIN setup', async () => {
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

  const pinGroup = await screen.findByRole('group', { name: 'New account PIN' });
  const confirmationGroup = screen.getByRole('group', { name: 'Confirm new account PIN' });
  const pinInput = within(pinGroup).getByLabelText('PIN digit 1 of 6');
  const confirmationInput = within(confirmationGroup).getByLabelText('PIN digit 1 of 6');
  expect(screen.queryByLabelText('Current account password')).not.toBeInTheDocument();

  fireEvent.paste(pinInput, { clipboardData: { getData: () => '012345' } });
  fireEvent.paste(confirmationInput, { clipboardData: { getData: () => '012345' } });
  fireEvent.click(screen.getByRole('button', { name: 'Set up account PIN' }));

  const passwordInput = await screen.findByLabelText('Current account password');
  expect(passwordInput).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Save PIN' })).toBeInTheDocument();
  await waitFor(() => expect(api.post).not.toHaveBeenCalled());
});

test('offers the existing account PIN for a new approved device instead of asking for a different PIN', async () => {
  render(
    <MemoryRouter
      initialEntries={['/admin-settings?tab=security']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthContext.Provider value={{
        user: { ...user, offline_pin_enrolled: false, offline_account_pin_enrolled: true },
        updateUser: jest.fn(),
        logout: jest.fn(),
        unlockOfflineAccess: jest.fn(),
      }}>
        <AdminSettingsPage />
      </AuthContext.Provider>
    </MemoryRouter>
  );

  expect(await screen.findByRole('heading', { name: 'Use account PIN on this device' })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Shared account PIN' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Use account PIN' })).toBeInTheDocument();
  expect(screen.getByText(/Do not create a different PIN/)).toBeInTheDocument();
});

test('verifies a legacy device PIN before promoting it as the shared account PIN', async () => {
  render(
    <MemoryRouter
      initialEntries={['/admin-settings?tab=security']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthContext.Provider value={{
        user: { ...user, offline_pin_enrolled: true },
        updateUser: jest.fn(),
        logout: jest.fn(),
        unlockOfflineAccess: jest.fn().mockResolvedValue(undefined),
      }}>
        <AdminSettingsPage />
      </AuthContext.Provider>
    </MemoryRouter>
  );

  const pinGroup = await screen.findByRole('group', { name: 'Current device PIN' });
  const confirmationGroup = screen.getByRole('group', { name: 'Confirm current PIN' });
  fireEvent.paste(within(pinGroup).getByLabelText('PIN digit 1 of 6'), {
    clipboardData: { getData: () => '012345' },
  });
  fireEvent.paste(within(confirmationGroup).getByLabelText('PIN digit 1 of 6'), {
    clipboardData: { getData: () => '012345' },
  });
  fireEvent.change(await screen.findByLabelText('Current account password'), {
    target: { value: 'healthsync-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Share this PIN' }));

  await waitFor(() => {
    expect(api.post).toHaveBeenNthCalledWith(1, '/auth/offline-pin/verify', {
      current_password: 'healthsync-password',
      pin: '012345',
      scope: 'promote',
    });
    expect(api.post).toHaveBeenNthCalledWith(2, '/auth/offline-pin', {
      current_password: 'healthsync-password',
      pin: '012345',
      scope: 'account',
    });
  });
});

test('keeps one in-field password visibility control and toggles the password value', async () => {
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

  const passwordInput = await screen.findByLabelText('Current password');
  const passwordField = passwordInput.closest('.settings-password-input');
  expect(passwordInput).toHaveAttribute('type', 'password');
  expect(within(passwordField).getAllByRole('button')).toHaveLength(1);

  fireEvent.change(passwordInput, { target: { value: 'healthsync-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Show current password' }));
  expect(passwordInput).toHaveAttribute('type', 'text');
  expect(screen.getByRole('button', { name: 'Hide current password' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Hide current password' }));
  expect(passwordInput).toHaveAttribute('type', 'password');
});
