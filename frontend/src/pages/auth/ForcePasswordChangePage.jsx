import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle, CheckCircle2, Circle, Eye, EyeOff, KeyRound, Loader2, LockKeyhole,
  LogOut, ShieldAlert, TriangleAlert, X, XCircle,
} from 'lucide-react';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api/apiClient';
import PinDigitInput from '../../components/common/PinDigitInput';
import AuthScreen from '../../components/auth/AuthScreen';
import './ForcePasswordChangePage.css';

const PASSWORD_MIN_LENGTH = 18;
const PASSWORD_MAX_BYTES = 72;

const getPasswordRules = (password) => {
  const symbol = Array.from(password).some((character) => {
    const code = character.charCodeAt(0);
    const isAlphaNumeric = (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122);
    return !isAlphaNumeric && character !== ' ';
  });
  return {
    length: Array.from(password).length >= PASSWORD_MIN_LENGTH,
    uppercase: /[A-Z]/.test(password),
    number: /\d/.test(password),
    symbol,
    bcryptLimit: new Blob([password]).size <= PASSWORD_MAX_BYTES,
  };
};

const PasswordField = ({
  id, label, value, onChange, visible, onToggleVisible, mismatch = false,
  describedBy, inputRef, onCapsLock,
}) => (
  <div className="hs-force-field">
    <label htmlFor={id}>{label}</label>
    <div className={`hs-force-password ${mismatch ? 'is-mismatch' : ''}`}>
      <LockKeyhole size={17} aria-hidden="true" />
      <input
        ref={inputRef}
        id={id}
        name={id === 'hs-new-password' ? 'new-password' : 'confirm-password'}
        type={visible ? 'text' : 'password'}
        autoComplete="new-password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => onCapsLock?.(event.getModifierState?.('CapsLock') || false)}
        onKeyUp={(event) => onCapsLock?.(event.getModifierState?.('CapsLock') || false)}
        onFocus={(event) => onCapsLock?.(event.getModifierState?.('CapsLock') || false)}
        aria-describedby={describedBy}
        aria-invalid={mismatch || undefined}
        required
      />
      <button type="button" onClick={onToggleVisible} aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-pressed={visible}>
        {visible ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
      </button>
    </div>
  </div>
);

const StrengthMeter = ({ password, rules }) => {
  const metCount = Object.values(rules).filter(Boolean).length;
  const score = !password ? 0 : metCount <= 1 ? 1 : metCount <= 3 ? 2 : metCount === 4 ? 3 : 4;
  const label = !password ? 'Not set' : score === 1 ? 'Weak' : score === 2 ? 'Fair' : score === 3 ? 'Good' : 'Strong';
  return (
    <div className="hs-force-strength" role="status" aria-live="polite">
      <div className="hs-force-strength-heading"><span>Password strength</span><strong className={`strength-${score}`}>{label}</strong></div>
      <div className="hs-force-strength-track" aria-hidden="true">
        {[1, 2, 3, 4].map((segment) => <span key={segment} className={segment <= score ? `strength-filled strength-${score}` : ''} />)}
      </div>
    </div>
  );
};

const RequirementsList = ({ rules }) => {
  const items = [
    ['length', `At least ${PASSWORD_MIN_LENGTH} characters`],
    ['uppercase', 'One uppercase letter'],
    ['number', 'One number'],
    ['symbol', 'One symbol'],
    ['bcryptLimit', `No more than ${PASSWORD_MAX_BYTES} UTF-8 bytes`],
  ];
  return (
    <ul id="hs-password-rules" className="hs-force-rules">
      {items.map(([key, text]) => {
        const exceededBytes = key === 'bcryptLimit' && !rules[key];
        const Icon = exceededBytes ? XCircle : rules[key] ? CheckCircle2 : Circle;
        return <li key={key} className={`${rules[key] ? 'is-valid' : ''} ${exceededBytes ? 'is-error' : ''}`}><Icon size={14} aria-hidden="true" /><span>{exceededBytes ? `Over ${PASSWORD_MAX_BYTES} UTF-8 bytes` : text}</span></li>;
      })}
    </ul>
  );
};

const ForcePasswordChangePage = () => {
  const { user, token, completePasswordChange, logout, offlineVaultError } = useContext(AuthContext);
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [offlineWarning, setOfflineWarning] = useState('');
  const [complete, setComplete] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const [pin, setPin] = useState('');
  const [pinConfirmation, setPinConfirmation] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [capsLock, setCapsLock] = useState(false);
  const pinInputRef = useRef(null);
  const pinConfirmationInputRef = useRef(null);
  const currentPinInputRef = useRef(null);
  const passwordRef = useRef(null);
  const [setupToken, setSetupToken] = useState('');
  const [setupUser, setSetupUser] = useState(null);

  useEffect(() => {
    if (user && !user.must_change_password && !user.offline_pin_setup_required && !complete) {
      navigate(user.role === 'admin' ? '/admin-dashboard' : '/dashboard', { replace: true });
    }
  }, [complete, navigate, user]);

  const requirements = useMemo(() => getPasswordRules(password), [password]);
  const setupRequired = Boolean(user?.offline_pin_setup_required);
  const pinResetRequired = setupRequired && Boolean(user?.offline_account_pin_enrolled);
  const pinValid = /^\d{6}$/.test(pin) && pin === pinConfirmation;
  const hasResetCredential = /^\d{6}$/.test(currentPin) || Boolean(currentPassword);
  const mismatch = Boolean(confirmation && password !== confirmation);
  const valid = (passwordUpdated || !user?.must_change_password
    ? pinValid
    : Object.values(requirements).every(Boolean) && password === confirmation && (!setupRequired || pinValid))
    && (!pinResetRequired || hasResetCredential);

  useEffect(() => {
    if (error) passwordRef.current?.focus();
  }, [error]);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!valid) return;
    setBusy(true);
    try {
      if (passwordUpdated || !user?.must_change_password) {
        const ready = await completePasswordChange(
          setupToken || token,
          setupUser || user,
          pin,
          password || currentPassword || undefined,
          currentPin || undefined,
          currentPassword || undefined,
        );
        if (!ready) throw new Error(offlineVaultError || 'PIN setup could not be completed. Retry before continuing.');
        setPin('');
        setPinConfirmation('');
        setCurrentPin('');
        setCurrentPassword('');
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
        const offlineReady = await completePasswordChange(
          response.data.data.token,
          response.data.data.user,
          pin,
          password,
          currentPin || undefined,
          currentPassword || undefined,
        );
        if (!offlineReady) {
          setOfflineWarning(offlineVaultError || 'PIN setup was not completed. Retry PIN setup before continuing.');
          return;
        }
      } else {
        await completePasswordChange(response.data.data.token, response.data.data.user, password, password);
      }
      setPassword('');
      setConfirmation('');
      setComplete(true);
    } catch (requestError) {
      setError(requestError.message || 'Unable to change password.');
    } finally {
      setBusy(false);
    }
  };

  const continueToWorkspace = () => navigate(user?.role === 'admin' ? '/admin-dashboard' : '/dashboard', { replace: true });
  const signOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const existingCredentialFields = pinResetRequired ? (
    <div className="hs-force-existing-credential">
      <p>Enter this device’s current PIN, or the account password if this device has an account-password vault wrapper.</p>
      <fieldset className="hs-force-pin-group"><legend>Current six-digit PIN</legend>
        <PinDigitInput ref={currentPinInputRef} onChange={setCurrentPin} />
      </fieldset>
      <div className="hs-force-current-password">
        <label htmlFor="hs-current-account-password">Or current account password</label>
        <input id="hs-current-account-password" type="password" autoComplete="current-password" value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)} />
      </div>
    </div>
  ) : null;

  return (
    <AuthScreen size="password">
      <section className="hs-force-card" aria-labelledby="hs-force-title">
        <header className="hs-force-brand"><img src="/images/healthsynclogo.png" alt="HealthSync logo" /><span>HealthSync</span></header>
        {complete ? (
          <div className="hs-force-complete" role="status" aria-live="polite">
            <span className="hs-force-check"><CheckCircle2 size={24} aria-hidden="true" /></span>
            <h1 id="hs-force-title">{pinResetRequired ? 'Offline PIN reset' : setupRequired ? 'PIN registered' : 'Password updated'}</h1>
            <p>{pinResetRequired ? 'Your new shared PIN is saved. Other devices may need to sign in and unlock their existing offline vault before re-enrolling.' : setupRequired ? 'Your shared six-digit PIN is ready to use on your approved devices. Each device keeps its own offline records.' : 'Your password is secure and your other sessions have been signed out.'}</p>
            {offlineWarning && <p className="hs-force-inline-alert" role="status"><AlertCircle size={15} aria-hidden="true" />{offlineWarning}</p>}
            <button type="button" className="hs-force-primary" onClick={continueToWorkspace}>Continue to HealthSync</button>
          </div>
        ) : (
          <>
            <p className="hs-force-eyebrow"><ShieldAlert size={14} aria-hidden="true" />Security requirement</p>
            <h1 id="hs-force-title">{passwordUpdated || !user?.must_change_password
              ? pinResetRequired ? 'Reset your offline PIN' : 'Set your offline PIN'
              : setupRequired ? 'Set your password and account PIN' : 'Set your new password'}</h1>
            <p className="hs-force-copy">{passwordUpdated || !user?.must_change_password
              ? pinResetRequired
                ? 'Choose a new six-digit PIN. Unlock this device’s existing offline vault with its current PIN or a configured account-password wrapper first. Other devices will need to re-enroll when they reconnect.'
                : 'Choose one six-digit PIN for your account. Use the same PIN on your other approved devices; each device stores its offline data separately.'
              : setupRequired
                ? 'Choose a password only you know and set a six-digit PIN for offline access. Your temporary password cannot be used again.'
                : 'Choose a password only you know. Your temporary password cannot be used again.'}</p>
            {error && <div className="hs-force-server-alert" role="alert"><AlertCircle size={16} aria-hidden="true" /><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError('')}><X size={15} aria-hidden="true" /></button></div>}
            {!passwordUpdated && user?.must_change_password && (
              <form onSubmit={submit} className="hs-force-form">
                <PasswordField id="hs-new-password" label="New password" value={password} onChange={setPassword} visible={visible} onToggleVisible={() => setVisible((value) => !value)} describedBy="hs-password-rules" inputRef={passwordRef} onCapsLock={setCapsLock} />
                {capsLock && <p className="hs-force-caps" role="status"><TriangleAlert size={14} aria-hidden="true" />Caps Lock is on</p>}
                <PasswordField id="hs-confirm-password" label="Confirm password" value={confirmation} onChange={setConfirmation} visible={confirmVisible} onToggleVisible={() => setConfirmVisible((value) => !value)} mismatch={mismatch} describedBy="hs-password-confirm-feedback hs-password-rules" onCapsLock={setCapsLock} />
                {confirmation && <p id="hs-password-confirm-feedback" className={`hs-force-confirm-feedback ${mismatch ? 'is-mismatch' : 'is-match'}`} role="status">{mismatch ? <AlertCircle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}{mismatch ? 'Passwords do not match' : 'Passwords match'}</p>}
                <StrengthMeter password={password} rules={requirements} />
                <RequirementsList rules={requirements} />
                {setupRequired && <>
                  {existingCredentialFields}
                  <fieldset className="hs-force-pin-group"><legend>Six-digit PIN</legend><PinDigitInput ref={pinInputRef} onChange={setPin} showStrengthHint /></fieldset>
                  <fieldset className="hs-force-pin-group"><legend>Confirm six-digit PIN</legend><PinDigitInput ref={pinConfirmationInputRef} invalid={Boolean(pinConfirmation && pin !== pinConfirmation)} describedBy={pinConfirmation && pin !== pinConfirmation ? 'hs-force-pin-mismatch' : undefined} autoFocus={false} onChange={setPinConfirmation} /></fieldset>
                  {pinConfirmation && pin !== pinConfirmation && <span id="hs-force-pin-mismatch" className="hs-force-inline-error" role="status">PIN entries do not match.</span>}
                </>}
                <button type="submit" className="hs-force-primary" disabled={!valid || busy}>{busy ? <><Loader2 className="hs-force-spinner" size={17} aria-hidden="true" />Saving...</> : <><KeyRound size={17} aria-hidden="true" />{setupRequired ? 'Save password and PIN' : 'Save new password'}</>}</button>
              </form>
            )}
            {(passwordUpdated || !user?.must_change_password) && <form onSubmit={submit} className="hs-force-form">
              {existingCredentialFields}
              <fieldset className="hs-force-pin-group"><legend>Six-digit PIN</legend><PinDigitInput ref={pinInputRef} onChange={setPin} showStrengthHint /></fieldset>
              <fieldset className="hs-force-pin-group"><legend>Confirm six-digit PIN</legend><PinDigitInput ref={pinConfirmationInputRef} invalid={Boolean(pinConfirmation && pin !== pinConfirmation)} describedBy={pinConfirmation && pin !== pinConfirmation ? 'hs-force-pin-mismatch' : undefined} autoFocus={false} onChange={setPinConfirmation} /></fieldset>
              {pinConfirmation && pin !== pinConfirmation && <span id="hs-force-pin-mismatch" className="hs-force-inline-error" role="status">PIN entries do not match.</span>}
              {offlineWarning && <p className="hs-force-inline-alert" role="alert"><AlertCircle size={15} aria-hidden="true" />{offlineWarning}</p>}
              <button type="submit" className="hs-force-primary" disabled={!valid || busy}>{busy ? <><Loader2 className="hs-force-spinner" size={17} aria-hidden="true" />Saving...</> : 'Save PIN'}</button>
            </form>}
          </>
        )}
        {!complete && <button type="button" className="hs-force-logout" onClick={signOut}><LogOut size={15} aria-hidden="true" />Sign out</button>}
      </section>
    </AuthScreen>
  );
};

export default ForcePasswordChangePage;
