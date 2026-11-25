import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import { DEFAULT_PREFERENCES, persistPreferences, useTheme } from '../../context/ThemeContext';
import api from '../../services/api/apiClient';
import { getProfilePhotoUrl, validateProfilePhoto } from '../../utils/profilePhoto';
import { formatRelativeTime } from '../../utils/dateUtils';
import {
  changeOfflineVaultCredential,
  createOfflineVault,
  getOfflineVaultMetadata,
  isOfflineVaultUnlocked,
  unlockOfflineVault,
} from '../../services/offline/offlineVaultService';
import { createOfflineSession } from '../../services/offline/offlineSessionService';
import PinDigitInput from '../../components/common/PinDigitInput';
import PageBanner from '../../components/common/PageBanner';
import { getFriendlyError } from '../../utils/apiErrorMessages';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  AtSign,
  Bell,
  Camera,
  Check,
  CheckCircle2,
  Database,
  Download,
  Eye,
  EyeOff,
  FileDown,
  Home,
  KeyRound,
  Loader2,
  LockKeyhole,
  LogOut,
  Mail,
  Monitor,
  Moon,
  Palette,
  Phone,
  RotateCcw,
  Save,
  Settings,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
  Upload,
  UserRound,
} from 'lucide-react';

const SECTIONS = [
  { id: 'profile', label: 'Profile', Icon: UserRound },
  { id: 'appearance', label: 'Appearance', Icon: Palette },
  { id: 'security', label: 'Security', Icon: ShieldCheck },
  { id: 'notifications', label: 'Notifications', Icon: Bell },
  { id: 'privacy', label: 'Data & Privacy', Icon: LockKeyhole },
];

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

const isSame = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const isValidContactNumber = (value) => {
  const phone = value.trim();
  if (!phone) return true;
  const digits = phone.replace(/\D/g, '');
  return phone.length <= 32 && /^\+?[0-9][0-9\s().-]*$/.test(phone) && digits.length >= 7 && digits.length <= 15;
};
const isValidEmail = (value) => {
  const email = value.trim();
  return !email || (email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
};

const SettingCard = ({ title, description, icon: Icon = Settings, children, className = '' }) => (
  <section className={`hs-settings-card ${className}`}>
    <header className="hs-settings-card-heading">
      <span className="hs-settings-icon-tile" aria-hidden="true"><Icon size={19} strokeWidth={1.8} /></span>
      <div className="hs-settings-card-copy">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </header>
    {children}
  </section>
);

const PreferenceSwitch = ({ id, checked, onChange, title, description, icon: Icon = Bell }) => (
  <label className="hs-settings-switch-row" htmlFor={id}>
    <span className="hs-settings-row-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.8} /></span>
    <span className="hs-settings-switch-copy"><strong>{title}</strong><span>{description}</span></span>
    <input
      id={id}
      className="hs-settings-switch"
      type="checkbox"
      role="switch"
      aria-checked={checked}
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  </label>
);

const SettingsAlert = ({ children, type = 'error', retry, retrying = false }) => {
  const Icon = type === 'warning' ? AlertTriangle : AlertCircle;
  return (
    <div className={`hs-settings-alert hs-settings-alert--${type}`} role={retry ? 'alert' : 'status'}>
      <Icon size={19} aria-hidden="true" />
      <p>{children}</p>
      {retry && <button type="button" className="hs-settings-secondary-button" onClick={retry} disabled={retrying}>
        {retrying ? <><Loader2 size={16} className="hs-settings-spin" /> Retrying…</> : 'Retry'}
      </button>}
    </div>
  );
};

const DiscardDialog = ({ open, onCancel, onDiscard }) => {
  const dialogRef = useRef(null);
  const keepEditingRef = useRef(null);
  const previousFocusRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    keepEditingRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialogRef.current?.querySelectorAll('button:not(:disabled)') || []);
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus();
    };
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div className="hs-settings-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <section ref={dialogRef} className="hs-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-discard-title" aria-describedby="settings-discard-description">
        <span className="hs-settings-dialog-icon" aria-hidden="true"><AlertTriangle size={20} /></span>
        <h2 id="settings-discard-title">Discard changes?</h2>
        <p id="settings-discard-description">Your unsaved changes will be lost.</p>
        <div className="hs-settings-dialog-actions">
          <button ref={keepEditingRef} type="button" className="hs-settings-secondary-button" onClick={onCancel}>Keep editing</button>
          <button type="button" className="hs-settings-danger-button" onClick={onDiscard}>Discard</button>
        </div>
      </section>
    </div>
  );
};

const AccessibleDialog = ({ open, onClose, labelledBy, children, className = '' }) => {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll(
      'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
    ) || []);
    focusable()[0]?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      }
      if (event.key !== 'Tab') return;
      const controls = focusable();
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="hs-settings-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCloseRef.current();
    }}>
      <section ref={dialogRef} className={`hs-settings-dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {children}
      </section>
    </div>
  );
};

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
  const { user, updateUser, logout, unlockOfflineAccess } = useContext(AuthContext);
  const { applyPreferences } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedSection = SECTIONS.some(({ id }) => id === searchParams.get('tab'))
    ? searchParams.get('tab') : 'profile';
  const fileInputRef = useRef(null);
  const tabsRef = useRef(null);
  const previousSectionRef = useRef(selectedSection);
  const allowTabNavigationRef = useRef(false);
  const locationRef = useRef(location);
  const profileFieldRefs = useRef({});
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toastType, setToastType] = useState('success');
  const [profile, setProfile] = useState({
    full_name: user?.full_name || '',
    username: user?.username || '',
    contact_number: user?.contact_number || '',
    email: user?.email || '',
    current_password: '',
  });
  const [savedProfile, setSavedProfile] = useState({
    full_name: user?.full_name || '',
    username: user?.username || '',
    contact_number: user?.contact_number || '',
    email: user?.email || '',
  });
  const [preferences, setPreferences] = useState(readCachedPreferences);
  const [savedPreferences, setSavedPreferences] = useState(readCachedPreferences);
  const [loginHistory, setLoginHistory] = useState([]);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoLoadError, setPhotoLoadError] = useState(false);
  const [photoDragActive, setPhotoDragActive] = useState(false);
  const [headerPhotoError, setHeaderPhotoError] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [visiblePasswords, setVisiblePasswords] = useState({});
  const [securityBusy, setSecurityBusy] = useState(false);
  const [pinForm, setPinForm] = useState({ currentPassword: '', pin: '', confirm: '' });
  const [pinPasswordStep, setPinPasswordStep] = useState(false);
  const pinPasswordInputRef = useRef(null);
  const pinInputRef = useRef(null);
  const pinConfirmInputRef = useRef(null);
  const [pinMessage, setPinMessage] = useState('');
  const hasAccountPin = Boolean(user?.offline_account_pin_enrolled);
  const hasDevicePin = Boolean(user?.offline_pin_enrolled);
  const pinAction = !hasAccountPin
    ? hasDevicePin ? 'promote' : 'set-account'
    : hasDevicePin ? 'change-account' : 'enroll-device';
  const pinTitle = {
    promote: 'Make this your shared account PIN',
    'set-account': 'Set up shared account PIN',
    'change-account': 'Change shared account PIN',
    'enroll-device': 'Use account PIN on this device',
  }[pinAction];
  const pinDescription = {
    promote: 'Use the PIN already protecting this device’s offline data as the shared PIN for your account.',
    'set-account': 'Set one PIN for your account. Use the same PIN on your other approved devices.',
    'change-account': 'Changing this PIN affects the whole account. Devices with a different old PIN must be enrolled again while online.',
    'enroll-device': 'Enter your existing account PIN to prepare this device’s local offline vault. Do not create a different PIN.',
  }[pinAction];
  const [authorizedDevices, setAuthorizedDevices] = useState([]);
  const [devicesError, setDevicesError] = useState('');
  const [devicePassword, setDevicePassword] = useState('');
  const [showRevokeModal, setShowRevokeModal] = useState(false);
  const [deviceToRevoke, setDeviceToRevoke] = useState(null);
  const [revokePassword, setRevokePassword] = useState('');
  const [discardAction, setDiscardAction] = useState(null);
  const [toast, setToast] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [profileErrors, setProfileErrors] = useState({});
  const photoUrl = photoPreview || getProfilePhotoUrl(user?.profile_photo);
  const profileChanged = profile.full_name.trim() !== savedProfile.full_name
    || profile.username.trim() !== savedProfile.username
    || profile.contact_number.trim() !== savedProfile.contact_number
    || profile.email.trim().toLowerCase() !== savedProfile.email.trim().toLowerCase();
  const appearanceChanged = preferences.theme !== savedPreferences.theme || preferences.textSize !== savedPreferences.textSize;
  const notificationsChanged = !isSame(preferences.notifications, savedPreferences.notifications);
  const preferencesChanged = !isSame(preferences, savedPreferences);
  const securityChanged = Boolean(
    passwords.current || passwords.next || passwords.confirm
    || pinForm.currentPassword || pinForm.pin || pinForm.confirm || pinPasswordStep
    || devicePassword || revokePassword
  );
  const dirtyBySection = useMemo(() => ({
    profile: profileChanged || Boolean(photoFile),
    appearance: appearanceChanged,
    security: securityChanged,
    notifications: notificationsChanged,
    privacy: false,
  }), [appearanceChanged, notificationsChanged, photoFile, profileChanged, securityChanged]);
  const activeSectionDirty = Boolean(dirtyBySection[selectedSection]);
  const hasUnsavedChanges = Object.values(dirtyBySection).some(Boolean);
  const showSaveBar = !loading && (
    selectedSection === 'profile' ? dirtyBySection.profile
      : selectedSection === 'appearance' ? appearanceChanged
        : selectedSection === 'notifications' ? notificationsChanged : false
  );
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
    setLoading(true);
    setLoadError(null);
    const loadSettings = async () => {
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
        const accountProfile = response.data.data.profile || {};
        const nextProfile = {
          full_name: accountProfile.full_name || '',
          username: accountProfile.username || '',
          contact_number: accountProfile.contact_number || '',
          email: accountProfile.email || '',
        };
        setProfile({ ...nextProfile, current_password: '' });
        setSavedProfile(nextProfile);
        persistPreferences(nextPreferences);
        setLoginHistory(response.data.data.loginHistory || []);
      } catch (loadError) {
        console.error('Unable to load account settings.', loadError);
        if (active) setLoadError(loadError);
      } finally {
        if (active) setLoading(false);
      }
    };
    loadSettings();
    return () => { active = false; };
  }, [loadAttempt]);

  useEffect(() => {
    applyPreferences(preferences);
  }, [applyPreferences, preferences]);

  useEffect(() => {
    const handleThemePreference = (event) => {
      const theme = event.detail?.theme;
      if (!['light', 'dark', 'system'].includes(theme)) return;
      setPreferences((current) => current.theme === theme ? current : { ...current, theme });
    };
    window.addEventListener('healthsync:preferences-updated', handleThemePreference);
    return () => window.removeEventListener('healthsync:preferences-updated', handleThemePreference);
  }, []);

  useEffect(() => {
    if (!photoPreview) return undefined;
    return () => URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  useEffect(() => {
    if (pinPasswordStep) pinPasswordInputRef.current?.focus();
  }, [pinPasswordStep]);

  useEffect(() => {
    if (selectedSection !== 'security') return undefined;
    let active = true;
    api.get('/auth/devices')
      .then((response) => {
        if (!response.data?.success) throw new Error(response.data?.message || 'Unable to load authorized devices.');
        if (active) setAuthorizedDevices(response.data.data || []);
      })
      .catch((error) => {
        console.error('Unable to load authorized devices.', error);
        if (active) setDevicesError(error);
      });
    return () => { active = false; };
  }, [selectedSection]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    const activeTab = tabsRef.current?.querySelector('[role="tab"][aria-selected="true"]');
    activeTab?.scrollIntoView?.({
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [selectedSection]);

  useEffect(() => {
    if (previousSectionRef.current === selectedSection) return;
    const previousSection = previousSectionRef.current;
    if (allowTabNavigationRef.current) {
      allowTabNavigationRef.current = false;
      previousSectionRef.current = selectedSection;
      return;
    }
    if (dirtyBySection[previousSection] && !discardAction) {
      const currentLocation = locationRef.current;
      const next = new URLSearchParams(currentLocation.search);
      next.set('tab', previousSection);
      setSearchParams(next, { replace: true });
      setDiscardAction({ type: 'tab', section: previousSection, destinationTab: selectedSection });
      return;
    }
    previousSectionRef.current = selectedSection;
  }, [discardAction, dirtyBySection, selectedSection, setSearchParams]);

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const confirmInternalNavigation = (event) => {
      const link = event.target.closest?.('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download')
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.pathname === '/admin-settings') return;
      event.preventDefault();
      event.stopPropagation();
      setDiscardAction({
        type: 'navigation',
        destination: `${destination.pathname}${destination.search}${destination.hash}`,
      });
    };
    const confirmHistoryNavigation = () => {
      const source = locationRef.current;
      if (source.pathname !== '/admin-settings') return;
      const destination = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const sourceUrl = `${source.pathname}${source.search}${source.hash}`;
      if (destination === sourceUrl) return;
      const destinationUrl = new URL(destination, window.location.origin);
      const destinationTab = destinationUrl.pathname === '/admin-settings'
        ? destinationUrl.searchParams.get('tab') : null;
      if (destinationTab && destinationTab !== selectedSection && dirtyBySection[selectedSection]) {
        setDiscardAction({ type: 'tab', section: selectedSection, destinationTab });
      } else if (destinationUrl.pathname !== '/admin-settings') {
        setDiscardAction({ type: 'navigation', destination });
      } else {
        return;
      }
      navigate(sourceUrl, { replace: true });
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    document.addEventListener('click', confirmInternalNavigation, true);
    window.addEventListener('popstate', confirmHistoryNavigation, true);
    return () => {
      window.removeEventListener('beforeunload', warnBeforeUnload);
      document.removeEventListener('click', confirmInternalNavigation, true);
      window.removeEventListener('popstate', confirmHistoryNavigation, true);
    };
  }, [dirtyBySection, hasUnsavedChanges, navigate, selectedSection]);

  const changeSection = (section) => {
    if (section === selectedSection) return;
    if (activeSectionDirty) {
      setDiscardAction({ type: 'tab', section: selectedSection, destinationTab: section });
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set('tab', section);
    allowTabNavigationRef.current = true;
    setSearchParams(next);
  };

  const handleTabKeyDown = (event, index) => {
    let targetIndex = index;
    if (event.key === 'ArrowRight') targetIndex = (index + 1) % SECTIONS.length;
    else if (event.key === 'ArrowLeft') targetIndex = (index - 1 + SECTIONS.length) % SECTIONS.length;
    else if (event.key === 'Home') targetIndex = 0;
    else if (event.key === 'End') targetIndex = SECTIONS.length - 1;
    else return;
    event.preventDefault();
    const target = SECTIONS[targetIndex];
    tabsRef.current?.querySelector(`#settings-tab-${target.id}`)?.focus();
    changeSection(target.id);
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

  const handlePhotoFile = (file, input) => {
    if (!file) return;
    const validationError = validateProfilePhoto(file);
    if (validationError) {
      setPhotoError(validationError);
      setPhotoFile(null);
      setPhotoPreview('');
      if (input) input.value = '';
      return;
    }
    setPhotoError('');
    setPhotoLoadError(false);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handlePhotoChange = (event) => handlePhotoFile(event.target.files?.[0], event.target);

  const handlePhotoUpload = async ({ notify = true } = {}) => {
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
      if (notify) showToast('Profile photo saved.');
      return true;
    } catch (uploadError) {
      setPhotoError(uploadError);
      if (notify) showToast(getFriendlyError(uploadError), 'error');
      return false;
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
      setPhotoError(removeError);
      showToast(getFriendlyError(removeError), 'error');
    } finally {
      setPhotoBusy(false);
    }
  };

  const focusProfileField = (field) => {
    window.requestAnimationFrame(() => profileFieldRefs.current[field]?.focus());
  };

  const handleSaveChanges = async (section = selectedSection) => {
    setError('');
    setUsernameError('');
    setProfileErrors({});
    const fieldErrors = {};
    if (section === 'profile') {
      if (profile.full_name.trim().length < 2) {
        const message = 'Full name must be at least 2 characters.';
        setProfileErrors({ full_name: message });
        setError(message);
        focusProfileField('full_name');
        return;
      }
      if (profile.username.trim().length < 3) {
        const message = 'Username must be at least 3 characters.';
        setUsernameError(message);
        setError(message);
        focusProfileField('username');
        return;
      }
      if (!isValidContactNumber(profile.contact_number)) fieldErrors.contact_number = 'Enter a valid contact number.';
      if (!isValidEmail(profile.email)) fieldErrors.email = 'Enter a valid email address.';
      if (Object.keys(fieldErrors).length) {
        setProfileErrors(fieldErrors);
        focusProfileField(Object.keys(fieldErrors)[0]);
        return;
      }
      if (profile.username.trim() !== savedProfile.username && !profile.current_password) {
        const message = 'Enter your current password to change your username.';
        setError(message);
        focusProfileField('current_password');
        return;
      }
    }
    setSaving(true);
    try {
      if (section === 'profile' && profileChanged) {
        const response = await api.put('/admin-settings', {
          full_name: profile.full_name.trim(),
          username: profile.username.trim(),
          contact_number: profile.contact_number.trim(),
          email: profile.email.trim(),
          ...(profile.username.trim() !== savedProfile.username ? { current_password: profile.current_password } : {}),
        });
        if (!response.data?.success) throw new Error(response.data?.message || 'Unable to save profile.');
        updateUser(response.data.data);
        const nextProfile = {
          full_name: profile.full_name.trim(),
          username: profile.username.trim(),
          contact_number: response.data.data.contact_number || '',
          email: response.data.data.email || '',
        };
        setProfile({ ...nextProfile, current_password: '' });
        setSavedProfile(nextProfile);
      }
      if (section === 'profile' && photoFile) {
        const photoSaved = await handlePhotoUpload({ notify: false });
        if (!photoSaved) throw new Error('Unable to save profile photo.');
      }
      if ((section === 'appearance' || section === 'notifications') && preferencesChanged) {
        const response = await api.put('/admin-settings/preferences', { preferences });
        if (!response.data?.success) throw new Error(response.data?.message || 'Unable to save preferences.');
        const nextPreferences = response.data.data;
        setPreferences(nextPreferences);
        setSavedPreferences(nextPreferences);
        persistPreferences(nextPreferences);
        window.dispatchEvent(new CustomEvent('healthsync:preferences-updated', { detail: nextPreferences }));
      }
      showToast('Settings saved.');
    } catch (saveError) {
      const serverMessage = saveError.response?.data?.message || saveError.message || 'Failed to save settings.';
      const responseFieldErrors = saveError.response?.data?.fieldErrors;
      if (responseFieldErrors) {
        setProfileErrors(responseFieldErrors);
        if (responseFieldErrors.username) setUsernameError(responseFieldErrors.username);
        focusProfileField(Object.keys(responseFieldErrors)[0]);
      }
      if (saveError.response?.status === 409) {
        setUsernameError(serverMessage);
        focusProfileField('username');
      }
      else setError(saveError);
      showToast(getFriendlyError(saveError), 'error');
    } finally {
      setSaving(false);
    }
  };

  const discardChanges = (section) => {
    if (!section || section === 'profile') {
      setProfile({ ...savedProfile, current_password: '' });
      setPhotoFile(null);
      setPhotoPreview('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setPhotoError('');
      setUsernameError('');
      setProfileErrors({});
    }
    if (!section || section === 'appearance') {
      setPreferences((current) => ({ ...current, theme: savedPreferences.theme, textSize: savedPreferences.textSize }));
    }
    if (!section || section === 'notifications') {
      setPreferences((current) => ({ ...current, notifications: savedPreferences.notifications }));
    }
    if (!section || section === 'security') {
      setPasswords({ current: '', next: '', confirm: '' });
      setPinForm({ currentPassword: '', pin: '', confirm: '' });
      setPinPasswordStep(false);
      setPinMessage('');
      pinInputRef.current?.clear();
      pinConfirmInputRef.current?.clear();
      setDevicePassword('');
      setRevokePassword('');
    }
    setError('');
  };

  const cancelDiscard = () => setDiscardAction(null);

  const confirmDiscard = () => {
    if (!discardAction) return;
    const action = discardAction;
    setDiscardAction(null);
    discardChanges(action.type === 'tab' ? action.section : undefined);
    if (action.type === 'tab') {
      const next = new URLSearchParams(searchParams);
      next.set('tab', action.destinationTab);
      allowTabNavigationRef.current = true;
      setSearchParams(next);
    } else {
      navigate(action.destination);
    }
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
      let offlineWarning = false;
      try {
        const ownerId = user?.user_id;
        const metadata = ownerId === undefined ? null : await getOfflineVaultMetadata(ownerId);
        if (metadata?.credentialType !== 'pin' && metadata) {
          createOfflineSession({ userId: ownerId, role: user.role, deviceId: user.device_id });
          if (!isOfflineVaultUnlocked(ownerId)) {
            await unlockOfflineVault({ userId: ownerId, credential: passwords.current });
          }
          await changeOfflineVaultCredential({
            userId: ownerId,
            credential: passwords.next,
            credentialType: 'password',
          });
        }
      } catch {
        offlineWarning = true;
      }
      await logout({ skipServer: true });
      navigate('/login', {
        replace: true,
        state: {
          message: offlineWarning
            ? 'Password updated. Encrypted offline data could not be updated and remains on this device.'
            : 'Password updated. Sign in with your new password.',
        },
      });
    } catch (passwordError) {
      setError(passwordError);
      showToast(getFriendlyError(passwordError), 'error');
    } finally {
      setSecurityBusy(false);
    }
  };

  const handlePinSave = async (event) => {
    event.preventDefault();
    setError('');
    setPinMessage('');
    if (!navigator.onLine) {
      setError('Connect to the internet to verify your account password and save a PIN.');
      return;
    }
    if (!/^\d{6}$/.test(pinForm.pin)) {
      setError('PIN must contain exactly six digits.');
      return;
    }
    if (pinForm.pin !== pinForm.confirm) {
      setError('PIN entries do not match.');
      return;
    }
    if (!hasDevicePin && !pinPasswordStep) {
      setPinPasswordStep(true);
      return;
    }
    if (!pinForm.currentPassword) {
      setError('Enter your account password to save this PIN.');
      return;
    }
    setSecurityBusy(true);
    try {
      const scope = pinAction === 'enroll-device' ? 'device' : 'account';
      const verificationScope = pinAction === 'promote' ? 'promote' : scope;
      const verified = await api.post('/auth/offline-pin/verify', {
        current_password: pinForm.currentPassword,
        pin: pinForm.pin,
        scope: verificationScope,
      });
      if (!verified.data?.success) throw new Error(verified.data?.message || 'PIN verification failed.');

      const ownerId = user?.user_id;
      if (ownerId === undefined || ownerId === null || !user?.device_id) {
        throw new Error('An authorized device is required to set up an offline PIN.');
      }
      const metadata = await getOfflineVaultMetadata(ownerId);
      if (metadata) {
        if (!isOfflineVaultUnlocked(ownerId)) {
          if (metadata.credentialType === 'pin' && metadata.hasOnlinePasswordWrapper) {
            await unlockOfflineVault({
              userId: ownerId,
              credential: pinForm.currentPassword,
              credentialType: 'online-password',
            });
          } else {
            await unlockOfflineVault({ userId: ownerId, credential: pinForm.currentPassword });
          }
        }
        await changeOfflineVaultCredential({ userId: ownerId, credential: pinForm.pin, credentialType: 'pin' });
      } else {
        await createOfflineVault({
          userId: ownerId,
          role: user.role,
          credential: pinForm.pin,
          credentialType: 'pin',
          onlinePassword: pinForm.currentPassword,
        });
      }
      const saved = await api.post('/auth/offline-pin', {
        current_password: pinForm.currentPassword,
        pin: pinForm.pin,
        scope,
      });
      if (!saved.data?.success) throw new Error(saved.data?.message || 'Unable to save PIN.');
      createOfflineSession({ userId: ownerId, role: user.role, deviceId: user.device_id });
      await unlockOfflineAccess(pinForm.pin, metadata ? pinForm.currentPassword : undefined);
      updateUser({
        ...user,
        offline_pin_enrolled: true,
        offline_account_pin_enrolled: true,
        offline_pin_setup_required: false,
      });
      setPinForm({ currentPassword: '', pin: '', confirm: '' });
      pinInputRef.current?.clear();
      pinConfirmInputRef.current?.clear();
      setPinPasswordStep(false);
      setPinMessage(pinAction === 'enroll-device'
        ? 'This device now uses your shared account PIN.'
        : pinAction === 'promote'
          ? 'Your current device PIN is now the shared account PIN.'
          : pinAction === 'change-account'
            ? 'The shared account PIN was changed.'
            : 'Your shared account PIN was set up.');
    } catch (pinError) {
      if (!hasDevicePin) {
        setPinMessage('PIN enrollment did not finish. You can retry without losing queued offline changes.');
      }
      setError(pinError);
      showToast(getFriendlyError(pinError), 'error');
    } finally {
      setSecurityBusy(false);
    }
  };

  const handleDeviceRevoke = async (device) => {
    setDevicesError('');
    if (!devicePassword) {
      setDevicesError('Enter your current account password to revoke a device.');
      return;
    }
    setSecurityBusy(true);
    try {
      const response = await api.post(`/auth/devices/${encodeURIComponent(device.device_id)}/revoke`, {
        current_password: devicePassword,
      });
      if (!response.data?.success) throw new Error(response.data?.message || 'Unable to revoke device.');
      if (device.device_id === user?.device_id) {
        await logout({ skipServer: true });
        navigate('/login', { replace: true, state: { message: 'This device was revoked and signed out.' } });
        return;
      }
      const refreshed = await api.get('/auth/devices');
      if (!refreshed.data?.success) throw new Error(refreshed.data?.message || 'Device revoked but the list could not be refreshed.');
      setAuthorizedDevices(refreshed.data.data || []);
      setDevicePassword('');
      showToast('Device authorization revoked.');
    } catch (revokeError) {
      setDevicesError(revokeError);
      showToast(getFriendlyError(revokeError), 'error');
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
      setError(revokeError);
      showToast(getFriendlyError(revokeError), 'error');
      setSecurityBusy(false);
    }
  };

  const togglePassword = (key) => setVisiblePasswords((current) => ({ ...current, [key]: !current[key] }));

  const renderPasswordInput = (key, label, value, onChange, autoComplete) => (
    <div className="hs-settings-field">
      <label htmlFor={`settings-password-${key}`}>{label}</label>
      <div className="settings-password-input hs-settings-password-input">
        <input
          id={`settings-password-${key}`}
          className="hs-settings-control"
          type={visiblePasswords[key] ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          onChange={(event) => onChange(event.target.value)}
          required
        />
        <button className="hs-settings-password-toggle" type="button" aria-label={`${visiblePasswords[key] ? 'Hide' : 'Show'} ${label.toLowerCase()}`} onClick={() => togglePassword(key)}>
          {visiblePasswords[key] ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
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
      setError(exportError);
      showToast(getFriendlyError(exportError), 'error');
    }
  };

  return (
    <div className={`hs-settings-page${showSaveBar ? ' has-save-bar' : ''}`}>
      <nav className="hs-settings-breadcrumb" aria-label="Breadcrumb">
        <Link to="/"><Home size={14} aria-hidden="true" /> Home</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Settings</span>
      </nav>
      <PageBanner
        icon={Settings}
        title="Settings"
        subtitle="Manage your profile, security, and preferences."
        eyebrow="ACCOUNT"
        className="hs-settings-banner"
        actions={<div className="hs-settings-account-chip">
          {user?.profile_photo && !headerPhotoError
            ? <img src={getProfilePhotoUrl(user.profile_photo)} alt="" onError={() => setHeaderPhotoError(true)} />
            : <span className="hs-settings-account-avatar" aria-hidden="true">{(user?.full_name || user?.username || 'U').charAt(0).toUpperCase()}</span>}
          <span><strong>{user?.full_name || user?.username}</strong><small>{user?.role}</small></span>
        </div>}
      />

      <div className="hs-settings-tabs-wrap">
        <nav ref={tabsRef} className="hs-settings-tabs" aria-label="Settings sections" role="tablist">
          {SECTIONS.map(({ id, label, Icon }, index) => (
            <button
              key={id}
              id={`settings-tab-${id}`}
              className={`hs-settings-tab${selectedSection === id ? ' is-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={selectedSection === id}
              aria-controls={`settings-panel-${id}`}
              tabIndex={selectedSection === id ? 0 : -1}
              onClick={() => changeSection(id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="hs-settings-panels" aria-live="polite">
        {SECTIONS.map(({ id }) => (
          <div
            key={id}
            id={`settings-panel-${id}`}
            className="hs-settings-panel"
            role="tabpanel"
            aria-labelledby={`settings-tab-${id}`}
            tabIndex={0}
            hidden={selectedSection !== id}
          >
            {selectedSection === id && (loading ? (
              <div className="hs-settings-skeleton-stack" role="status" aria-label="Loading settings">
                <span className="hs-settings-skeleton-card" />
                <span className="hs-settings-skeleton-card" />
              </div>
            ) : loadError ? (
              <SettingCard title="Settings couldn’t be loaded" description="Your saved profile and preferences could not be retrieved." icon={AlertTriangle}>
                <SettingsAlert retry={() => setLoadAttempt((attempt) => attempt + 1)}>
                  {getFriendlyError(loadError)}
                </SettingsAlert>
              </SettingCard>
            ) : (
              <>
                {error && <SettingsAlert>{typeof error === 'string' ? error : getFriendlyError(error)}</SettingsAlert>}

                {selectedSection === 'profile' && <>
                  <SettingCard title="Profile photo" description="Choose a clear photo to help identify your account." icon={Camera} className="hs-settings-profile-photo-card">
                    <div
                      className={`hs-settings-photo-uploader${photoDragActive ? ' is-drag-active' : ''}`}
                      onDragEnter={(event) => { event.preventDefault(); setPhotoDragActive(true); }}
                      onDragOver={(event) => { event.preventDefault(); setPhotoDragActive(true); }}
                      onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget)) setPhotoDragActive(false);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        setPhotoDragActive(false);
                        handlePhotoFile(event.dataTransfer.files?.[0]);
                      }}
                    >
                      <div className="hs-settings-photo-preview">
                        <button
                          type="button"
                          className="hs-settings-avatar-button"
                          aria-label="Choose a profile photo"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={photoBusy}
                        >
                          {photoUrl && !photoLoadError
                            ? <img src={photoUrl} alt="" onError={() => {
                              setPhotoLoadError(true);
                              setPhotoError('The saved profile photo could not be loaded. Please upload it again.');
                            }} />
                            : <span aria-hidden="true">{(user?.full_name || user?.username || 'U').charAt(0).toUpperCase()}</span>}
                          <span className="hs-settings-camera-badge" aria-hidden="true"><Camera size={15} /></span>
                        </button>
                        {photoDragActive && <span className="hs-settings-drop-hint">Drop photo to upload</span>}
                      </div>
                      <input
                        ref={fileInputRef}
                        className="hs-settings-file-input"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={handlePhotoChange}
                        disabled={photoBusy}
                        aria-label="Choose profile photo"
                      />
                      <div className="hs-settings-photo-copy">
                        <strong>Profile photo</strong>
                        <p>JPEG, PNG or WebP, up to 5 MB</p>
                        <div className="hs-settings-photo-actions">
                          <button type="button" className="hs-settings-secondary-button" onClick={() => fileInputRef.current?.click()} disabled={photoBusy}>
                            <Upload size={16} aria-hidden="true" /> Upload photo
                          </button>
                          {user?.profile_photo && <button type="button" className="hs-settings-ghost-button hs-settings-danger-text" disabled={photoBusy} onClick={handlePhotoRemove}>
                            <Trash2 size={16} aria-hidden="true" /> Remove
                          </button>}
                        </div>
                        {photoFile && <div className="hs-settings-photo-staged">
                          <span>{photoFile.name}</span>
                          <button type="button" className="hs-settings-ghost-button" onClick={() => {
                            setPhotoFile(null);
                            setPhotoPreview('');
                            setPhotoError('');
                            if (fileInputRef.current) fileInputRef.current.value = '';
                          }}>Cancel</button>
                          <button type="button" className="hs-settings-primary-button" onClick={() => handlePhotoUpload()} disabled={photoBusy}>
                            {photoBusy ? <><Loader2 size={16} className="hs-settings-spin" /> Saving…</> : <><Save size={16} /> Save photo</>}
                          </button>
                        </div>}
                        {photoError && <p className="hs-settings-field-error" role="alert"><AlertCircle size={15} />{typeof photoError === 'string' ? photoError : getFriendlyError(photoError)}</p>}
                      </div>
                    </div>
                  </SettingCard>

                  <SettingCard title="Personal information" description="Keep your contact details and account information up to date." icon={UserRound}>
                    <div className="hs-settings-fields-grid">
                      <div className="hs-settings-field">
                        <label htmlFor="settings-full-name">Full name <span aria-hidden="true">*</span></label>
                        <div className="hs-settings-control-wrap">
                          <UserRound size={17} aria-hidden="true" />
                          <input
                            ref={(element) => { profileFieldRefs.current.full_name = element; }}
                            id="settings-full-name"
                            className="hs-settings-control"
                            value={profile.full_name}
                            autoComplete="name"
                            onChange={(event) => {
                              setProfileErrors((current) => ({ ...current, full_name: '' }));
                              setProfile((current) => ({ ...current, full_name: event.target.value }));
                            }}
                            required
                            minLength={2}
                            aria-invalid={Boolean(profileErrors.full_name)}
                            aria-describedby={profileErrors.full_name ? 'settings-full-name-error' : 'settings-full-name-hint'}
                          />
                        </div>
                        {profileErrors.full_name
                          ? <span id="settings-full-name-error" className="hs-settings-field-error"><AlertCircle size={15} />{profileErrors.full_name}</span>
                          : <span id="settings-full-name-hint" className="hs-settings-field-hint">At least 2 characters.</span>}
                      </div>
                      <div className="hs-settings-field">
                        <label htmlFor="settings-username">Username <span aria-hidden="true">*</span></label>
                        <div className="hs-settings-control-wrap">
                          <AtSign size={17} aria-hidden="true" />
                          <input
                            ref={(element) => { profileFieldRefs.current.username = element; }}
                            id="settings-username"
                            className="hs-settings-control"
                            value={profile.username}
                            autoComplete="username"
                            onChange={(event) => {
                              setUsernameError('');
                              setProfile((current) => ({ ...current, username: event.target.value }));
                            }}
                            required
                            minLength={3}
                            aria-invalid={Boolean(usernameError)}
                            aria-describedby={usernameError ? 'settings-username-error' : 'settings-username-hint'}
                          />
                        </div>
                        {usernameError
                          ? <span id="settings-username-error" className="hs-settings-field-error"><AlertCircle size={15} />{usernameError}</span>
                          : <span id="settings-username-hint" className="hs-settings-field-hint">At least 3 characters. Availability is checked when saved.</span>}
                      </div>
                      <div className="hs-settings-field">
                        <label htmlFor="settings-contact-number">Contact number</label>
                        <div className="hs-settings-control-wrap">
                          <Phone size={17} aria-hidden="true" />
                          <input
                            ref={(element) => { profileFieldRefs.current.contact_number = element; }}
                            id="settings-contact-number"
                            className="hs-settings-control"
                            type="tel"
                            inputMode="tel"
                            autoComplete="tel"
                            maxLength="32"
                            value={profile.contact_number}
                            onChange={(event) => {
                              setProfileErrors((current) => ({ ...current, contact_number: '' }));
                              setProfile((current) => ({ ...current, contact_number: event.target.value }));
                            }}
                            aria-invalid={Boolean(profileErrors.contact_number)}
                            aria-describedby={profileErrors.contact_number ? 'settings-contact-number-error' : 'settings-contact-number-hint'}
                          />
                        </div>
                        {profileErrors.contact_number
                          ? <span id="settings-contact-number-error" className="hs-settings-field-error"><AlertCircle size={15} />{profileErrors.contact_number}</span>
                          : <span id="settings-contact-number-hint" className="hs-settings-field-hint">Optional for existing accounts. Include country code when applicable.</span>}
                      </div>
                      <div className="hs-settings-field">
                        <label htmlFor="settings-email">Email address</label>
                        <div className="hs-settings-control-wrap">
                          <Mail size={17} aria-hidden="true" />
                          <input
                            ref={(element) => { profileFieldRefs.current.email = element; }}
                            id="settings-email"
                            className="hs-settings-control"
                            type="email"
                            autoComplete="email"
                            maxLength="254"
                            value={profile.email}
                            onChange={(event) => {
                              setProfileErrors((current) => ({ ...current, email: '' }));
                              setProfile((current) => ({ ...current, email: event.target.value }));
                            }}
                            aria-invalid={Boolean(profileErrors.email)}
                            aria-describedby={profileErrors.email ? 'settings-email-error' : 'settings-email-hint'}
                          />
                        </div>
                        {profileErrors.email
                          ? <span id="settings-email-error" className="hs-settings-field-error"><AlertCircle size={15} />{profileErrors.email}</span>
                          : <span id="settings-email-hint" className="hs-settings-field-hint">Optional for existing accounts.</span>}
                      </div>
                    </div>
                    {profile.username.trim() !== savedProfile.username && <div className="hs-settings-field hs-settings-current-password-field">
                      <label htmlFor="settings-current-password-profile">Current password (required to change username)</label>
                      <input
                        ref={(element) => { profileFieldRefs.current.current_password = element; }}
                        id="settings-current-password-profile"
                        className="hs-settings-control"
                        type="password"
                        autoComplete="current-password"
                        value={profile.current_password}
                        onChange={(event) => setProfile((current) => ({ ...current, current_password: event.target.value }))}
                      />
                    </div>}
                  </SettingCard>
                  <SettingCard title="Account details" description="Read-only information for the signed-in account." icon={Database}>
                    <dl className="hs-settings-definition-list">
                      <div><dt>Role</dt><dd>{user?.role}</dd></div>
                    </dl>
                  </SettingCard>
                </>}

                {selectedSection === 'appearance' && <>
                  <SettingCard title="Theme" description="Choose how HealthSync looks on this device." icon={Palette}>
                    <div className="hs-settings-theme-options" role="radiogroup" aria-label="Color theme">
                      {[
                        { id: 'light', label: 'Light', Icon: Sun },
                        { id: 'dark', label: 'Dark', Icon: Moon },
                        { id: 'system', label: 'System', Icon: Monitor },
                      ].map(({ id: theme, label, Icon }) => (
                        <button key={theme} type="button" role="radio" aria-checked={preferences.theme === theme} className={`hs-settings-theme-option${preferences.theme === theme ? ' is-selected' : ''}`} onClick={() => updatePreference('theme', theme)}>
                          <span className="hs-settings-theme-option-heading"><Icon size={18} aria-hidden="true" /><strong>{label}</strong>{preferences.theme === theme && <Check size={17} aria-label="Selected" />}</span>
                          <span className={`hs-settings-theme-preview hs-settings-theme-preview--${theme}`} aria-hidden="true"><i /><i /><i /></span>
                          {theme === 'system' && <small>Follows your device</small>}
                        </button>
                      ))}
                    </div>
                  </SettingCard>
                  <SettingCard title="Text size" description="Adjust text size across the application." icon={Activity}>
                    <div className="hs-settings-size-options" role="radiogroup" aria-label="Text size">
                      {[['small', 'Small', '87.5%'], ['default', 'Default', '100%'], ['large', 'Large', '112.5%'], ['extra-large', 'Extra large', '125%']].map(([value, label, scale]) => (
                        <button key={value} type="button" role="radio" aria-checked={preferences.textSize === value} className={`hs-settings-size-option${preferences.textSize === value ? ' is-selected' : ''}`} onClick={() => updatePreference('textSize', value)}>
                          <strong>{label}</strong><span>{scale}</span>{preferences.textSize === value && <Check size={16} aria-label="Selected" />}
                        </button>
                      ))}
                    </div>
                    <div className="hs-settings-live-preview"><span>LIVE PREVIEW</span><strong>Clear health records, healthier communities.</strong><p>Text size is applied immediately and saved with your other settings.</p></div>
                  </SettingCard>
                </>}

                {selectedSection === 'security' && <>
                  {devicesError && <SettingsAlert>{getFriendlyError(devicesError)}</SettingsAlert>}
                  <SettingCard title={pinTitle} description={pinDescription} icon={KeyRound}>
                    <form className="hs-settings-form" onSubmit={handlePinSave}>
                      <div className="hs-settings-pin-field">
                        <fieldset className="hs-settings-pin-group">
                          <legend>{pinAction === 'promote' ? 'Current device PIN' : pinAction === 'enroll-device' ? 'Shared account PIN' : 'New account PIN'}</legend>
                          <PinDigitInput ref={pinInputRef} onChange={(pin) => setPinForm((current) => ({ ...current, pin }))} showStrengthHint />
                        </fieldset>
                      </div>
                      <div className="hs-settings-pin-field">
                        <fieldset className="hs-settings-pin-group">
                          <legend>{pinAction === 'promote' ? 'Confirm current PIN' : pinAction === 'enroll-device' ? 'Confirm account PIN' : 'Confirm new account PIN'}</legend>
                          <PinDigitInput
                            ref={pinConfirmInputRef}
                            invalid={Boolean(pinForm.confirm && pinForm.pin !== pinForm.confirm)}
                            describedBy={pinForm.confirm && pinForm.pin !== pinForm.confirm ? 'settings-pin-mismatch' : undefined}
                            autoFocus={false}
                            onChange={(pin) => setPinForm((current) => ({ ...current, confirm: pin }))}
                          />
                        </fieldset>
                      </div>
                      {pinForm.confirm && pinForm.pin !== pinForm.confirm && <p id="settings-pin-mismatch" className="hs-settings-field-error" role="status"><AlertCircle size={15} />PIN entries do not match.</p>}
                      {(hasDevicePin || pinPasswordStep) && <div className="hs-settings-field">
                        <label htmlFor="settings-pin-current-password">Current account password</label>
                        <input ref={pinPasswordInputRef} id="settings-pin-current-password" className="hs-settings-control" type="password" autoComplete="current-password" value={pinForm.currentPassword} onChange={(event) => setPinForm((current) => ({ ...current, currentPassword: event.target.value }))} required />
                      </div>}
                      {pinMessage && <p className="hs-settings-success-message" role="status"><CheckCircle2 size={17} />{pinMessage}</p>}
                      {!hasDevicePin && pinPasswordStep && <button className="hs-settings-secondary-button" type="button" onClick={() => {
                        setPinPasswordStep(false);
                        setPinForm((current) => ({ ...current, currentPassword: '' }));
                      }}>Back to PIN</button>}
                      <button className="hs-settings-primary-button" type="submit" disabled={securityBusy || (hasDevicePin && !pinForm.currentPassword) || !/^\d{6}$/.test(pinForm.pin) || pinForm.pin !== pinForm.confirm}>
                        {securityBusy ? <><Loader2 size={16} className="hs-settings-spin" /> Saving PIN…</> : pinPasswordStep ? 'Save PIN' : pinAction === 'promote' ? 'Share this PIN' : pinAction === 'set-account' ? 'Set up account PIN' : pinAction === 'change-account' ? 'Change account PIN' : 'Use account PIN'}
                      </button>
                    </form>
                  </SettingCard>
                  <SettingCard title="Change password" description="Use a strong, unique password to protect your account." icon={LockKeyhole}>
                    <form className="hs-settings-form" onSubmit={handlePasswordChange}>
                      {renderPasswordInput('current', 'Current password', passwords.current, (value) => setPasswords((current) => ({ ...current, current: value })), 'current-password')}
                      {renderPasswordInput('new', 'New password', passwords.next, (value) => setPasswords((current) => ({ ...current, next: value })), 'new-password')}
                      {passwords.next && <div className="hs-settings-password-strength" aria-live="polite">
                        <div className="hs-settings-strength-meter"><span className={`strength-${passwordScore}`} /></div>
                        <strong className={`hs-settings-strength-label strength-label-${passwordScore}`}>{passwordStrength}</strong>
                        <ul>{[['length', 'At least 18 characters'], ['uppercase', 'One uppercase letter'], ['number', 'One number'], ['symbol', 'One symbol'], ['bcryptLimit', 'No more than 72 UTF-8 bytes']].map(([key, text]) => <li key={key} className={passwordRequirements[key] ? 'is-met' : ''}>{text}</li>)}</ul>
                      </div>}
                      {renderPasswordInput('confirm', 'Confirm new password', passwords.confirm, (value) => setPasswords((current) => ({ ...current, confirm: value })), 'new-password')}
                      {passwords.confirm && passwords.next !== passwords.confirm && <p className="hs-settings-field-error" role="alert"><AlertCircle size={15} />Passwords do not match.</p>}
                      <button className="hs-settings-primary-button" type="submit" disabled={securityBusy || !passwords.current || passwordScore !== 5 || passwords.next !== passwords.confirm}>
                        {securityBusy ? <><Loader2 size={16} className="hs-settings-spin" /> Updating…</> : 'Update password'}
                      </button>
                    </form>
                  </SettingCard>
                  <SettingCard title="Recent sign-ins" description="Review recent account activity. Up to 20 entries are shown." icon={Activity}>
                    {loginHistory.length ? <div className="hs-settings-history-wrap"><table className="hs-settings-history-table">
                      <thead><tr><th>Date and time</th><th>Device</th><th>IP address</th><th>Status</th></tr></thead>
                      <tbody>{loginHistory.map((entry) => <tr key={entry.id}>
                        <td>{new Date(entry.occurred_at).toLocaleString()}</td>
                        <td>{userAgentLabel(entry.user_agent)}</td>
                        <td>{entry.ip_address || 'Unavailable'}</td>
                        <td><span className={`hs-settings-status${entry.current ? ' is-current' : ''}`}>{entry.current ? 'Current session' : entry.status === 'ACTIVE' ? 'Active' : entry.status === 'FAILED' ? 'Failed' : entry.status === 'REVOKED' ? 'Signed out' : 'Ended'}</span></td>
                      </tr>)}</tbody>
                    </table></div> : <div className="hs-settings-empty-state"><Activity size={21} aria-hidden="true" /><strong>No sign-in history yet</strong><span>Successful and failed sign-in activity will appear here.</span></div>}
                    <div className="hs-settings-action-row hs-settings-danger-row">
                      <span className="hs-settings-row-icon" aria-hidden="true"><LogOut size={18} /></span>
                      <div><strong>Log out of all devices</strong><p>This signs out every active device, including this one.</p></div>
                      <button type="button" className="hs-settings-outline-danger" onClick={() => setShowRevokeModal(true)}>Log out all devices</button>
                    </div>
                  </SettingCard>
                  <SettingCard title="Offline devices" description="Device revocation takes effect when the device reconnects. A device that remains disconnected cannot receive revocation updates." icon={Smartphone}>
                    {authorizedDevices.length ? <ul className="hs-settings-device-list">
                      {authorizedDevices.map((device) => <li key={device.device_id}>
                        <span className="hs-settings-row-icon" aria-hidden="true"><Smartphone size={17} /></span>
                        <span className="hs-settings-device-copy">
                          <strong>{device.device_id === user?.device_id ? 'This device' : `Device ${device.device_id.slice(0, 8)}`}</strong>
                          <small>{device.status.toLowerCase()}{device.last_seen_at ? ` · Last connected ${formatRelativeTime(device.last_seen_at)}` : ''}</small>
                        </span>
                        {device.status === 'ACTIVE' && <button type="button" className="hs-settings-outline-danger" disabled={securityBusy} onClick={() => setDeviceToRevoke(device)}>Revoke</button>}
                      </li>)}
                    </ul> : <div className="hs-settings-empty-state"><Smartphone size={21} aria-hidden="true" /><strong>No registered devices</strong><span>Approved offline devices will appear here.</span></div>}
                    <div className="hs-settings-field hs-settings-device-password">
                      <label htmlFor="settings-device-revoke-password">Current account password to revoke a device</label>
                      <input id="settings-device-revoke-password" className="hs-settings-control" type="password" autoComplete="current-password" value={devicePassword} onChange={(event) => setDevicePassword(event.target.value)} />
                    </div>
                  </SettingCard>
                </>}

                {selectedSection === 'notifications' && <SettingCard title="In-app alerts" description="Choose which existing HealthSync activity can be surfaced as notifications." icon={Bell}>
                  <div className="hs-settings-notification-group">
                    <h3>Health alerts</h3>
                    <PreferenceSwitch id="settings-nutrition-alerts" checked={preferences.notifications.nutritionAlerts} onChange={(value) => updateNotification('nutritionAlerts', value)} title="Nutrition record updates" description="Updates when a nutrition assessment is recorded." icon={Activity} />
                    <PreferenceSwitch id="settings-senior-alerts" checked={preferences.notifications.seniorFollowUpAlerts} onChange={(value) => updateNotification('seniorFollowUpAlerts', value)} title="Senior registry updates" description="Updates when a senior citizen is registered." icon={UserRound} />
                  </div>
                  <div className="hs-settings-notification-group">
                    <h3>System</h3>
                    <PreferenceSwitch id="settings-sync-alerts" checked={preferences.notifications.offlineSyncAlerts} onChange={(value) => updateNotification('offlineSyncAlerts', value)} title="Offline and sync status" description="Alerts when changes are queued offline or synchronization needs attention." icon={Database} />
                    <PreferenceSwitch id="settings-resident-alerts" checked={preferences.notifications.newResidentAlerts} onChange={(value) => updateNotification('newResidentAlerts', value)} title="New resident registrations" description="Updates when a new resident record is added." icon={UserRound} />
                  </div>
                  <div className="hs-settings-info-note"><Bell size={17} aria-hidden="true" />Notifications appear in the in-app bell and are stored on this device. Push and email notifications are not enabled.</div>
                </SettingCard>}

                {selectedSection === 'privacy' && <>
                  <SettingCard title="Your privacy" description="How HealthSync protects information entrusted to the barangay." icon={ShieldCheck}>
                    <div className="hs-settings-privacy-copy"><h3>Data Privacy Act of 2012 (Republic Act No. 10173)</h3><p>HealthSync is used to support authorized barangay health services. Account activity is recorded for security and accountability. Resident health information should be accessed only for legitimate care and administrative duties, and handled according to applicable privacy requirements and your organization’s data-retention policies.</p><p>Resident health data is accessible only to authorized barangay health workers and other users with assigned access.</p></div>
                  </SettingCard>
                  <SettingCard title="Account activity" description="Download a copy of your recent sign-in history." icon={FileDown}>
                    <div className="hs-settings-action-row">
                      <span className="hs-settings-row-icon" aria-hidden="true"><Download size={18} /></span>
                      <div><strong>Download my account activity (CSV)</strong><p>The CSV includes sign-in timestamps, device/browser information, IP addresses, and session status.</p></div>
                      <button type="button" className="hs-settings-secondary-button" onClick={handleExport}><Download size={16} aria-hidden="true" /> Download CSV</button>
                    </div>
                  </SettingCard>
                </>}
              </>
            ))}
          </div>
        ))}
      </div>

      {showSaveBar && <div className="hs-settings-savebar" role="region" aria-label="Unsaved changes">
        <span className="hs-settings-unsaved-label"><i aria-hidden="true" /> Unsaved changes</span>
        <div className="hs-settings-savebar-actions">
          <button type="button" className="hs-settings-secondary-button" onClick={() => discardChanges(selectedSection)} disabled={saving || photoBusy}>
            <RotateCcw size={16} aria-hidden="true" /> Discard
          </button>
          <button type="button" className="hs-settings-primary-button" onClick={() => handleSaveChanges(selectedSection)} disabled={saving || photoBusy}>
            {saving ? <><Loader2 size={16} className="hs-settings-spin" /> Saving…</> : <><Save size={16} aria-hidden="true" /> Save changes</>}
          </button>
        </div>
      </div>}

      {toast && <div className={`hs-settings-toast${toastType === 'error' ? ' is-error' : ''}`} role={toastType === 'error' ? 'alert' : 'status'}>
        {toastType === 'error' ? <AlertCircle size={18} aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}{toast}
      </div>}

      <DiscardDialog open={Boolean(discardAction)} onCancel={cancelDiscard} onDiscard={confirmDiscard} />

      <AccessibleDialog open={showRevokeModal} onClose={() => {
        if (!securityBusy) {
          setShowRevokeModal(false);
          setRevokePassword('');
        }
      }} labelledBy="settings-revoke-title" className="hs-settings-revoke-dialog">
        <h2 id="settings-revoke-title">Log out of all devices?</h2>
        <p>This will revoke every active session, including your current session. You will need to sign in again.</p>
        <form onSubmit={handleRevokeSessions}>
          <div className="hs-settings-field">
            <label htmlFor="settings-revoke-password">Confirm with your current password</label>
            <input id="settings-revoke-password" className="hs-settings-control" type="password" autoComplete="current-password" value={revokePassword} onChange={(event) => setRevokePassword(event.target.value)} required />
          </div>
          <div className="hs-settings-dialog-actions">
            <button type="button" className="hs-settings-secondary-button" onClick={() => {
              setShowRevokeModal(false);
              setRevokePassword('');
            }}>Cancel</button>
            <button type="submit" className="hs-settings-danger-button" disabled={securityBusy || !revokePassword}>
              {securityBusy ? <><Loader2 size={16} className="hs-settings-spin" /> Signing out…</> : 'Log out all devices'}
            </button>
          </div>
        </form>
      </AccessibleDialog>

      <AccessibleDialog open={Boolean(deviceToRevoke)} onClose={() => setDeviceToRevoke(null)} labelledBy="settings-device-revoke-title">
        <span className="hs-settings-dialog-icon" aria-hidden="true"><AlertTriangle size={20} /></span>
        <h2 id="settings-device-revoke-title">Revoke this device?</h2>
        <p>The device will lose authorization when it reconnects. Continue only if you recognize the device you are revoking.</p>
        <div className="hs-settings-dialog-actions">
          <button type="button" className="hs-settings-secondary-button" onClick={() => setDeviceToRevoke(null)}>Keep device</button>
          <button type="button" className="hs-settings-danger-button" disabled={securityBusy} onClick={() => {
            const device = deviceToRevoke;
            setDeviceToRevoke(null);
            if (device) handleDeviceRevoke(device);
          }}>Revoke device</button>
        </div>
      </AccessibleDialog>
    </div>
  );
};

export default AdminSettingsPage;
