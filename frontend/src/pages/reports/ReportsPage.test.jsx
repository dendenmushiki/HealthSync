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

  test('shows only HealthSync-supported indicators and preserves reporting period controls', async () => {
    renderReportsPage();
    const childTable = await screen.findByRole('table', { name: 'Child care & immunization indicators' });
    expect(within(childTable).queryByRole('row', { name: /child protected at birth/i })).not.toBeInTheDocument();
    expect(within(childTable).getByRole('row', { name: /BCG/i })).toBeInTheDocument();
    expect(screen.queryByText('Not tracked')).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'HealthSync Community Health Report' })).not.toHaveLength(0);
    expect(screen.getAllByText(/not a complete FHSIS submission/i)).not.toHaveLength(0);
    expect(screen.queryByRole('switch', { name: /hide not-tracked/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Noted by / Approved by')).not.toBeInTheDocument();
    expect(screen.queryByText('Signature over printed name')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Reporting period' }), { target: { value: 'quarter' } });
    expect(await screen.findByRole('combobox', { name: 'Quarter' })).toBeInTheDocument();
    expect(screen.getByTestId('search-params')).toHaveTextContent('period=quarter');
  });

  test('hides the jurisdiction placeholder when report metadata has no configured area', async () => {
    api.get.mockImplementation((path) => {
      if (path === '/reports/fhsis/remarks') return Promise.resolve({ data: { success: true, data: [] } });
      if (path === '/reports/fhsis') {
        return Promise.resolve({
          data: { success: true, data: { ...reportData, metadata: { generatedAt: '2026-11-23T09:00:00.000Z' } } },
        });
      }
      return Promise.reject(new Error(`Unexpected report endpoint: ${path}`));
    });

    renderReportsPage();
    await screen.findByRole('table', { name: 'Child care & immunization indicators' });

    expect(screen.queryByText(/Jurisdiction not configured/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Set jurisdiction' })).not.toBeInTheDocument();
  });

  test('removes the section navigator and keeps compact expand and collapse controls', async () => {
    renderReportsPage();
    await screen.findAllByRole('heading', { name: 'HealthSync Community Health Report' });

    expect(screen.queryByRole('navigation', { name: 'Report sections' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Expand all/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Collapse all/ })).toBeInTheDocument();
  });

  test('labels clinical records as an all-module total and opens its drilldown', async () => {
    api.get.mockImplementation((path) => {
      if (path === '/reports/fhsis/remarks') return Promise.resolve({ data: { success: true, data: [] } });
      if (path === '/reports/fhsis') return Promise.resolve({ data: { success: true, data: reportData } });
      if (path === '/reports/fhsis/drilldown') {
        return Promise.resolve({
          data: { success: true, data: { items: [], total: 1, page: 1, pageSize: 10 } },
        });
      }
      return Promise.reject(new Error(`Unexpected report endpoint: ${path}`));
    });

    renderReportsPage();
    const clinicalRecordsCard = await screen.findByRole('button', { name: /Clinical records/ });
    expect(clinicalRecordsCard).toHaveTextContent('Clinical, child, maternal & immunization records · period-based');
    fireEvent.click(clinicalRecordsCard);

    await waitFor(() => expect(api.get).toHaveBeenCalledWith(
      '/reports/fhsis/drilldown',
      expect.objectContaining({
        params: expect.objectContaining({ indicator: 'clinical-records' }),
      }),
    ));
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
    let downloadName = '';
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function captureDownloadName() {
      downloadName = this.download;
    });
    URL.createObjectURL = jest.fn(() => 'blob:report');
    URL.revokeObjectURL = jest.fn();
    renderReportsPage();

    const exportButton = await screen.findByRole('button', { name: 'Export CSV' });
    fireEvent.click(exportButton);
    expect(await screen.findByText('CSV export completed.')).toBeInTheDocument();
    expect(clickSpy).toHaveBeenCalled();
    expect(downloadName).toMatch(/^HealthSync_Community_Health_Report_/);
    expect(URL.createObjectURL).toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});
