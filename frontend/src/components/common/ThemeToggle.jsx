import React, { useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { DEFAULT_PREFERENCES, persistPreferences, useTheme } from '../../context/ThemeContext';
import api from '../../services/api/apiClient';
import './ThemeToggle.css';

const themeIcons = { light: Sun, dark: Moon, system: Monitor };

export default function ThemeToggle({ className = '', persistAccount = false }) {
  const { themePreference, setThemePreference } = useTheme();
  const [saveError, setSaveError] = useState('');
  const Icon = themeIcons[themePreference] || Monitor;

  const handleChange = async (event) => {
    const theme = event.target.value;
    const nextPreferences = setThemePreference(theme);
    setSaveError('');
    if (!persistAccount || !nextPreferences) return;

    const preferences = {
      ...DEFAULT_PREFERENCES,
      ...nextPreferences,
      theme,
      notifications: {
        ...DEFAULT_PREFERENCES.notifications,
        ...nextPreferences.notifications,
      },
    };
    try {
      const response = await api.put('/admin-settings/preferences', { preferences });
      if (!response.data?.success || !response.data.data) throw new Error('Unable to save theme preference.');
      persistPreferences(response.data.data);
      window.dispatchEvent(new CustomEvent('healthsync:preferences-updated', { detail: response.data.data }));
    } catch {
      setSaveError('Theme changed on this device but could not be saved to your account.');
    }
  };

  return (
    <label className={`theme-toggle ${className}`.trim()} title={saveError || `Color theme: ${themePreference}`}>
      <Icon size={19} aria-hidden="true" />
      <select
        aria-label="Color theme"
        value={themePreference}
        onChange={handleChange}
      >
        <option value="light">Light theme</option>
        <option value="dark">Dark theme</option>
        <option value="system">System theme</option>
      </select>
      {saveError && <span className="theme-toggle-feedback" role="alert">{saveError}</span>}
    </label>
  );
}
