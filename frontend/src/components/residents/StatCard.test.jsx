import React from 'react';
import { act, render, screen } from '@testing-library/react';
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

test('counts up from zero on mount when enabled', () => {
  const originalMatchMedia = window.matchMedia;
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;
  const animationFrames = [];
  window.matchMedia = jest.fn().mockReturnValue({ matches: false });
  window.requestAnimationFrame = jest.fn((callback) => {
    animationFrames.push(callback);
    return animationFrames.length;
  });
  window.cancelAnimationFrame = jest.fn();

  try {
    render(<StatCard icon={Users} label="Total Records" value={26} animateOnMount />);
    expect(screen.getByText('0')).toBeInTheDocument();

    act(() => animationFrames[0](performance.now() + 700));
    expect(screen.getByText('26')).toBeInTheDocument();
  } finally {
    window.matchMedia = originalMatchMedia;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  }
});
