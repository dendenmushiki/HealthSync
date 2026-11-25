import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ThemeToggle from '../components/common/ThemeToggle';
import { ThemeProvider } from './ThemeContext';
import { AuthContext } from './AuthContext';
import api from '../services/api/apiClient';
import '../theme.css';

jest.mock('../services/api/apiClient', () => ({ put: jest.fn() }));

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  jest.restoreAllMocks();
  window.localStorage.clear();
  document.documentElement.dataset.theme = 'light';
  document.documentElement.dataset.themePreference = 'system';
  document.documentElement.style.removeProperty('color-scheme');
  document.querySelector('meta[name="theme-color"]')?.remove();
  if (originalMatchMedia) window.matchMedia = originalMatchMedia;
  else delete window.matchMedia;
});

test('theme selection is persisted and updates the document theme and browser theme color', () => {
  const getComputedStyle = jest.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => 'page-token',
  }));
  window.localStorage.setItem('hs_preferences', JSON.stringify({ textSize: 'large' }));
  const themeColor = document.createElement('meta');
  themeColor.name = 'theme-color';
  document.head.appendChild(themeColor);

  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>
  );

  fireEvent.change(screen.getByRole('combobox', { name: 'Color theme' }), { target: { value: 'dark' } });

  expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('dark');
  expect(themeColor).toHaveAttribute('content', 'page-token');
  expect(JSON.parse(window.localStorage.getItem('hs_preferences'))).toEqual({ textSize: 'large', theme: 'dark' });
  getComputedStyle.mockRestore();
});

test('system preference follows live operating-system theme changes', () => {
  let systemIsDark = false;
  let handleSystemChange;
  window.matchMedia = jest.fn(() => ({
    matches: systemIsDark,
    addEventListener: (event, listener) => {
      if (event === 'change') handleSystemChange = listener;
    },
    removeEventListener: jest.fn(),
  }));
  window.localStorage.setItem('hs_preferences', JSON.stringify({ theme: 'system' }));

  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>
  );
  expect(document.documentElement).toHaveAttribute('data-theme', 'light');

  systemIsDark = true;
  act(() => handleSystemChange());
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
});

test('authenticated header theme changes persist to the account preferences endpoint', async () => {
  api.put.mockResolvedValue({
    data: {
      success: true,
      data: {
        theme: 'dark',
        textSize: 'default',
        notifications: {
          nutritionAlerts: true,
          seniorFollowUpAlerts: true,
          offlineSyncAlerts: true,
          newResidentAlerts: true,
        },
      },
    },
  });
  window.localStorage.setItem('hs_preferences', JSON.stringify({ textSize: 'default' }));

  render(
    <AuthContext.Provider value={{ user: { user_id: 7 } }}>
      <ThemeProvider>
        <ThemeToggle persistAccount />
      </ThemeProvider>
    </AuthContext.Provider>
  );

  fireEvent.change(screen.getByRole('combobox', { name: 'Color theme' }), { target: { value: 'dark' } });

  await act(async () => {
    await Promise.resolve();
  });
  expect(api.put).toHaveBeenCalledWith('/admin-settings/preferences', {
    preferences: expect.objectContaining({ theme: 'dark', textSize: 'default' }),
  });
  expect(JSON.parse(window.localStorage.getItem('hs_preferences')).theme).toBe('dark');
});
