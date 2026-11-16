import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SeniorCitizenPage from './SeniorCitizenPage';
import { listSeniorCitizens, createSeniorCitizen } from '../../services/api/seniorCitizenService';

jest.mock('../../services/api/seniorCitizenService', () => ({
  listSeniorCitizens: jest.fn(),
  createSeniorCitizen: jest.fn()
}));

jest.mock('../../components/residents/ResidentAutocomplete', () => function MockResidentAutocomplete({ onSelect }) {
  return <button type="button" onClick={() => onSelect({
    resident_id: 12,
    first_name: 'Rosa',
    last_name: 'Santos',
    birthdate: '1950-01-01'
  })}>Choose resident</button>;
});

jest.mock('../../components/residents/ResidentIdentityLink', () => function MockResidentIdentityLink() {
  return null;
});

test('blocks registration when the selected resident is already in the senior registry', async () => {
  listSeniorCitizens.mockImplementation(({ resident_id } = {}) => Promise.resolve({
    success: true,
    data: { items: resident_id ? [{ resident_id: 12 }] : [] }
  }));

  render(<SeniorCitizenPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose resident' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/already in the senior citizen registry/i);
  expect(screen.getByRole('button', { name: 'Register Senior Citizen' })).toBeDisabled();

  fireEvent.submit(screen.getByRole('button', { name: 'Register Senior Citizen' }).closest('form'));
  await waitFor(() => expect(createSeniorCitizen).not.toHaveBeenCalled());
});
