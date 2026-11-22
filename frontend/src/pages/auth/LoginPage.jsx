import React, { useContext, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import StatusBanner from '../../components/common/StatusBanner';
import { getFriendlyError } from '../../utils/apiErrorMessages';

const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [error, setError] = useState(null);

  const { login } = useContext(AuthContext);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const updateNetworkState = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateNetworkState);
    window.addEventListener('offline', updateNetworkState);
    return () => {
      window.removeEventListener('online', updateNetworkState);
      window.removeEventListener('offline', updateNetworkState);
    };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;

    setError(null);
    setIsSubmitting(true);

    const cleanUsername = username.trim();

    try {
      const resp = await login(cleanUsername, password);

      if (resp.success) {
        navigate(resp.mustChangePassword
          ? '/change-password'
          : resp.user?.role === 'admin' ? '/admin-dashboard' : '/dashboard', { replace: true });
      } else {
        setError(getFriendlyError(resp.message || 'Invalid credentials'));
      }
    } catch (err) {
      console.error('Unable to sign in.', err);
      setError(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const passwordDescription = [
    error && 'login-error',
    capsLockOn && 'login-caps-lock-warning'
  ].filter(Boolean).join(' ') || undefined;

  return (
    <main className="login-page-shell">
      <section className="login-context-panel" aria-label="About HealthSync">
        <div className="login-context-inner">
          <header className="login-brand-header">
            <div className="login-brand-row">
              <div className="login-brand-logos">
                <img
                  src="/images/healthsynclogo.png"
                  alt="HealthSync logo"
                  width="76"
                  height="76"
                  decoding="async"
                />
                <span className="login-logo-divider" aria-hidden="true" />
                <img
                  src="/images/estanciaseallogo.png"
                  alt="Community council seal"
                  width="76"
                  height="76"
                  decoding="async"
                />
              </div>
              <div className="login-brand-copy">
                <p className="login-brand-name">HealthSync</p>
                <p className="login-brand-tagline">Community Care</p>
              </div>
            </div>
            <p className="login-location">COMMUNITY HEALTH SYSTEM</p>
          </header>

          <div className="login-context-main">
            <h1 className="login-context-title">Community health records and nutrition monitoring, in one place.</h1>
            <p className="login-mobile-tagline">Community health records, in one place.</p>
            <p className="login-context-copy">
              HealthSync gives Barangay Health Workers a single, reliable record of every resident,
              from routine visits to nutrition assessments.
            </p>
            <div className="login-feature-grid">
              <div className="login-feature-card">
                <span className="login-feature-icon" aria-hidden="true">✦</span>
                <strong>Nutrition insights</strong>
                <span>Track growth and status</span>
              </div>
              <div className="login-feature-card">
                <span className="login-feature-icon" aria-hidden="true">▥</span>
                <strong>Clear reports</strong>
                <span>See community trends</span>
              </div>
              <div className="login-feature-card">
                <span className="login-feature-icon" aria-hidden="true">⌁</span>
                <strong>Works offline</strong>
                <span>Keep care moving</span>
              </div>
            </div>
          </div>
        </div>
        <p className="login-context-footer">Supporting community-led care.</p>
      </section>

      <section className="login-form-panel" aria-label="Sign in">
        <div className="login-form-content">
          <div className="login-card">
            <div className="login-card-logo">
              <img src="/images/healthsynclogo.png" alt="HealthSync logo" width="64" height="64" decoding="async" />
            </div>
            <div className="login-card-header">
              <p className="login-eyebrow" id="login-form-label">HEALTHSYNC PORTAL</p>
              <h2 className="login-card-title login-card-title-desktop">Welcome back</h2>
              <h1 className="login-card-title login-card-title-mobile">Welcome back</h1>
              <p className="login-card-subtitle">Sign in to continue to your workspace</p>
            </div>
            {location.state?.message && (
              <div className="alert alert-success login-alert" role="status" aria-live="polite">
                <span className="login-alert-icon" aria-hidden="true">✓</span>
                {location.state.message}
              </div>
            )}
            {error && <StatusBanner id="login-error" error={error} compact />}
            <form onSubmit={handleSubmit} className="login-form" aria-labelledby="login-form-label">
              <div className="login-field">
                <label className="form-label" htmlFor="username">Username</label>
                <input
                  id="username"
                  className="form-control login-input"
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Enter username"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="next"
                  aria-invalid={error ? 'true' : undefined}
                  aria-describedby={error ? 'login-error' : undefined}
                  required
                />
              </div>
              <div className="login-field">
                <label className="form-label" htmlFor="password">Password</label>
                <div className="login-password-input-wrap">
                  <input
                    id="password"
                    className="form-control login-input"
                    type={passwordVisible ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyDown={(event) => setCapsLockOn(event.getModifierState('CapsLock'))}
                    onKeyUp={(event) => setCapsLockOn(event.getModifierState('CapsLock'))}
                    onBlur={() => setCapsLockOn(false)}
                    placeholder="Enter password"
                    autoComplete="current-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="go"
                    aria-invalid={error ? 'true' : undefined}
                    aria-describedby={passwordDescription}
                    required
                  />
                  <button
                    className="login-password-toggle"
                    type="button"
                    onClick={() => setPasswordVisible((visible) => !visible)}
                    aria-label={passwordVisible ? 'Hide password' : 'Show password'}
                    aria-pressed={passwordVisible}
                  >
                    {passwordVisible ? (
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10.8 10.8 0 0 1 12 5c5 0 8.5 4.1 9.5 7-.4 1.1-1.2 2.3-2.3 3.4M6.2 6.2C3.9 7.5 2.8 9.5 2.5 12c1 2.9 4.5 7 9.5 7 1 0 2-.2 2.9-.5" /></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" /><circle cx="12" cy="12" r="2.5" /></svg>
                    )}
                  </button>
                </div>
                {capsLockOn && (
                  <p className="login-caps-lock-warning" id="login-caps-lock-warning" role="status">
                    <span aria-hidden="true">!</span>
                    Caps Lock is on.
                  </p>
                )}
                <p className="login-contact-admin">Forgot password? Contact your administrator.</p>
              </div>
              <button
                className="btn btn-primary login-button"
                type="submit"
                disabled={isSubmitting}
                aria-busy={isSubmitting}
              >
                {isSubmitting && <span className="login-spinner" aria-hidden="true" />}
                {isSubmitting ? 'Signing in…' : 'Login'}
                {!isSubmitting && <span aria-hidden="true">&#8594;</span>}
              </button>
              <p className="login-admin-note">Accounts are created by the administrator.</p>
            </form>
          </div>
        </div>
        <footer className="login-page-footer">
          <span
            className={`login-connection-chip ${online ? 'is-online' : 'is-offline'}`}
            role="status"
            aria-live="polite"
          >
            <span className="login-connection-dot" aria-hidden="true" />
            {online ? 'Online' : 'Offline'}
          </span>
          <span>HealthSync · Barangay Health Monitoring · {new Date().getFullYear()}</span>
        </footer>
      </section>
    </main>
  );
};

export default LoginPage;
