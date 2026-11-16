import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import OfflineBanner from './OfflineBanner';

jest.mock('../../services/offline/syncManager', () => ({
  __esModule: true,
  default: { runSync: jest.fn() },
}));

jest.mock('../../services/offline/offlineDataDownloadService', () => ({
  downloadOfflineData: jest.fn(),
  getActiveResidentSnapshot: jest.fn(),
  getOfflineSnapshotReadiness: jest.fn(() => 'unavailable'),
}));

test('shows how to prepare offline access when the vault is locked', () => {
  render(
    <MemoryRouter>
      <AuthContext.Provider value={{
        user: { user_id: 7, role: 'bhw' },
        offlineVaultError: null,
        offlineVaultReady: false,
      }}>
        <OfflineBanner />
      </AuthContext.Provider>
    </MemoryRouter>
  );

  expect(screen.getByText(/sign in online to prepare secure offline access/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Sign in online' })).toHaveAttribute('href', '/login');
  expect(screen.getByRole('button', { name: 'Download Offline Data' })).toBeDisabled();
});
