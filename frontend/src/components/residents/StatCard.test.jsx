import React from 'react';
import { render, screen } from '@testing-library/react';
import { Users } from 'lucide-react';
import StatCard from './StatCard';

test('renders an animated KPI target value and suffix', () => {
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: true,
    media: '(prefers-reduced-motion: reduce)',
  }));

  render(<StatCard icon={Users} label="Total Residents" value={26} suffix="" />);

  expect(screen.getByLabelText('Total Residents: 26')).toBeInTheDocument();
  expect(screen.getByText('26')).toBeInTheDocument();
});
