import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';

const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState(null);

  const { login } = useContext(AuthContext);
  const navigate = useNavigate();
  const location = useLocation();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const cleanUsername = username.trim();

    try {
      const resp = await login(cleanUsername, password);

      if (resp.success) {
        navigate(resp.mustChangePassword
          ? '/change-password'
          : resp.user?.role === 'admin' ? '/admin-dashboard' : '/dashboard', { replace: true });
      } else {
        setError(resp.message || 'Invalid credentials');
      }
    } catch (err) {
      setError(err?.response?.data?.message || 'Login failed');
    }
  };

  return (
    <div className="login-page-shell">
      <section className="login-context-panel">
        <div className="login-context-inner">
          <div className="login-brand-logos">
            <img src="/images/healthsynclogo.png" alt="HealthSync logo" />
            <span className="login-logo-divider" aria-hidden="true" />
            <img src="/images/estanciaseallogo.png" alt="Estancia Barangay Council seal" />
          </div>
          <p className="login-location">BARANGAY ESTANCIA, KALIBO, AKLAN</p>
          <h1 className="login-context-title">Community health records and nutrition monitoring, in one place.</h1>
          <p className="login-context-copy">HealthSync gives Barangay Health Workers a single, reliable record of every resident, from routine visits to nutrition assessments.</p>
          <div className="login-feature-grid">
            <div className="login-feature-card"><span className="login-feature-icon" aria-hidden="true">✦</span><strong>Nutrition insights</strong><span>Track growth and status</span></div>
            <div className="login-feature-card"><span className="login-feature-icon" aria-hidden="true">▥</span><strong>Clear reports</strong><span>See community trends</span></div>
            <div className="login-feature-card"><span className="login-feature-icon" aria-hidden="true">⌁</span><strong>Works offline</strong><span>Keep care moving</span></div>
          </div>
        </div>
      </section>

      <section className="login-form-panel">
        <div className="login-form-content">
          <div className="login-card">
            <div className="login-card-logo">
              <img src="/images/healthsynclogo.png" alt="HealthSync logo" />
            </div>
            <div className="login-card-header">
              <p className="login-eyebrow">HEALTHSYNC PORTAL</p>
              <h2 className="login-card-title">Welcome back</h2>
              <p className="login-card-subtitle">Sign in to continue to your workspace</p>
            </div>
            {location.state?.message && <div className="alert alert-success login-alert" role="status">{location.state.message}</div>}
            {error && <div className="alert alert-danger login-alert" role="alert">{error}</div>}
            <form onSubmit={handleSubmit} className="login-form">
              <div className="login-field">
                <label className="form-label" htmlFor="username">Username</label>
                <input id="username" className="form-control login-input" type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Enter username" autoComplete="username" required />
              </div>
              <div className="login-field">
                <label className="form-label" htmlFor="password">Password</label>
                <div className="login-password-input-wrap">
                  <input id="password" className="form-control login-input" type={passwordVisible ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" autoComplete="current-password" required />
                  <button className="login-password-toggle" type="button" onClick={() => setPasswordVisible((visible) => !visible)} aria-label={passwordVisible ? 'Hide password' : 'Show password'} aria-pressed={passwordVisible}>
                    {passwordVisible ? (
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10.8 10.8 0 0 1 12 5c5 0 8.5 4.1 9.5 7-.4 1.1-1.2 2.3-2.3 3.4M6.2 6.2C3.9 7.5 2.8 9.5 2.5 12c1 2.9 4.5 7 9.5 7 1 0 2-.2 2.9-.5" /></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" /><circle cx="12" cy="12" r="2.5" /></svg>
                    )}
                  </button>
                </div>
                <span className="login-contact-admin">Forgot password? Contact your administrator.</span>
              </div>
              <button className="btn btn-primary login-button" type="submit">Login <span aria-hidden="true">&#8594;</span></button>
              <p className="login-panel-footer">Accounts are created by the administrator.</p>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
};

export default LoginPage;