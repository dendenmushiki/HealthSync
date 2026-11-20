import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdolescentBMIForm from './AdolescentBMIForm';
import { createAdolescentBMI, previewAdolescentBMI } from '../../services/api/adolescentBMIService';

jest.mock('../../components/residents/ResidentAutocomplete', () => function MockResidentAutocomplete({ onSelect }) {
  return <button type="button" onClick={() => onSelect({
    resident_id: 8,
    first_name: 'Test',
    last_name: 'Resident',
    birthdate: '2010-01-15',
    sex: 'female'
  })}>Select test resident</button>;
});

jest.mock('../../services/api/adolescentBMIService', () => ({
  createAdolescentBMI: jest.fn(),
  previewAdolescentBMI: jest.fn()
}));

const previewResult = {
  age_years: 10,
  age_months: 120,
  height_cm: 150,
  weight_kg: 40,
  bmi: 17.78,
  bmi_for_age_zscore: 0.12,
  bmi_for_age_category: 'Normal'
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('shows WHO classification and Z-score as measurements are entered', async () => {
  previewAdolescentBMI.mockResolvedValue({ success: true, data: previewResult });
  render(<AdolescentBMIForm />);

  fireEvent.click(screen.getByRole('button', { name: 'Select test resident' }));
  fireEvent.change(screen.getByLabelText('Height (cm)'), { target: { value: '150' } });
  fireEvent.change(screen.getByLabelText('Weight (kg)'), { target: { value: '40' } });

  await waitFor(() => expect(screen.getByText(/Nutritional status: Normal/)).toBeInTheDocument());
  expect(screen.getAllByText('0.12', { exact: false }).length).toBeGreaterThan(0);
  expect(previewAdolescentBMI).toHaveBeenCalledWith(expect.objectContaining({
    resident_id: 8,
    height_cm: 150,
    weight_kg: 40
  }));
});

test('shows preview errors and does not permit an unclassified save', async () => {
  previewAdolescentBMI.mockRejectedValue({
    response: { data: { message: 'Resident sex is required.' } }
  });
  render(<AdolescentBMIForm />);

  fireEvent.click(screen.getByRole('button', { name: 'Select test resident' }));
  fireEvent.change(screen.getByLabelText('Height (cm)'), { target: { value: '150' } });
  fireEvent.change(screen.getByLabelText('Weight (kg)'), { target: { value: '40' } });

  expect(await screen.findByRole('status')).toHaveTextContent('Resident sex is required.');
  expect(screen.getByRole('button', { name: 'Save record' })).toBeDisabled();
  expect(createAdolescentBMI).not.toHaveBeenCalled();
});

test('clears the previous classification and disables save while recalculating changed measurements', async () => {
  let finishSecondPreview;
  previewAdolescentBMI
    .mockResolvedValueOnce({ success: true, data: previewResult })
    .mockImplementationOnce(() => new Promise((resolve) => { finishSecondPreview = resolve; }));
  render(<AdolescentBMIForm />);

  fireEvent.click(screen.getByRole('button', { name: 'Select test resident' }));
  fireEvent.change(screen.getByLabelText('Height (cm)'), { target: { value: '150' } });
  fireEvent.change(screen.getByLabelText('Weight (kg)'), { target: { value: '40' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save record' })).toBeEnabled());

  fireEvent.change(screen.getByLabelText('Weight (kg)'), { target: { value: '45' } });
  expect(screen.getByRole('button', { name: 'Save record' })).toBeDisabled();
  await waitFor(() => expect(previewAdolescentBMI).toHaveBeenCalledTimes(2));
  finishSecondPreview({ success: true, data: { ...previewResult, weight_kg: 45, bmi: 20 } });
  await waitFor(() => expect(screen.getByText('Age months')).toBeInTheDocument());
});
