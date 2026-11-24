import React, { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import './AuthScreen.css';

const getSavedTheme = () => {
  try {
    const preferences = JSON.parse(localStorage.getItem('hs_preferences') || '{}');
    return preferences.theme || 'system';
  } catch {
    return 'system';
  }
};

const persistTheme = (theme) => {
  let preferences = {};
  try {
    preferences = JSON.parse(localStorage.getItem('hs_preferences') || '{}');
  } catch {
    preferences = {};
  }
  const next = { ...preferences, theme };
  localStorage.setItem('hs_preferences', JSON.stringify(next));
  document.documentElement.dataset.themePreference = theme;
  const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = theme === 'system'
    ? (systemDark ? 'dark' : 'light')
    : theme;
  window.dispatchEvent(new CustomEvent('healthsync:preferences-updated', { detail: next }));
};

export function ThemeToggleButton() {
  const [theme, setTheme] = useState(getSavedTheme);
  const [currentTheme, setCurrentTheme] = useState(() => document.documentElement.dataset.theme || 'light');

  useEffect(() => {
    const sync = () => setCurrentTheme(document.documentElement.dataset.theme || 'light');
    window.addEventListener('healthsync:preferences-updated', sync);
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      window.removeEventListener('healthsync:preferences-updated', sync);
      observer.disconnect();
    };
  }, []);

  const toggle = () => {
    const next = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    persistTheme(next);
  };

  return (
    <button type="button" className="auth-theme-toggle" aria-label={`Switch theme${theme === 'system' ? '' : `, current ${currentTheme}`}`} onClick={toggle}>
      {currentTheme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
  );
}

export default function AuthScreen({ children, size = 'password', className = '' }) {
  return (
    <main className={`auth-screen auth-screen-${size} ${className}`}>
      <ThemeToggleButton />
      {children}
    </main>
  );
}
