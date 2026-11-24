import React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import './ThemeToggle.css';

const themeIcons = { light: Sun, dark: Moon, system: Monitor };

export default function ThemeToggle({ className = '' }) {
  const { themePreference, setThemePreference } = useTheme();
  const Icon = themeIcons[themePreference] || Monitor;

  return (
    <label className={`theme-toggle ${className}`.trim()} title={`Color theme: ${themePreference}`}>
      <Icon size={19} aria-hidden="true" />
      <select
        aria-label="Color theme"
        value={themePreference}
        onChange={(event) => setThemePreference(event.target.value)}
      >
        <option value="light">Light theme</option>
        <option value="dark">Dark theme</option>
        <option value="system">System theme</option>
      </select>
    </label>
  );
}
