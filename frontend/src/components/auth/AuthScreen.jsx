import React from 'react';
import ThemeToggle from '../common/ThemeToggle';
import './AuthScreen.css';

export default function AuthScreen({ children, size = 'password', className = '' }) {
  return (
    <main className={`auth-screen auth-screen-${size} ${className}`}>
      <ThemeToggle className="theme-toggle--standalone" />
      {children}
    </main>
  );
}
