import React, { createContext, useCallback, useContext, useLayoutEffect, useState } from 'react';

const PREFERENCES_KEY = 'hs_preferences';
const THEME_VALUES = new Set(['light', 'dark', 'system']);
const FONT_SCALES = { small: '0.875', default: '1', large: '1.125', 'extra-large': '1.25' };
const ThemeContext = createContext(null);

function readPreferences() {
  try {
    const preferences = JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) || '{}');
    return preferences && typeof preferences === 'object' && !Array.isArray(preferences)
      ? preferences
      : {};
  } catch {
    return {};
  }
}

function resolveTheme(preference) {
  if (preference === 'light' || preference === 'dark') return preference;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyThemePreferences(preferences = {}) {
  const storedPreferences = preferences && typeof preferences === 'object' ? preferences : {};
  const preference = THEME_VALUES.has(storedPreferences.theme) ? storedPreferences.theme : 'system';
  const resolvedTheme = resolveTheme(preference);
  const textSize = storedPreferences.textSize || 'default';
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme;
  root.dataset.themePreference = preference;
  root.dataset.textSize = textSize;
  root.style.setProperty('color-scheme', resolvedTheme);
  root.style.setProperty('--hs-font-scale', FONT_SCALES[textSize] || FONT_SCALES.default);

  const themeColor = document.querySelector('meta[name="theme-color"]');
  const pageColor = window.getComputedStyle(root).getPropertyValue('--page-bg').trim();
  if (pageColor) themeColor?.setAttribute('content', pageColor);

  return { themePreference: preference, resolvedTheme };
}

export function persistPreferences(preferences) {
  try {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch (error) {
    console.warn('Unable to persist local preferences; the current theme will remain active for this session.', error);
  }
}

export function ThemeProvider({ children }) {
  const [themeState, setThemeState] = useState(() => ({
    themePreference: THEME_VALUES.has(document.documentElement.dataset.themePreference)
      ? document.documentElement.dataset.themePreference
      : 'system',
    resolvedTheme: document.documentElement.dataset.theme || 'light',
  }));

  const applyPreferences = useCallback((preferences) => {
    setThemeState(applyThemePreferences(preferences));
  }, []);

  useLayoutEffect(() => {
    const syncPreferences = (preferences = readPreferences()) => applyPreferences(preferences);
    const handlePreferenceUpdate = (event) => syncPreferences(event.detail || readPreferences());
    const handleStorage = (event) => {
      if (event.key === PREFERENCES_KEY) syncPreferences();
    };
    const mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
    const handleSystemTheme = () => {
      const preference = readPreferences().theme;
      if (!THEME_VALUES.has(preference) || preference === 'system') syncPreferences();
    };

    syncPreferences();
    window.addEventListener('healthsync:preferences-updated', handlePreferenceUpdate);
    window.addEventListener('storage', handleStorage);
    if (mediaQuery?.addEventListener) mediaQuery.addEventListener('change', handleSystemTheme);
    else mediaQuery?.addListener?.(handleSystemTheme);

    return () => {
      window.removeEventListener('healthsync:preferences-updated', handlePreferenceUpdate);
      window.removeEventListener('storage', handleStorage);
      if (mediaQuery?.removeEventListener) mediaQuery.removeEventListener('change', handleSystemTheme);
      else mediaQuery?.removeListener?.(handleSystemTheme);
    };
  }, [applyPreferences]);

  const setThemePreference = useCallback((theme) => {
    if (!THEME_VALUES.has(theme)) return;
    const nextPreferences = { ...readPreferences(), theme };
    persistPreferences(nextPreferences);
    applyPreferences(nextPreferences);
    window.dispatchEvent(new CustomEvent('healthsync:preferences-updated', { detail: nextPreferences }));
  }, [applyPreferences]);

  return (
    <ThemeContext.Provider value={{ ...themeState, applyPreferences, setThemePreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider.');
  return context;
}
