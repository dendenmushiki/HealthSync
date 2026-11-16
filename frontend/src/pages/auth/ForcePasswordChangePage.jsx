import React, { useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api/apiClient';
import './ForcePasswordChangePage.css';

const ForcePasswordChangePage = () => {
  const { user, completePasswordChange, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  useEffect(() => {
    if (user && !user.must_change_password && !complete) {
      navigate(user.role === 'admin' ? '/admin-dashboard' : '/dashboard', { replace: true });
    }
  }, [complete, navigate, user]);
  const requirements = useMemo(() => ({
    length: Array.from(password).length >= 18,
    uppercase: /[A-Z]/.test(password),
    number: /\d/.test(password),
    symbol: /[^A-Za-z0-9\s]/.test(password),
    bcryptLimit: new Blob([password]).size <= 72,
  }), [password]);
  const valid = Object.values(requirements).every(Boolean) && password === confirmation;

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!valid) return;
    setBusy(true);
    try {
      const response = await api.post('/auth/change-password', { new_password: password });
      if (!response.data?.success) throw new Error(response.data?.message || 'Unable to change password.');
      completePasswordChange(response.data.data.token, response.data.data.user);
      setPassword('');
      setConfirmation('');
      setComplete(true);
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || 'Unable to change password.');
    } finally {
      setBusy(false);
    }
  };

  const continueToWorkspace = () => navigate(user?.role === 'admin' ? '/admin-dashboard' : '/dashboard', { replace: true });

  return (
    <main className="hs-force-page">
      <section className="hs-force-card" aria-labelledby="hs-force-title">
        <div className="hs-force-brand"><img src="/images/healthsynclogo.png" alt="" /><span>HealthSync</span></div>
        {complete ? (
          <div className="hs-force-complete" role="status" aria-live="polite">
            <span className="hs-force-check" aria-hidden="true">✓</span>
            <h1 id="hs-force-title">Password updated</h1>
            <p>Your password is secure and your other sessions have been signed out.</p>
            <button type="button" className="hs-force-primary" onClick={continueToWorkspace}>Continue to HealthSync</button>
          </div>
        ) : (
          <>
            <p className="hs-force-eyebrow">SECURITY REQUIREMENT</p>
            <h1 id="hs-force-title">Set your new password</h1>
            <p className="hs-force-copy">Choose a password only you know. Your temporary password cannot be used again.</p>
            {error && <div className="hs-force-error" role="alert">{error}</div>}
            <form onSubmit={submit} className="hs-force-form">
              <label htmlFor="hs-new-password">New password</label>
              <div className="hs-force-password">
                <input id="hs-new-password" type={visible ? 'text' : 'password'} autoComplete="new-password" value={password}
                  onChange={(event) => setPassword(event.target.value)} aria-describedby="hs-password-rules" required />
                <button type="button" onClick={() => setVisible((state) => !state)} aria-label={visible ? 'Hide password' : 'Show password'}>{visible ? 'Hide' : 'Show'}</button>
              </div>
              <label htmlFor="hs-confirm-password">Confirm password</label>
              <input id="hs-confirm-password" type={visible ? 'text' : 'password'} autoComplete="new-password" value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)} required />
              {confirmation && password !== confirmation && <span className="hs-force-inline-error">Passwords do not match.</span>}
              <div className="hs-force-strength" aria-live="polite">
                <span>Password strength</span>
                <strong>{!password ? 'Not set' : Object.values(requirements).filter(Boolean).length < 3 ? 'Weak' : Object.values(requirements).every(Boolean) ? 'Strong' : 'Fair'}</strong>
              </div>
              <ul id="hs-password-rules" className="hs-force-rules">
                <li className={requirements.length ? 'valid' : ''}>At least 18 characters</li>
                <li className={requirements.uppercase ? 'valid' : ''}>One uppercase letter</li>
                <li className={requirements.number ? 'valid' : ''}>One number</li>
                <li className={requirements.symbol ? 'valid' : ''}>One symbol</li>
                <li className={requirements.bcryptLimit ? 'valid' : ''}>No more than 72 UTF-8 bytes</li>
              </ul>
              <button type="submit" className="hs-force-primary" disabled={!valid || busy}>
                {busy ? <><span className="hs-force-spinner" aria-hidden="true" /> Saving...</> : 'Save new password'}
              </button>
            </form>
          </>
        )}
        {!complete && <button type="button" className="hs-force-logout" onClick={async () => { await logout(); navigate('/login', { replace: true }); }}>Sign out</button>}
      </section>
    </main>
  );
};

export default ForcePasswordChangePage;
