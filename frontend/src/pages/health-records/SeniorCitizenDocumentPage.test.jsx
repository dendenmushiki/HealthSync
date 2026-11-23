import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { getSeniorCitizen } from '../../services/api/seniorCitizenService';
import SeniorCitizenDocumentPage from './SeniorCitizenDocumentPage';

jest.mock('../../services/api/seniorCitizenService', () => ({ getSeniorCitizen: jest.fn() }));

test('renders a saved senior citizen registration as a read-only document', async () => {
  getSeniorCitizen.mockResolvedValue({
    success: true,
    data: {
      senior_id: 23, resident_id: 8, senior_citizen_id: 'SC-000023',
      date_registered: '2026-02-14', first_name: 'Rosa', middle_name: 'M.',
      last_name: 'Santos', birthdate: '1959-04-20', sex: 'female', civil_status: 'Widowed',
      address: 'Barangay Estancia', sitio: 'Purok 4', household_no: 'HH-45',
      contact_number: '09123456789', emergency_contact_name: 'Liza Santos',
      emergency_contact_number: '09987654321', health_conditions: 'Hypertension',
      recorded_by_name: 'BHW User', created_at: '2026-02-14T09:00:00Z'
    }
  });
  render(<MemoryRouter initialEntries={['/senior-citizens/records/23']}>
    <Routes><Route path="/senior-citizens/records/:id" element={<SeniorCitizenDocumentPage />} /></Routes>
  </MemoryRouter>);

  expect(await screen.findByText('Senior Citizen Health Record')).toBeInTheDocument();
  expect(screen.getByText('SC-000023')).toBeInTheDocument();
  expect(screen.getByText('Liza Santos')).toBeInTheDocument();
  expect(screen.getByText('Hypertension')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Edit Record' })).toHaveAttribute('href', '/senior-citizens/23/edit');
  expect(getSeniorCitizen).toHaveBeenCalledWith('23');
});
