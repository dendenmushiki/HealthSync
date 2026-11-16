import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import OperationTimbangForm, { getAgeInMonths } from './OperationTimbangForm';
import { calculateOperationTimbang, createOperationTimbang } from '../../services/api/operationTimbangService';

jest.mock('../../components/residents/ResidentAutocomplete', () => {
  const ReactModule = require('react');
  return {
    __esModule: true,
    default: ({ onSelect }) => ReactModule.createElement(
      ReactModule.Fragment,
      null,
      ReactModule.createElement(
        'button',
        {
          type: 'button',
          onClick: () => onSelect({
            resident_id: 42,
            first_name: 'Mia',
            last_name: 'Reyes',
            birthdate: '2023-01-01',
            sex: 'female',
          }),
        },
        'Select test child'
      ),
      ReactModule.createElement(
        'button',
        {
          type: 'button',
          onClick: () => onSelect({
            resident_id: 43,
            first_name: 'Invalid',
            last_name: 'Date',
            birthdate: '2024-02-30',
            sex: 'female',
          }),
        },
        'Select invalid-date child'
      )
    ),
  };
});

jest.mock('../../services/api/operationTimbangService', () => ({
  calculateOperationTimbang: jest.fn(),
  createOperationTimbang: jest.fn(),
}));

const resultFor = (payload) => ({
  ...payload,
  age_in_days: 365,
  age_in_months: 12,
  wfa_zscore: payload.weight_kg === 9.5 ? -2.4 : -0.23678,
  wfa_status: payload.weight_kg === 9.5 ? 'Moderately underweight' : 'Normal',
  hfa_zscore: -0.4,
  hfa_status: 'Normal',
  wflh_zscore: -0.3,
  wflh_status: 'Normal',
});

beforeEach(() => {
  calculateOperationTimbang.mockImplementation(async (payload) => ({ success: true, data: resultFor(payload) }));
  createOperationTimbang.mockImplementation(async (payload) => ({ success: true, data: resultFor(payload) }));
});

afterEach(() => {
  jest.clearAllMocks();
});

test('validates age dates and handles leap years, month ends, and the second birthday', () => {
  expect(getAgeInMonths('2020-02-29', '2024-02-28', '2026-10-22')).toBe(47);
  expect(getAgeInMonths('2020-02-29', '2024-02-29', '2026-10-22')).toBe(48);
  expect(getAgeInMonths('2020-01-31', '2020-02-29', '2026-10-22')).toBe(0);
  expect(getAgeInMonths('2020-01-31', '2020-03-01', '2026-10-22')).toBe(1);
  expect(getAgeInMonths('2022-01-01', '2024-01-01', '2026-10-22')).toBe(24);
  expect(getAgeInMonths('2024-02-30', '2024-03-01', '2026-10-22')).toBeNull();
  expect(getAgeInMonths('2023-01-01', '2023-02-30', '2026-10-22')).toBeNull();
  expect(getAgeInMonths('2027-01-01', '2026-10-21', '2026-10-22')).toBeNull();
  expect(getAgeInMonths('2024-01-02', '2024-01-01', '2026-10-22')).toBeNull();
  expect(getAgeInMonths('2020-01-01', '2026-10-23', '2026-10-22')).toBeNull();
});

test('previews updated indicators as measurements change and saves the calculated record', async () => {
  const onSaved = jest.fn();
  render(<OperationTimbangForm onSaved={onSaved} />);

  fireEvent.click(screen.getByRole('button', { name: 'Select test child' }));
  fireEvent.change(screen.getByLabelText('Date recorded'), { target: { value: '2024-01-01' } });
  fireEvent.change(screen.getByLabelText('Weight (kg)'), { target: { value: '8.5' } });
  fireEvent.change(screen.getByLabelText('Height / length (cm)'), { target: { value: '73' } });
  fireEvent.change(screen.getByLabelText('Measurement type'), { target: { value: 'length' } });

  await screen.findByText('Nutritional assessment preview');
  expect(screen.getByText(/Age: 12 months/)).toBeInTheDocument();
  expect(calculateOperationTimbang).toHaveBeenLastCalledWith({
    resident_id: 42,
    date_recorded: '2024-01-01',
    weight_kg: 8.5,
    measurement_cm: 73,
    measurement_type: 'length',
  });
  expect(screen.getByRole('button', { name: 'Save record' })).toBeEnabled();
  expect(screen.getByText('Z-score: -0.24 SD')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Weight (kg)'), { target: { value: '9.5' } });
  await waitFor(() => expect(calculateOperationTimbang).toHaveBeenCalledTimes(2));
  expect(await screen.findByText('Moderately underweight')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Save record' }));
  await screen.findByText('Saved assessment results');
  expect(createOperationTimbang).toHaveBeenCalledWith({
    resident_id: 42,
    date_recorded: '2024-01-01',
    weight_kg: 9.5,
    measurement_cm: 73,
    measurement_type: 'length',
  });
  expect(onSaved).toHaveBeenCalledTimes(1);
});

test('shows missing assessment values as unavailable instead of normal', async () => {
  calculateOperationTimbang.mockImplementation(async (payload) => ({
    success: true,
    data: {
      ...payload,
      age_in_months: 12,
      wfa_zscore: null,
      wfa_status: 'Normal',
      hfa_zscore: null,
      hfa_status: null,
      wflh_zscore: null,
      wflh_status: null,
    },
  }));
  render(<OperationTimbangForm />);

  fireEvent.click(screen.getByRole('button', { name: 'Select test child' }));
  fireEvent.change(screen.getByLabelText('Date recorded'), { target: { value: '2024-01-01' } });
  fireEvent.change(screen.getByLabelText('Weight (kg)'), { target: { value: '8.5' } });
  fireEvent.change(screen.getByLabelText('Height / length (cm)'), { target: { value: '73' } });
  fireEvent.change(screen.getByLabelText('Measurement type'), { target: { value: 'length' } });

  await screen.findByText('Nutritional assessment preview');
  expect(screen.getAllByText('Unavailable')).toHaveLength(3);
  expect(screen.getAllByText('Z-score: Unavailable')).toHaveLength(3);
});

test('does not request a preview for an impossible birthdate', async () => {
  render(<OperationTimbangForm />);

  fireEvent.click(screen.getByRole('button', { name: 'Select invalid-date child' }));
  fireEvent.change(screen.getByLabelText('Date recorded'), { target: { value: '2024-03-01' } });
  fireEvent.change(screen.getByLabelText('Weight (kg)'), { target: { value: '8.5' } });
  fireEvent.change(screen.getByLabelText('Height / length (cm)'), { target: { value: '73' } });
  fireEvent.change(screen.getByLabelText('Measurement type'), { target: { value: 'length' } });

  expect(await screen.findByRole('status')).toHaveTextContent('Enter a valid birthdate and measurement date');
  expect(calculateOperationTimbang).not.toHaveBeenCalled();
  expect(screen.queryByText('Nutritional assessment preview')).not.toBeInTheDocument();
});
