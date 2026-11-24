import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, within } from '@testing-library/react';
import ResidentsTable from './ResidentsTable';

test('keeps resident fields labeled and actions available in the responsive row', () => {
  render(
    <MemoryRouter>
      <ResidentsTable
        items={[{
          resident_id: 42,
          first_name: 'Ari',
          last_name: 'Santos',
          birthdate: '1990-01-01',
          sex: 'female',
          sitio: 'North',
          nutrition_status: 'Normal',
          created_at: '2025-01-01',
        }]}
      />
    </MemoryRouter>
  );

  const row = screen.getByRole('row', { name: 'Preview details for Santos, Ari' });
  const rowContent = within(row);

  ['ID', 'Full name', 'Age', 'Gender', 'Sitio', 'Nutritional status', 'Last updated', 'Actions']
    .forEach((label) => expect(rowContent.getByText(label)).toBeInTheDocument());
  expect(rowContent.getByRole('button', { name: 'View Santos, Ari' })).toBeInTheDocument();
  expect(rowContent.getByRole('link', { name: 'Edit Santos, Ari' })).toBeInTheDocument();
});
