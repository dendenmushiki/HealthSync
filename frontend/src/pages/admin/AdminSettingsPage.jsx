import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api/apiClient';
import { getProfilePhotoUrl, validateProfilePhoto } from '../../utils/profilePhoto';

const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'security', label: 'Security' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'privacy', label: 'Data & Privacy' },
];

const DEFAULT_PREFERENCES = {
  theme: 'system',
  textSize: 'default',
  notifications: {
    nutritionAlerts: true,
    seniorFollowUpAlerts: true,
    offlineSyncAlerts: true,
    newResidentAlerts: true,
  },
};

const readCachedPreferences = () => {
  try {
    const stored = JSON.parse(localStorage.getItem('hs_preferences') || 'null');
    return stored ? {
      ...DEFAULT_PREFERENCES,
      ...stored,
      notifications: { ...DEFAULT_PREFERENCES.notifications, ...stored.notifications },
    } : DEFAULT_PREFERENCES;
  } catch (error) {
    return DEFAULT_PREFERENCES;
  }
};

const applyPreferences = (preferences) => {
  const root = document.documentElement;
  const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = preferences.theme === 'system' ? (systemDark ? 'dark' : 'light') : preferences.theme;
  root.dataset.themePreference = preferences.theme;
  root.dataset.textSize = preferences.textSize;
  const scales = { small: '0.875', default: '1', large: '1.125', 'extra-large': '1.25' };
  root.style.setProperty('--hs-font-scale', scales[preferences.textSize] || scales.default);
};

const isSame = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const SettingCard = ({ title, description, children, className = '' }) => (
  <section className={`settings-card ${className}`}>
    <header className="settings-card-heading">
      <h3>{title}</h3>
      <p>{description}</p>
    </header>
    {children}
  </section>
);

const PreferenceSwitch = ({ id, checked, onChange, title, description }) => (
  <label className="settings-switch-row" htmlFor={id}>
    <span className="settings-switch-copy"><strong>{title}</strong><span>{description}</span></span>
    <input
      id={id}
      className="settings-switch"
      type="checkbox"
      role="switch"
      aria-checked={checked}
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  </label>
);

const userAgentLabel = (userAgent = '') => {
  const browser = /Edg\/[\d.]+/.test(userAgent) ? 'Microsoft Edge'
    : /Chrome\/[\d.]+/.test(userAgent) ? 'Google Chrome'
      : /Firefox\/[\d.]+/.test(userAgent) ? 'Mozilla Firefox'
        : /Safari\/[\d.]+/.test(userAgent) ? 'Safari' : 'Unknown browser';
  const os = /Windows/.test(userAgent) ? 'Windows'
    : /Android/.test(userAgent) ? 'Android'
      : /iPhone|iPad|iPod/.test(userAgent) ? 'iOS'
        : /Mac OS/.test(userAgent) ? 'macOS'
          : /Linux/.test(userAgent) ? 'Linux' : 'Unknown device';
  return `${browser} · ${os}`;
};

const AdminSettingsPage = () => {
  const { user, updateUser, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedSection = SECTIONS.some(({ id }) => id === searchParams.get('tab'))
    ? searchParams.get('tab') : 'profile';
  const fileInputRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toastType, setToastType] = useState('success');
  const [profile, setProfile] = useState({ full_name: user?.full_name || '', username: user?.username || '', current_password: '' });
  const [savedProfile, setSavedProfile] = useState({ full_name: user?.full_name || '', username: user?.username || '' });
  const [preferences, setPreferences] = useState(readCachedPreferences);
  const [savedPreferences, setSavedPreferences] = useState(readCachedPreferences);
  const [loginHistory, setLoginHistory] = useState([]);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoLoadError, setPhotoLoadError] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [visiblePasswords, setVisiblePasswords] = useState({});
  const [securityBusy, setSecurityBusy] = useState(false);
  const [showRevokeModal, setShowRevokeModal] = useState(false);
  const [revokePassword, setRevokePassword] = useState('');
  const [toast, setToast] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const photoUrl = photoPreview || getProfilePhotoUrl(user?.profile_photo);
  const profileChanged = profile.full_name.trim() !== savedProfile.full_name || profile.username.trim() !== savedProfile.username;
  const preferencesChanged = !isSame(preferences, savedPreferences);
  const dirty = profileChanged || preferencesChanged;
  const hasUnsavedChanges = dirty || Boolean(photoFile);
  const passwordRequirements = useMemo(() => ({
    length: Array.from(passwords.next).length >= 18,
    uppercase: /[A-Z]/.test(passwords.next),
    number: /\d/.test(passwords.next),
    symbol: /[^A-Za-z0-9\s]/.test(passwords.next),
    bcryptLimit: new Blob([passwords.next]).size <= 72,
  }), [passwords.next]);
  const passwordScore = Object.values(passwordRequirements).filter(Boolean).length;
  const passwordStrength = !passwords.next ? '' : passwordScore <= 2 ? 'Weak' : passwordScore <= 3 ? 'Fair' : passwordScore <= 4 ? 'Good' : 'Strong';
  const showToast = (content, type = 'success') => {
    setToastType(type);
    setToast(content);
  };

  useEffect(() => {
    let active = true;
    const loadSettings = async () => {
      setLoading(true);
      try {
        const response = await api.get('/admin-settings/account');
        if (!response.data?.success) throw new Error(response.data?.message || 'Unable to load account settings.');
        if (!active) return;
        const nextPreferences = {
          ...DEFAULT_PREFERENCES,
          ...response.data.data.preferences,
          notifications: { ...DEFAULT_PREFERENCES.notifications, ...response.data.data.preferences?.notifications },
        };
        setPreferences(nextPreferences);
        setSavedPreferences(nextPreferences);
        localStorage.setItem('hs_preferences', JSON.stringify(nextPreferences));
        setLoginHistory(response.data.data.loginHistory || []);
      } catch (loadError) {
        if (active) setError(loadError.response?.data?.message || loadError.message || 'Unable to load account settings.');
      } finally {
        if (active) setLoading(false);
      }
    };
    loadSettings();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    applyPreferences(preferences);
    const systemTheme = window.matchMedia?.('(prefers-color-scheme: dark)');
    const updateSystemTheme = () => {
      if (preferences.theme === 'system') applyPreferences(preferences);
    };
    systemTheme?.addEventListener?.('change', updateSystemTheme);
    return () => systemTheme?.removeEventListener?.('change', updateSystemTheme);
  }, [preferences]);

  useEffect(() => {
    if (!photoPreview) return undefined;
    return () => URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const confirmInternalNavigation = (event) => {
      const link = event.target.closest?.('a[href]');
      if (!link || link.target === '_blank') return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin === window.location.origin && destination.pathname !== '/admin-settings') {
        if (!window.confirm('You have unsaved changes. Leave this page and discard them?')) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    document.addEventListener('click', confirmInternalNavigation, true);
    return () => {
      window.removeEventListener('beforeunload', warnBeforeUnload);
      document.removeEventListener('click', confirmInternalNavigation, true);
    };
  }, [hasUnsavedChanges]);

  const changeSection = (section) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', section);
    setSearchParams(next);
  };

  const updatePreference = (key, value) => {
    setPreferences((current) => ({ ...current, [key]: value }));
  };

  const updateNotification = (key, value) => {
    setPreferences((current) => ({
      ...current,
      notifications: { ...current.notifications, [key]: value },
    }));
  };

  const handlePhotoChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const validationError = validateProfilePhoto(file);
    if (validationError) {
      setPhotoError(validationError);
      setPhotoFile(null);
      setPhotoPreview('');
      event.target.value = '';
      return;
    }
    setPhotoError('');
    setPhotoLoadError(false);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handlePhotoUpload = async () => {
    if (!photoFile) return;
    setPhotoBusy(true);
    setPhotoError('');
    try {
      const formData = new FormData();
      formData.append('photo', photoFile);
      const response = await api.post('/admin-settings/profile-photo', formData);
      if (!response.data?.success || !response.data?.data?.profile_photo) {
        throw new Error(response.data?.message || 'Unable to save profile photo.');
      }
      updateUser(response.data.data);
      setPhotoFile(null);
      setPhotoPreview('');
      setPhotoLoadError(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      showToast('Profile photo saved.');
    } catch (uploadError) {
      const errorMessage = uploadError.response?.data?.message || uploadError.message || 'Unable to save profile photo.';
      setPhotoError(errorMessage);
      showToast(errorMessage, 'error');
    } finally {
      setPhotoBusy(false);
    }
  };

  const handlePhotoRemove = async () => {
    setPhotoBusy(true);
    setPhotoError('');
    try {
      const response = await api.delete('/admin-settings/profile-photo');
      if (!response.data?.success) throw new Error(response.data?.message || 'Unable to remove profile photo.');
      updateUser(response.data.data);
      setPhotoFile(null);
      setPhotoPreview('');
      setPhotoLoadError(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      showToast('Profile photo removed.');
    } catch (removeError) {
      const errorMessage = removeError.response?.data?.message || removeError.message || 'Unable to remove profile photo.';
      setPhotoError(errorMessage);
      showToast(errorMessage, 'error');
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleSaveChanges = async () => {
    setError('');
    setUsernameError('');
    if (profile.full_name.trim().length < 2) {
      setError('Full name must be at least 2 characters.');
      changeSection('profile');
      return;
    }
    if (profile.username.trim().length < 3) {
      setUsernameError('Username must be at least 3 characters.');
      changeSection('profile');
      return;
    }
    if (profile.username.trim() !== savedProfile.username && !profile.current_password) {
      setError('Enter your current password to change your username.');
      changeSection('profile');
      return;
    }
    setSaving(true);
    try {
      if (profileChanged) {
        const response = await api.put('/admin-settings', {
          full_name: profile.full_name.trim(),
          username: profile.username.trim(),
          ...(profile.username.trim() !== savedProfile.username ? { current_password: profile.current_password } : {}),
        });
        if (!response.data?.success) throw new Error(response.data?.message || 'Unable to save profile.');
        updateUser(response.data.data);
        const nextProfile = { full_name: profile.full_name.trim(), username: profile.username.trim() };
        setProfile({ ...nextProfile, current_password: '' });
        setSavedProfile(nextProfile);
      }
      if (preferencesChanged) {
        const response = await api.put('/admin-settings/preferences', { preferences });
        if (!response.data?.success) throw new Error(response.data?.message || 'Unable to save preferences.');
        const nextPreferences = response.data.data;
        setPreferences(nextPreferences);
        setSavedPreferences(nextPreferences);
        localStorage.setItem('hs_preferences', JSON.stringify(nextPreferences));
        window.dispatchEvent(new CustomEvent('healthsync:preferences-updated', { detail: nextPreferences }));
      }
      showToast('Settings saved.');
    } catch (saveError) {
      const serverMessage = saveError.response?.data?.message || saveError.message || 'Failed to save settings.';
      if (saveError.response?.status === 409) setUsernameError(serverMessage);
      else setError(serverMessage);
      showToast(serverMessage, 'error');
    } finally {
      setSaving(false);
    }
  };

  const discardChanges = () => {
    setProfile({ ...savedProfile, current_password: '' });
    setPreferences(savedPreferences);
    setPhotoFile(null);
    setPhotoPreview('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    setPhotoError('');
    setError('');
    setUsernameError('');
  };

  const handlePasswordChange = async (event) => {
    event.preventDefault();
    setError('');
    if (passwords.next !== passwords.confirm) {
      setError('The new password and confirmation do not match.');
      return;
    }
    if (passwordScore !== 5) {
      setError('Your new password does not meet all requirements.');
      return;
    }
    setSecurityBusy(true);
    try {
      const response = await api.post('/admin-settings/password', {
        current_password: passwords.current,
        new_password: passwords.next,
      });
      if (!response.data?.success) throw new Error(response.data?.message || 'Unable to update password.');
      logout({ skipServer: true });
      navigate('/login', { replace: true, state: { message: 'Password updated. Sign in with your new password.' } });
    } catch (passwordError) {
      const errorMessage = passwordError.response?.data?.message || passwordError.message || 'Unable to update password.';
      setError(errorMessage);
      showToast(errorMessage, 'error');
    } finally {
      setSecurityBusy(false);
    }
  };

  const handleRevokeSessions = async (event) => {
    event.preventDefault();
    setError('');
    setSecurityBusy(true);
    try {
      const response = await api.post('/admin-settings/sessions/revoke-all', { current_password: revokePassword });
      if (!response.data?.success) throw new Error(response.data?.message || 'Unable to sign out other devices.');
      logout({ skipServer: true });
      navigate('/login', { replace: true, state: { message: 'All devices have been signed out. Please sign in again.' } });
    } catch (revokeError) {
      const errorMessage = revokeError.response?.data?.message || revokeError.message || 'Unable to sign out other devices.';
      setError(errorMessage);
      showToast(errorMessage, 'error');
      setSecurityBusy(false);
    }
  };

  const togglePassword = (key) => setVisiblePasswords((current) => ({ ...current, [key]: !current[key] }));

  const renderPasswordInput = (key, label, value, onChange, autoComplete) => (
    <div className="settings-field">
      <label htmlFor={`settings-password-${key}`}>{label}</label>
      <div className="settings-password-input">
        <input
          id={`settings-password-${key}`}
          className="form-control"
          type={visiblePasswords[key] ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          onChange={(event) => onChange(event.target.value)}
          required
        />
        <button type="button" aria-label={`${visiblePasswords[key] ? 'Hide' : 'Show'} ${label.toLowerCase()}`} onClick={() => togglePassword(key)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" /><circle cx="12" cy="12" r="2.5" /></svg>
        </button>
      </div>
    </div>
  );

  const handleExport = async () => {
    setError('');
    try {
      const response = await api.get('/admin-settings/activity.csv', { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'healthsync-account-activity.csv';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (exportError) {
      const errorMessage = exportError.response?.data?.message || 'Unable to download account activity.';
      setError(errorMessage);
      showToast(errorMessage, 'error');
    }
  };

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <div><p className="settings-eyebrow">ACCOUNT</p><h1>Settings</h1><p>Manage your profile, security, and preferences.</p></div>
      </header>
      <div className="settings-layout">
        <div className="settings-sidebar">
          <nav className="settings-subnav" aria-label="Settings sections" role="tablist">
            {SECTIONS.map((section) => (
              <button key={section.id} type="button" role="tab" aria-selected={selectedSection === section.id} className={selectedSection === section.id ? 'active' : ''} onClick={() => changeSection(section.id)}>
                {section.label}
              </button>
            ))}
          </nav>
          {dirty && !loading && <div className="settings-save-bar" role="region" aria-label="Unsaved settings">
            <span>Unsaved changes</span><div><button type="button" className="settings-discard-button" onClick={discardChanges} disabled={saving}>Discard</button><button type="button" className="settings-primary-button" onClick={handleSaveChanges} disabled={saving}>{saving ? <><span className="settings-spinner" /> Saving…</> : 'Save changes'}</button></div>
          </div>}
        </div>
        <div className="settings-main">
          {error && <div className="settings-error" role="alert">{error}</div>}
          {loading ? (
            <div className="settings-loading" role="status" aria-label="Loading settings"><span /><span /><span /></div>
          ) : (
            <>
              {selectedSection === 'profile' && <>
                <SettingCard title="Profile photo" description="Choose a clear photo to help identify your account." className="settings-profile-photo-card">
                  <div className="settings-photo-row">
                    <div className="settings-photo-control">
                      <button type="button" className="settings-avatar-button" aria-label="Choose a profile photo" onClick={() => fileInputRef.current?.click()}>
                        {photoUrl && !photoLoadError ? <img src={photoUrl} alt="Profile preview" onError={() => { setPhotoLoadError(true); setPhotoError('The saved profile photo could not be loaded. Please upload it again.'); }} /> : <span aria-hidden="true">{(user?.full_name || user?.username || 'U').charAt(0).toUpperCase()}</span>}
                        <span className="settings-camera-badge" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7h3l1.5-2h7L17 7h3v12H4z" /><circle cx="12" cy="13" r="3" /></svg></span>
                      </button>
                      <input ref={fileInputRef} className="settings-file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoChange} disabled={photoBusy} aria-label="Choose profile photo" />
                      <span className="settings-field-hint">JPEG, PNG or WebP · up to 5 MB</span>
                    </div>
                    <div className="settings-photo-actions">
                      <button type="button" className="settings-primary-button" disabled={!photoFile || photoBusy} onClick={handlePhotoUpload}>{photoBusy ? 'Saving photo…' : 'Save photo'}</button>
                      {user?.profile_photo && <button type="button" className="settings-text-button" disabled={photoBusy} onClick={handlePhotoRemove}>Remove photo</button>}
                      {photoError && <p className="settings-inline-error" role="alert">{photoError}</p>}
                    </div>
                  </div>
                </SettingCard>
                <SettingCard title="Personal information" description="Keep your name and username up to date.">
                  <div className="settings-fields-grid">
                    <div className="settings-field"><label htmlFor="settings-full-name">Full name</label><input id="settings-full-name" className="form-control" value={profile.full_name} onChange={(event) => setProfile((current) => ({ ...current, full_name: event.target.value }))} required minLength={2} aria-describedby="settings-full-name-hint" /><span id="settings-full-name-hint" className="settings-field-hint">At least 2 characters.</span></div>
                    <div className="settings-field"><label htmlFor="settings-username">Username</label><input id="settings-username" className="form-control" value={profile.username} onChange={(event) => { setUsernameError(''); setProfile((current) => ({ ...current, username: event.target.value })); }} required minLength={3} aria-invalid={Boolean(usernameError)} aria-describedby={usernameError ? 'settings-username-error' : 'settings-username-hint'} />{usernameError ? <span id="settings-username-error" className="settings-inline-error">{usernameError}</span> : <span id="settings-username-hint" className="settings-field-hint">At least 3 characters. Availability is checked when saved.</span>}</div>
                  </div>
                  {profile.username.trim() !== savedProfile.username && <div className="settings-field settings-current-password-field"><label htmlFor="settings-current-password-profile">Current password (required to change username)</label><input id="settings-current-password-profile" className="form-control" type="password" autoComplete="current-password" value={profile.current_password} onChange={(event) => setProfile((current) => ({ ...current, current_password: event.target.value }))} /></div>}
                </SettingCard>
              </>}

              {selectedSection === 'appearance' && <>
                <SettingCard title="Theme" description="Choose how HealthSync looks on this device.">
                  <div className="settings-theme-options" role="radiogroup" aria-label="Color theme">
                    {['light', 'dark', 'system'].map((theme) => <button key={theme} type="button" role="radio" aria-checked={preferences.theme === theme} className={`settings-theme-option settings-theme-option--${theme} ${preferences.theme === theme ? 'selected' : ''}`} onClick={() => updatePreference('theme', theme)}>
                      <span className="settings-theme-preview"><i /><i /><i /></span><strong>{theme.charAt(0).toUpperCase() + theme.slice(1)}</strong>{theme === 'system' && <small>Follows your device</small>}
                    </button>)}
                  </div>
                </SettingCard>
                <SettingCard title="Text size" description="Adjust text size across the application.">
                  <div className="settings-size-options" role="radiogroup" aria-label="Text size">
                    {[['small', 'Small', '87.5%'], ['default', 'Default', '100%'], ['large', 'Large', '112.5%'], ['extra-large', 'Extra large', '125%']].map(([value, label, scale]) => <button key={value} type="button" role="radio" aria-checked={preferences.textSize === value} className={preferences.textSize === value ? 'selected' : ''} onClick={() => updatePreference('textSize', value)}><strong>{label}</strong><span>{scale}</span></button>)}
                  </div>
                  <div className="settings-live-preview"><span>LIVE PREVIEW</span><strong>Clear health records, healthier communities.</strong><p>Text size is applied immediately and saved with your other settings.</p></div>
                </SettingCard>
              </>}

              {selectedSection === 'security' && <>
                <SettingCard title="Change password" description="Use a strong, unique password to protect your account.">
                  <form className="settings-password-form" onSubmit={handlePasswordChange}>
                    {renderPasswordInput('current', 'Current password', passwords.current, (value) => setPasswords((current) => ({ ...current, current: value })), 'current-password')}
                    {renderPasswordInput('new', 'New password', passwords.next, (value) => setPasswords((current) => ({ ...current, next: value })), 'new-password')}
                    {passwords.next && <div className="settings-password-strength" aria-live="polite">
                      <div className="settings-strength-meter"><span className={`strength-${passwordScore}`} /></div>
                      <strong className={`strength-label-${passwordScore}`}>{passwordStrength}</strong>
                      <ul>{[['length', 'At least 18 characters'], ['uppercase', 'One uppercase letter'], ['number', 'One number'], ['symbol', 'One symbol'], ['bcryptLimit', 'No more than 72 UTF-8 bytes']].map(([key, text]) => <li key={key} className={passwordRequirements[key] ? 'met' : ''}>{text}</li>)}</ul>
                    </div>}
                    {renderPasswordInput('confirm', 'Confirm new password', passwords.confirm, (value) => setPasswords((current) => ({ ...current, confirm: value })), 'new-password')}
                    {passwords.confirm && passwords.next !== passwords.confirm && <p className="settings-inline-error" role="alert">Passwords do not match.</p>}
                    <button className="settings-primary-button" type="submit" disabled={securityBusy || !passwords.current || passwordScore !== 5 || passwords.next !== passwords.confirm}>{securityBusy ? 'Updating…' : 'Update password'}</button>
                  </form>
                </SettingCard>
                <SettingCard title="Recent sign-ins" description="Review recent account activity. Up to 20 entries are shown.">
                  {loginHistory.length ? <div className="settings-history-table-wrap"><table className="settings-history-table"><thead><tr><th>Date and time</th><th>Device</th><th>IP address</th><th>Status</th></tr></thead><tbody>{loginHistory.map((entry) => <tr key={entry.id}><td>{new Date(entry.occurred_at).toLocaleString()}</td><td>{userAgentLabel(entry.user_agent)}</td><td>{entry.ip_address || 'Unavailable'}</td><td><span className={`settings-status-badge ${entry.current ? 'current' : ''}`}>{entry.current ? 'Current session' : entry.status === 'ACTIVE' ? 'Active' : entry.status === 'FAILED' ? 'Failed' : entry.status === 'REVOKED' ? 'Signed out' : 'Ended'}</span></td></tr>)}</tbody></table></div> : <div className="settings-empty-state"><strong>No sign-in history yet</strong><span>Successful and failed sign-in activity will appear here.</span></div>}
                  <div className="settings-danger-zone"><div><strong>Log out of all devices</strong><span>This signs out every active device, including this one.</span></div><button type="button" className="settings-outline-danger" onClick={() => setShowRevokeModal(true)}>Log out all devices</button></div>
                </SettingCard>
              </>}

              {selectedSection === 'notifications' && <SettingCard title="In-app alerts" description="Choose which existing HealthSync activity can be surfaced as notifications.">
                <div className="settings-notification-group"><h4>Health alerts</h4>
                  <PreferenceSwitch id="settings-nutrition-alerts" checked={preferences.notifications.nutritionAlerts} onChange={(value) => updateNotification('nutritionAlerts', value)} title="Nutrition record updates" description="Updates when a nutrition assessment is recorded." />
                  <PreferenceSwitch id="settings-senior-alerts" checked={preferences.notifications.seniorFollowUpAlerts} onChange={(value) => updateNotification('seniorFollowUpAlerts', value)} title="Senior registry updates" description="Updates when a senior citizen is registered." />
                </div>
                <div className="settings-notification-group"><h4>System</h4>
                  <PreferenceSwitch id="settings-sync-alerts" checked={preferences.notifications.offlineSyncAlerts} onChange={(value) => updateNotification('offlineSyncAlerts', value)} title="Offline and sync status" description="Alerts when changes are queued offline or synchronization needs attention." />
                  <PreferenceSwitch id="settings-resident-alerts" checked={preferences.notifications.newResidentAlerts} onChange={(value) => updateNotification('newResidentAlerts', value)} title="New resident registrations" description="Updates when a new resident record is added." />
                </div>
                <div className="settings-info-note">Notifications appear in the in-app bell and are stored on this device. Push and email notifications are not enabled.</div>
              </SettingCard>}

              {selectedSection === 'privacy' && <>
                <SettingCard title="Your privacy" description="How HealthSync protects information entrusted to the barangay.">
                  <div className="settings-privacy-copy"><h4>Data Privacy Act of 2012 (Republic Act No. 10173)</h4><p>HealthSync is used to support authorized barangay health services. Account activity is recorded for security and accountability. Resident health information should be accessed only for legitimate care and administrative duties, and handled according to applicable privacy requirements and your organization’s data-retention policies.</p><p>Resident health data is accessible only to authorized barangay health workers and other users with assigned access.</p></div>
                </SettingCard>
                <SettingCard title="Account activity" description="Download a copy of your recent sign-in history.">
                  <p className="settings-card-copy">The CSV includes sign-in timestamps, device/browser information, IP addresses, and session status.</p>
                  <button type="button" className="settings-secondary-button" onClick={handleExport}>Download my account activity (CSV)</button>
                </SettingCard>
              </>}
            </>
          )}
        </div>
      </div>

      {toast && <div className={`settings-toast ${toastType === 'error' ? 'is-error' : ''}`} role={toastType === 'error' ? 'alert' : 'status'}>{toast}</div>}

      {showRevokeModal && <div className="settings-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowRevokeModal(false); }}>
        <section className="settings-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="settings-revoke-title">
          <h2 id="settings-revoke-title">Log out of all devices?</h2><p>This will revoke every active session, including your current session. You will need to sign in again.</p>
          <form onSubmit={handleRevokeSessions}><div className="settings-field"><label htmlFor="settings-revoke-password">Confirm with your current password</label><input id="settings-revoke-password" className="form-control" type="password" autoComplete="current-password" value={revokePassword} onChange={(event) => setRevokePassword(event.target.value)} required /></div>
            <div className="settings-modal-actions"><button type="button" className="settings-secondary-button" onClick={() => { setShowRevokeModal(false); setRevokePassword(''); }}>Cancel</button><button type="submit" className="settings-danger-button" disabled={securityBusy || !revokePassword}>{securityBusy ? 'Signing out…' : 'Log out all devices'}</button></div>
          </form>
        </section>
      </div>}
    </div>
  );
};

export default AdminSettingsPage;
