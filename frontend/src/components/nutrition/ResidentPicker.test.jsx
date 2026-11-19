import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ResidentPicker from './ResidentPicker';
import { getResidents } from '../../services/api/residentService';

jest.mock('../../services/api/residentService', () => ({
  getResidents: jest.fn(() => new Promise(() => {})),
}));

test.each([
  [0, 59, 'Child', 'Searching children...'],
  [61, 228, 'Resident', 'Searching residents...'],
  [240, 1200, 'Resident', 'Searching residents...'],
])('uses appropriate search wording for age range %s-%s months', (minAgeMonths, maxAgeMonths, label, status) => {
  render(
    <ResidentPicker
      inputId="resident-search"
      minAgeMonths={minAgeMonths}
      maxAgeMonths={maxAgeMonths}
      onSelect={jest.fn()}
    />
  );

  const input = screen.getByRole('combobox', { name: label });
  fireEvent.change(input, { target: { value: 'Ma' } });

  expect(screen.getByText(status)).toBeInTheDocument();
  expect(getResidents).not.toHaveBeenCalled();
});
