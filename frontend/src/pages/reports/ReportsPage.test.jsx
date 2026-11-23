import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import api from '../../services/api/apiClient';
import { AuthContext } from '../../context/AuthContext';
import ReportsPage from './ReportsPage';

jest.mock('../../services/api/apiClient', () => ({ get: jest.fn(), put: jest.fn() }));
jest.setTimeout(20000);

const reportData = {
  summary: {
    totalResidents: 2,
    newResidents: 1,
    activeResidents: 2,
    clinicalRecords: 1,
    residentSex: { male: 1, female: 1 },
    activeSex: { male: 1, female: 1 },
    seniorCitizens: { total: 1, male: 1, female: 0 },
  },
  metadata: { generatedAt: '2026-11-23T09:00:00.000Z', barangay: 'Barangay Example', municipality: 'Municipality Example' },
  nutrition: { operationTimbang: [], adolescent: [], adult: [] },
  immunization: {},
  maternal: {},
  seniorCitizens: { total: 1 },
};

function SearchParamsProbe() {
  const [params] = useSearchParams();
  return <output data-testid="search-params">{params.toString()}</output>;
}

function renderReportsPage() {
  return render(
    <MemoryRouter initialEntries={['/reports?period=month&month=2026-05']}>
      <AuthContext.Provider value={{ user: { user_id: 7, full_name: 'Report Tester', role: 'bhw' } }}>
        <ReportsPage />
        <SearchParamsProbe />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('ReportsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.IntersectionObserver = class {
      observe() {}
      disconnect() {}
    };
    api.get.mockImplementation((path) => {
      if (path === '/reports/fhsis/remarks') return Promise.resolve({ data: { success: true, data: [] } });
      if (path === '/reports/fhsis') return Promise.resolve({ data: { success: true, data: reportData } });
      return Promise.reject(new Error(`Unexpected report endpoint: ${path}`));
    });
  });

  test('preserves reporting period controls and applies not-tracked filtering to the data rows', async () => {
    renderReportsPage();
    const childTable = await screen.findByRole('table', { name: 'Child care & immunization indicators' });
    const untrackedRow = within(childTable).getByRole('row', { name: /child protected at birth/i });
    expect(untrackedRow.querySelector('td[colspan="3"]')).toHaveTextContent('Not tracked');

    fireEvent.click(screen.getAllByRole('switch')[0]);
    await waitFor(() => expect(within(childTable).queryByRole('row', { name: /child protected at birth/i })).not.toBeInTheDocument());

    fireEvent.change(screen.getByRole('combobox', { name: 'Reporting period' }), { target: { value: 'quarter' } });
    expect(await screen.findByRole('combobox', { name: 'Quarter' })).toBeInTheDocument();
    expect(screen.getByTestId('search-params')).toHaveTextContent('period=quarter');
  });

  test('removes the section navigator and keeps compact expand and collapse controls', async () => {
    renderReportsPage();
    await screen.findByRole('heading', { name: 'FHSIS Report' });

    expect(screen.queryByRole('navigation', { name: 'Report sections' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Expand all/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Collapse all/ })).toBeInTheDocument();
  });

  test('retries failed remarks loading without losing the migration guidance', async () => {
    let remarksRequests = 0;
    api.get.mockImplementation((path) => {
      if (path === '/reports/fhsis/remarks') {
        remarksRequests += 1;
        return remarksRequests === 1
          ? Promise.reject(new Error('Network unavailable'))
          : Promise.resolve({ data: { success: true, data: [] } });
      }
      if (path === '/reports/fhsis') return Promise.resolve({ data: { success: true, data: reportData } });
      return Promise.reject(new Error(`Unexpected report endpoint: ${path}`));
    });

    renderReportsPage();
    expect(await screen.findByText(/report_remarks migration/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(remarksRequests).toBe(2));
    await waitFor(() => expect(screen.queryByText(/report_remarks migration/i)).not.toBeInTheDocument());
  });

  test('exports CSV and reports completion through the existing download action', async () => {
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    URL.createObjectURL = jest.fn(() => 'blob:report');
    URL.revokeObjectURL = jest.fn();
    renderReportsPage();

    const exportButton = await screen.findByRole('button', { name: 'Export CSV' });
    fireEvent.click(exportButton);
    expect(await screen.findByText('CSV export completed.')).toBeInTheDocument();
    expect(clickSpy).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});
