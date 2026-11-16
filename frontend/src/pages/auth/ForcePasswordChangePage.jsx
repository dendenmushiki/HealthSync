import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api/apiClient';
import PinDigitInput from '../../components/common/PinDigitInput';
import './ForcePasswordChangePage.css';

const ForcePasswordChangePage = () => {
  const { user, token, completePasswordChange, logout, offlineVaultError } = useContext(AuthContext);
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [offlineWarning, setOfflineWarning] = useState('');
  const [complete, setComplete] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const [pin, setPin] = useState('');
  const [pinConfirmation, setPinConfirmation] = useState('');
  const pinInputRef = useRef(null);
  const pinConfirmationInputRef = useRef(null);
  const [setupToken, setSetupToken] = useState('');
  const [setupUser, setSetupUser] = useState(null);
  useEffect(() => {
    if (user && !user.must_change_password && !user.offline_pin_setup_required && !complete) {
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
  const setupRequired = Boolean(user?.offline_pin_setup_required);
  const pinValid = /^\d{6}$/.test(pin) && pin === pinConfirmation;
  const valid = (passwordUpdated || !user?.must_change_password
    ? pinValid
    : Object.values(requirements).every(Boolean) && password === confirmation && (!setupRequired || pinValid));

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!valid) return;
    setBusy(true);
    try {
      if (passwordUpdated || !user?.must_change_password) {
        const ready = await completePasswordChange(setupToken || token, setupUser || user, pin);
        if (!ready) throw new Error(offlineVaultError || 'PIN setup could not be completed. Retry before continuing.');
        setPin('');
        setPinConfirmation('');
        if (!setupRequired) {
          navigate(user?.role === 'admin' ? '/admin-dashboard' : '/dashboard', { replace: true });
          return;
        }
        pinInputRef.current?.clear();
        pinConfirmationInputRef.current?.clear();
        setComplete(true);
        return;
      }
      const response = await api.post('/auth/change-password', { new_password: password });
      if (!response.data?.success) throw new Error(response.data?.message || 'Unable to change password.');
      setPasswordUpdated(true);
      setSetupToken(response.data.data.token);
      setSetupUser(response.data.data.user);
      if (response.data.data.user?.offline_pin_setup_required) {
        const offlineReady = await completePasswordChange(response.data.data.token, response.data.data.user, pin);
        if (!offlineReady) {
          setOfflineWarning(offlineVaultError || 'PIN setup was not completed. Retry PIN setup before continuing.');
          return;
        }
      } else {
        await completePasswordChange(response.data.data.token, response.data.data.user, password);
      }
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
            <h1 id="hs-force-title">{setupRequired ? 'PIN registered' : 'Password updated'}</h1>
            <p>{setupRequired ? 'Your six-digit PIN is ready to unlock HealthSync on this device.' : 'Your password is secure and your other sessions have been signed out.'}</p>
            {offlineWarning && <p className="hs-force-error" role="status">{offlineWarning}</p>}
            <button type="button" className="hs-force-primary" onClick={continueToWorkspace}>Continue to HealthSync</button>
          </div>
        ) : (
          <>
            <p className="hs-force-eyebrow">SECURITY REQUIREMENT</p>
            <h1 id="hs-force-title">{passwordUpdated || !user?.must_change_password ? 'Set your offline PIN' : 'Set your new password'}</h1>
            <p className="hs-force-copy">{passwordUpdated || !user?.must_change_password
              ? 'Choose a six-digit PIN to unlock your encrypted offline data. Your PIN is not your account password.'
              : 'Choose a password only you know. Your temporary password cannot be used again.'}</p>
            {error && <div className="hs-force-error" role="alert">{error}</div>}
            {!passwordUpdated && user?.must_change_password && (
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
              {setupRequired && <>
                <fieldset className="hs-force-pin-group">
                  <legend>Six-digit PIN</legend>
                  <PinDigitInput ref={pinInputRef} onChange={setPin} showStrengthHint />
                </fieldset>
                <fieldset className="hs-force-pin-group">
                  <legend>Confirm six-digit PIN</legend>
                  <PinDigitInput
                    ref={pinConfirmationInputRef}
                    invalid={Boolean(pinConfirmation && pin !== pinConfirmation)}
                    describedBy={pinConfirmation && pin !== pinConfirmation ? 'hs-force-pin-mismatch' : undefined}
                    autoFocus={false}
                    onChange={setPinConfirmation}
                  />
                </fieldset>
                {pinConfirmation && pin !== pinConfirmation && <span id="hs-force-pin-mismatch" className="hs-force-inline-error" role="status">PIN entries do not match.</span>}
              </>}
              <button type="submit" className="hs-force-primary" disabled={!valid || busy}>
                {busy ? <><span className="hs-force-spinner" aria-hidden="true" /> Saving...</> : setupRequired ? 'Save password and PIN' : 'Save new password'}
              </button>
            </form>
            )}
            {(passwordUpdated || !user?.must_change_password) && <form onSubmit={submit} className="hs-force-form">
              <fieldset className="hs-force-pin-group">
                <legend>Six-digit PIN</legend>
                <PinDigitInput ref={pinInputRef} onChange={setPin} showStrengthHint />
              </fieldset>
              <fieldset className="hs-force-pin-group">
                <legend>Confirm six-digit PIN</legend>
                <PinDigitInput
                  ref={pinConfirmationInputRef}
                  invalid={Boolean(pinConfirmation && pin !== pinConfirmation)}
                  describedBy={pinConfirmation && pin !== pinConfirmation ? 'hs-force-pin-mismatch' : undefined}
                  autoFocus={false}
                  onChange={setPinConfirmation}
                />
              </fieldset>
              {pinConfirmation && pin !== pinConfirmation && <span id="hs-force-pin-mismatch" className="hs-force-inline-error" role="status">PIN entries do not match.</span>}
              {offlineWarning && <p className="hs-force-error" role="alert">{offlineWarning}</p>}
              <button type="submit" className="hs-force-primary" disabled={!valid || busy}>
                {busy ? <><span className="hs-force-spinner" aria-hidden="true" /> Saving...</> : 'Save PIN'}
              </button>
            </form>}
          </>
        )}
        {!complete && <button type="button" className="hs-force-logout" onClick={async () => { await logout(); navigate('/login', { replace: true }); }}>Sign out</button>}
      </section>
    </main>
  );
};

export default ForcePasswordChangePage;
