import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ResidentsPage from './ResidentsPage';
import { getResidents } from '../../services/api/residentService';

jest.mock('../../services/api/residentService', () => ({
  getResidents: jest.fn(),
  deleteResident: jest.fn()
}));

jest.mock('./ResidentForm', () => () => <div>Resident form</div>);

const response = {
  success: true,
  data: {
    items: [{
      resident_id: 7,
      first_name: 'Ana',
      middle_name: 'Maria',
      last_name: 'Santos',
      birthdate: '1981-01-05',
      age: 45,
      sex: 'female',
      household_no: 'HH-7',
      contact_no: '09123456789',
      philhealth_id_no: 'PH-7',
      resident_status: 'Active',
      category_flags: ['PWD'],
      is_4ps: 1
    }],
    total: 26,
    page: 1,
    limit: 10,
    pagination: { page: 1, limit: 10, total: 26, totalPages: 3 }
  }
};

beforeEach(() => {
  window.history.replaceState({}, '', '/residents');
  getResidents.mockResolvedValue(response);
});

test('directory searches, filters, sorts, and page size persist in the URL', async () => {
  render(<BrowserRouter><ResidentsPage /></BrowserRouter>);
  expect(await screen.findByRole('heading', { name: 'Residents' })).toBeInTheDocument();
  expect((await screen.findAllByText('Household HH-7')).length).toBeGreaterThan(0);
  expect(screen.getByText('Showing 1-10 of 26 matching residents')).toBeInTheDocument();

  fireEvent.keyDown(window, { key: '/' });
  expect(screen.getByLabelText('Search by name, household no., contact no., or PhilHealth ID')).toHaveFocus();
  fireEvent.change(screen.getByLabelText('Search by name, household no., contact no., or PhilHealth ID'), { target: { value: 'PH-7' } });
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('search')).toBe('PH-7'));

  fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Active' } });
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('status')).toBe('Active'));

  fireEvent.change(screen.getByLabelText('Sort residents'), { target: { value: 'age-desc' } });
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('sort')).toBe('age-desc'));

  fireEvent.change(screen.getByLabelText('Rows per page for residents'), { target: { value: '25' } });
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('pageSize')).toBe('25'));
});
