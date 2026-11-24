import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle, Eye, EyeOff, Info, KeyRound, Loader2, LockKeyhole, LockOpen,
  LogIn, LogOut, RotateCcw, ShieldCheck, Timer, X,
} from 'lucide-react';
import appPackage from '../../../package.json';
import PinDigitInput from '../../components/common/PinDigitInput';
import { getPinAttemptStatus } from '../../services/offline/offlineVaultService';
import AuthScreen from '../../components/auth/AuthScreen';
import { getRoleLabel } from '../../utils/roleLabels';
import './OfflineUnlockScreen.css';

const appVersion = appPackage.version;
const EMPTY_PIN = { clear: () => {}, focusFirst: () => {}, getValue: () => '' };
const NOOP = () => {};

function getIdentity(user) {
  const fullName = String(user?.full_name || user?.first_name || '').trim();
  const names = fullName.split(/\s+/).filter(Boolean);
  return {
    firstName: names[0] || '',
    initials: names.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join(''),
    role: getRoleLabel(user?.role),
  };
}

function formatCountdown(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function getInitialIdentityPreference() {
  try {
    return localStorage.getItem('hs_lock_identity_hidden') === 'true';
  } catch {
    return true;
  }
}

export default function OfflineUnlockScreen({
  user,
  unlockOfflineAccess,
  logout,
  online,
  authorized,
  migrationRequired = false,
  offlineVaultError,
  onUnlockTransition = NOOP,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [pinLength, setPinLength] = useState(0);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);
  const [attemptStatus, setAttemptStatus] = useState(null);
  const [attemptStatusError, setAttemptStatusError] = useState('');
  const [clock, setClock] = useState(Date.now());
  const [modal, setModal] = useState('');
  const [modalError, setModalError] = useState('');
  const [modalBusy, setModalBusy] = useState(false);
  const [identityHidden, setIdentityHidden] = useState(getInitialIdentityPreference);
  const [signInAfterLogout, setSignInAfterLogout] = useState(false);
  const pinInputRef = useRef(EMPTY_PIN);
  const busyRef = useRef(false);
  const cardRef = useRef(null);
  const dialogRef = useRef(null);
  const modalTriggerRef = useRef(null);
  const successTimerRef = useRef(null);
  const identity = useMemo(() => getIdentity(user), [user]);
  const lockoutRemaining = Math.max(0, (attemptStatus?.lockedUntil || 0) - clock);
  const isLockedOut = lockoutRemaining > 0;
  const pinError = error?.kind === 'pin';

  const refreshAttemptStatus = useCallback(async () => {
    if (!authorized || user?.user_id === undefined || user?.user_id === null) return;
    try {
      const status = await getPinAttemptStatus(user.user_id);
      setAttemptStatus(status);
      setAttemptStatusError('');
    } catch {
      setAttemptStatus(null);
      setAttemptStatusError('PIN attempt status is unavailable. The PIN checker will still enforce its lockout rules.');
    }
  }, [authorized, user?.user_id]);

  useEffect(() => {
    if (!authorized || user?.user_id === undefined || user?.user_id === null) return undefined;
    let active = true;
    getPinAttemptStatus(user.user_id)
      .then((status) => { if (active) setAttemptStatus(status); })
      .catch(() => {
        if (active) {
          setAttemptStatus(null);
          setAttemptStatusError('PIN attempt status is unavailable. The PIN checker will still enforce its lockout rules.');
        }
      });
    return () => { active = false; };
  }, [authorized, user?.user_id]);

  useEffect(() => {
    if (!isLockedOut) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isLockedOut]);

  useEffect(() => {
    if (attemptStatus?.lockedUntil && !isLockedOut) refreshAttemptStatus();
  }, [attemptStatus?.lockedUntil, isLockedOut, refreshAttemptStatus]);

  useEffect(() => () => window.clearTimeout(successTimerRef.current), []);

  useEffect(() => {
    if (modal) return undefined;
    const trapCardFocus = (event) => {
      if (event.key !== 'Tab' || !cardRef.current) return;
      const focusable = cardRef.current.querySelectorAll(
        'input:not([disabled]), button:not([disabled]), a[href]'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', trapCardFocus);
    return () => document.removeEventListener('keydown', trapCardFocus);
  }, [modal]);

  useEffect(() => {
    if (!modal || !dialogRef.current) return undefined;
    const dialog = dialogRef.current;
    const focusable = () => dialog.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled])'
    );
    focusable()[0]?.focus();
    const trapDialogFocus = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setModal('');
        setModalError('');
        window.requestAnimationFrame(() => modalTriggerRef.current?.focus());
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = focusable();
      if (!controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault();
        controls[controls.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) {
        event.preventDefault();
        controls[0].focus();
      }
    };
    document.addEventListener('keydown', trapDialogFocus);
    return () => document.removeEventListener('keydown', trapDialogFocus);
  }, [modal]);

  const setIdentityPreference = () => {
    const next = !identityHidden;
    setIdentityHidden(next);
    try {
      localStorage.setItem('hs_lock_identity_hidden', String(next));
    } catch {
      setIdentityHidden(next);
    }
  };

  const handleUnlock = useCallback(async (credential = pinInputRef.current.getValue()) => {
    if (busyRef.current || !authorized || !user || credential.length !== 6 || isLockedOut) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    pinInputRef.current.clear();
    setPinLength(0);
    onUnlockTransition(true);
    try {
      await unlockOfflineAccess(credential);
      await refreshAttemptStatus();
      setSuccess(true);
      setBusy(false);
      const returnPath = location.state?.from?.pathname;
      const fallbackPath = user.role === 'admin' ? '/admin-dashboard' : '/dashboard';
      const destination = returnPath && returnPath !== '/login'
        ? returnPath
        : location.pathname === '/login' ? fallbackPath : location.pathname;
      successTimerRef.current = window.setTimeout(() => {
        navigate(destination, { replace: true });
        onUnlockTransition(false);
      }, 400);
    } catch (unlockError) {
      onUnlockTransition(false);
      await refreshAttemptStatus();
      const message = unlockError.message || '';
      if (/too many incorrect PIN attempts/i.test(message)) {
        setError({ kind: 'lockout', message: 'Too many incorrect PIN attempts. Please wait for the lockout to end.' });
      } else if (/PIN is incorrect|PIN.*incorrect|vault is damaged/i.test(message)) {
        setError({
          kind: 'pin',
          message: 'We couldn’t unlock HealthSync. Check your PIN; if it is correct, the encrypted data may be damaged.',
        });
      } else {
        setError({
          kind: 'general',
          message: message || 'Offline access could not be unlocked. Try again or review the recovery options.',
        });
      }
      pinInputRef.current.clear(true);
      setPinLength(0);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [authorized, isLockedOut, location.pathname, location.state, navigate, onUnlockTransition, refreshAttemptStatus, unlockOfflineAccess, user]);

  const handleFormSubmit = (event) => {
    event.preventDefault();
    handleUnlock();
  };

  const handleTryAgain = () => {
    setError(null);
    pinInputRef.current.clear(true);
    setPinLength(0);
    pinInputRef.current.focusFirst();
  };

  const openModal = (name, trigger, signIn = false) => {
    modalTriggerRef.current = trigger;
    setSignInAfterLogout(signIn);
    setModalError('');
    setModal(name);
  };

  const closeModal = () => {
    setModal('');
    setModalError('');
    window.requestAnimationFrame(() => modalTriggerRef.current?.focus());
  };

  const confirmSignOut = async () => {
    if (!logout || modalBusy) return;
    setModalBusy(true);
    setModalError('');
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (logoutError) {
      setModalError(logoutError.message || 'Sign-out cleanup did not finish. HealthSync will remain locked.');
    } finally {
      setModalBusy(false);
    }
  };

  const toggleIdentity = () => setIdentityPreference();
  const attemptWarning = Number(attemptStatus?.attemptsRemaining) > 0 && Number(attemptStatus.attemptsRemaining) <= 2;
  const attemptDanger = Number(attemptStatus?.attemptsRemaining) === 1;
  const attemptMessage = Number(attemptStatus?.attemptsRemaining) >= 0
    ? `${attemptStatus.attemptsRemaining} attempt${attemptStatus.attemptsRemaining === 1 ? '' : 's'} left`
    : '';

  return (
    <AuthScreen size="pin" className="hs-lock-screen">
      <section
        className="hs-lock-card"
        ref={cardRef}
        role={modal ? 'presentation' : 'dialog'}
        aria-modal="true"
        aria-hidden={modal ? 'true' : undefined}
        aria-labelledby="hs-lock-title"
        aria-busy={busy}
      >
        <header className="hs-lock-brand">
          <img src="/images/healthsynclogo.png" alt="HealthSync logo" />
          <strong>HealthSync</strong>
        </header>

        <div className="hs-lock-avatar-wrap">
          <span className="hs-lock-avatar" aria-hidden="true">{identityHidden ? '••' : (identity.initials || 'HS')}</span>
          <span className="hs-lock-avatar-badge"><LockKeyhole size={12} aria-hidden="true" /></span>
        </div>

        <h1 id="hs-lock-title" title={identity.firstName && !identityHidden ? `Welcome back, ${identity.firstName}` : undefined}>
          {identity.firstName ? `Welcome back, ${identityHidden ? '••••••' : identity.firstName}` : 'HealthSync is locked'}
        </h1>
        {identity.role && <div className="hs-lock-identity">
          <span className="hs-lock-role">{identity.role}</span>
          <button type="button" className="hs-lock-hide-identity" onClick={toggleIdentity}>
            {identityHidden ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
            {identityHidden ? 'Show name' : 'Hide name'}
          </button>
        </div>}
        <p className="hs-lock-copy"><ShieldCheck size={14} aria-hidden="true" />
          {success
            ? 'Unlocked. Returning you to HealthSync…'
            : migrationRequired
              ? 'Enter your current 6-digit PIN once to migrate this older offline queue. Afterward, signing in online will unlock it automatically.'
              : 'Enter your 6-digit PIN to continue. Your health data is encrypted on this device.'}
        </p>

        {!success && (
          <>
            {offlineVaultError && <p className="hs-lock-error" role="alert"><AlertCircle size={15} aria-hidden="true" /><span>{offlineVaultError}</span></p>}
            {error && <div id={pinError ? 'hs-lock-pin-error' : undefined} className={`hs-lock-feedback is-${error.kind}`} role="alert" aria-live="polite">
              <AlertCircle size={16} aria-hidden="true" />
              <span>{error.message}</span>
              {pinError && <button type="button" onClick={handleTryAgain}><RotateCcw size={13} aria-hidden="true" />Try again</button>}
            </div>}
            {attemptStatusError && <div className="hs-lock-feedback is-general" role="status">{attemptStatusError}</div>}
            {authorized && isLockedOut ? (
              <>
                <div className="hs-lock-lockout" role="status" aria-live="assertive">
                  <Timer size={16} aria-hidden="true" />
                  <span>Temporary lockout</span>
                  <strong aria-live="off">{formatCountdown(lockoutRemaining)}</strong>
                </div>
                {online && <button type="button" className="hs-lock-secondary hs-lock-password-recovery" onClick={(event) => openModal('signout', event.currentTarget, true)}>
                  <LogIn size={15} aria-hidden="true" />Sign in with password instead
                </button>}
              </>
            ) : authorized && attemptMessage ? (
              <div className={`hs-lock-attempts ${attemptDanger ? 'is-danger' : attemptWarning ? 'is-warning' : ''}`} role="status" aria-live="polite">
                <ShieldCheck size={14} aria-hidden="true" />
                <span>{attemptStatus?.lockoutDurationMinutes
                  ? `${attemptMessage} before a ${attemptStatus.lockoutDurationMinutes}-minute temporary lockout.`
                  : `${attemptMessage}.`}</span>
                <span className="hs-lock-tooltip" title={attemptStatus?.lockoutDurationMinutes
                  ? `A ${attemptStatus.lockoutDurationMinutes}-minute temporary lockout follows too many attempts. Your offline data will not be deleted by a PIN lockout.`
                  : 'A temporary lockout follows too many attempts. Your offline data will not be deleted by a PIN lockout.'}><Info size={14} aria-hidden="true" /></span>
              </div>
            ) : null}
            {authorized ? <form className="hs-lock-form" onSubmit={handleFormSubmit}>
              <div className="hs-lock-pin-group">
                <PinDigitInput
                  ref={pinInputRef}
                  disabled={busy || isLockedOut || success}
                  invalid={pinError}
                  describedBy={pinError ? 'hs-lock-pin-error' : undefined}
                  label="6-digit PIN"
                  labelId="hs-lock-pin-label"
                  onChange={(value) => {
                    setPinLength(value.length);
                    if (value) setError(null);
                  }}
                  onComplete={handleUnlock}
                />
              </div>
              <button
                className="hs-lock-primary"
                type="submit"
                disabled={busy || isLockedOut || pinLength !== 6}
              >
                {busy ? <><Loader2 className="hs-lock-spinner" size={17} aria-hidden="true" /> Unlocking...</>
                  : success ? 'Ready' : <><LockOpen size={17} aria-hidden="true" />Unlock HealthSync</>}
              </button>
            </form> : <div className="hs-lock-feedback is-general" role="status">
              {online
                ? 'Offline access is not prepared for this device. Sign in online and set up your six-digit PIN in Settings → Security.'
                : 'Offline authorization is unavailable for this account or device. Reconnect, sign in, and set up a PIN before using offline data.'}
            </div>}

            <nav className="hs-lock-actions" aria-label="Account recovery">
              <button
                ref={modalTriggerRef}
                type="button"
                onClick={(event) => openModal('forgot', event.currentTarget)}
              >
                <KeyRound size={14} aria-hidden="true" />Forgot PIN?
              </button>
              {online && <button type="button" onClick={(event) => openModal('signout', event.currentTarget, true)}>
                <LogIn size={14} aria-hidden="true" />Sign in with password instead
              </button>}
            </nav>
            <button type="button" className="hs-lock-switch-user" onClick={(event) => openModal('signout', event.currentTarget)}>
              <LogOut size={14} aria-hidden="true" />Sign out / switch user
            </button>
          </>
        )}

        {success && <div className="hs-lock-success" role="status">PIN verified</div>}
        <footer className="hs-lock-footer">
          <span className="hs-lock-version">HealthSync {appVersion}</span>
        </footer>
      </section>

      {modal && <div className="hs-lock-modal-backdrop">
        <section
          className="hs-lock-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="hs-lock-modal-title"
          ref={dialogRef}
        >
          <button type="button" className="hs-lock-modal-close" onClick={closeModal} aria-label="Close dialog"><X size={18} aria-hidden="true" /></button>
          {modal === 'forgot' ? <>
            <h2 id="hs-lock-modal-title">Forgot your PIN?</h2>
            <p>Your account password cannot unlock or reset the encrypted data on this device. HealthSync does not currently have a self-service PIN recovery flow. Contact your administrator for account help; the server cannot restore offline changes that have not synced.</p>
            <p className="hs-lock-modal-warning">Changes that have not synced are encrypted here and may become inaccessible if this device’s offline vault is reset. Data already synced to the server is not affected.</p>
            <div className="hs-lock-modal-actions">
              <button type="button" className="hs-lock-secondary" onClick={closeModal}>Close</button>
            </div>
          </> : <>
            <h2 id="hs-lock-modal-title">{signInAfterLogout ? 'Sign out to continue?' : 'Sign out or switch user?'}</h2>
            <p>Signing out clears this device’s offline authorization but keeps encrypted queued changes on this device. Their count can’t be checked while HealthSync is locked, and they won’t sync until you sign in as the same account and unlock it.</p>
            {signInAfterLogout && <p>Signing out keeps encrypted queued changes on this device. On the sign-in page, use your normal account password. A legacy PIN-only vault may still require its existing PIN once.</p>}
            {modalError && <p className="hs-lock-feedback is-general" role="alert">{modalError}</p>}
            <div className="hs-lock-modal-actions">
              <button type="button" className="hs-lock-secondary" onClick={closeModal} disabled={modalBusy}>Cancel</button>
              <button type="button" className="hs-lock-primary hs-lock-modal-primary" onClick={confirmSignOut} disabled={modalBusy}>
                {modalBusy ? 'Signing out…' : signInAfterLogout ? 'Sign out and continue' : 'Sign out'}
              </button>
            </div>
          </>}
        </section>
      </div>}
    </AuthScreen>
  );
}
