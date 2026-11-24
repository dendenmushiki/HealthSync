import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import api from '../../services/api/apiClient';
import { listAuditLogs } from '../../services/api/auditService';
import AdminDashboardPage from './AdminDashboardPage';

jest.mock('../../services/api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('../../services/api/auditService', () => ({
  listAuditLogs: jest.fn(),
}));

const makeSummary = (data = {}) => ({
  totalUsers: 7,
  usersByRole: { admin: 2, bhw: 3, official: 1, community_nurse: 1 },
  auditEventsThisMonth: 14,
  recentUsers: [
    { user_id: 'user-1', username: 'worker.one', role: 'bhw', created_at: '2026-10-10T12:00:00Z' },
  ],
  ...data,
});

function renderDashboard() {
  return render(
    <MemoryRouter>
      <AdminDashboardPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockResolvedValue({ data: { success: true, data: makeSummary() } });
  listAuditLogs.mockResolvedValue({
    success: true,
    data: [{
      audit_id: 'event-1',
      action: 'LOGIN',
      description: 'Signed in to the system',
      actor_username: 'worker.one',
      actor_role: 'bhw',
      created_at: '2026-11-24T00:00:00Z',
    }],
  });
});

test('renders a dynamic role pie, role-filter links, and role labels consistently', async () => {
  renderDashboard();

  expect(await screen.findByRole('heading', { name: 'Administrator Dashboard' })).toBeInTheDocument();
  expect(await screen.findByRole('link', { name: /Community Nurse: 1 users/ })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: /System user distribution.*Community Nurse: 1/ })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Administrator: 2 users/ })).toHaveAttribute('href', '/users?role=admin');
  expect(screen.getByRole('link', { name: /BHW: 3 users/ })).toHaveAttribute('href', '/users?role=bhw');
  expect(screen.getByRole('link', { name: /Official: 1 users/ })).toHaveAttribute('href', '/users?role=official');
  expect(screen.getByRole('link', { name: /Community Nurse: 1 users/ })).toHaveAttribute('href', '/users?role=community_nurse');
  expect(await screen.findByText('Signed in to the system')).toBeInTheDocument();
  expect(screen.getByText('BHW', { selector: '.admin-activity-role' })).toBeInTheDocument();
  expect(listAuditLogs).toHaveBeenCalledWith({ page: 1, pageSize: 5, sort: 'newest', preview: 1 });
});

test('renders a full circle for one non-zero role and a placeholder when there are no users', async () => {
  api.get.mockResolvedValueOnce({
    data: { success: true, data: makeSummary({ totalUsers: 3, usersByRole: { bhw: 3 }, recentUsers: [] }) },
  });
  const { container, unmount } = renderDashboard();
  await screen.findByRole('link', { name: /BHW: 3 users/ });
  expect(container.querySelectorAll('.admin-pie-slice')).toHaveLength(1);
  expect(container.querySelector('.admin-role-pie')).toHaveAttribute('viewBox', '0 0 100 100');
  expect(container.querySelector('.admin-pie-center strong')).toHaveTextContent('3');

  unmount();
  api.get.mockResolvedValueOnce({
    data: { success: true, data: makeSummary({ totalUsers: 0, usersByRole: { admin: 0, bhw: 0 }, recentUsers: [] }) },
  });
  const empty = renderDashboard();
  expect(await screen.findByText('No users yet')).toBeInTheDocument();
  expect(empty.container.querySelectorAll('.admin-pie-slice')).toHaveLength(0);
  expect(screen.getByRole('link', { name: /Administrator: 0 users/ })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /BHW: 0 users/ })).toBeInTheDocument();
});

test('refresh button calls the existing administrator summary endpoint again', async () => {
  renderDashboard();
  await screen.findByRole('heading', { name: 'Administrator Dashboard' });

  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  expect(api.get).toHaveBeenLastCalledWith('/dashboard/admin-summary');
});
