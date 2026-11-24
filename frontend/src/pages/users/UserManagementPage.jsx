import React, { useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Activity, Building2, Check, HeartPulse, KeyRound, MoreHorizontal, Pencil, Plus, Search, ShieldCheck, UserRound, Users, X } from 'lucide-react';
import api from '../../services/api/apiClient';
import Pagination from '../../components/common/Pagination';
import { AuthContext } from '../../context/AuthContext';
import { formatDateTime, formatRelativeTime } from '../../utils/dateUtils';
import { getProfilePhotoUrl } from '../../utils/profilePhoto';
import StatusBanner from '../../components/common/StatusBanner';
import { getFriendlyError } from '../../utils/apiErrorMessages';
import './UserManagementPage.css';

const ROLES = [
  { value: 'admin', label: 'Admin', description: 'Manages system accounts, settings, and audit logs.' },
  { value: 'official', label: 'Official', description: 'Views dashboards, reports, and nutrition monitoring.' },
  { value: 'bhw', label: 'BHW', description: 'Records resident and health data for the barangay.' },
];
const EMPTY_NEW_USER = {
  full_name: '',
  username: '',
  contact_number: '',
  email: '',
  role: 'bhw',
  password_mode: 'generated',
  password: '',
};
const PASSWORD_RULES = [
  ['length', 'At least 18 characters'],
  ['uppercase', 'One uppercase letter'],
  ['number', 'One number'],
  ['symbol', 'One symbol'],
  ['bcryptLimit', 'No more than 72 UTF-8 bytes'],
];

const normalizePassword = (value) => ({
  length: Array.from(value).length >= 18,
  uppercase: /[A-Z]/.test(value),
  number: /\d/.test(value),
  symbol: /[^A-Za-z0-9\s]/.test(value),
  bcryptLimit: new Blob([value]).size <= 72,
});

const suggestUsername = (name = '') => {
  const parts = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return '';
  return `${parts[0][0]}${parts[parts.length - 1]}`.replace(/[^a-z0-9._-]/g, '').slice(0, 32);
};

const userStatus = (user) => {
  if (!user.is_active) return 'inactive';
  return user.is_locked ? 'locked' : 'active';
};

const roleLabel = (role) => ROLES.find((item) => item.value === role)?.label || role || 'Unknown';

const normalizeRoleKey = (role) => {
  const key = String(role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return key === 'barangay_official' ? 'official' : key;
};

const getRoleCount = (roleCounts, requestedRole) => {
  if (!roleCounts || typeof roleCounts !== 'object' || Array.isArray(roleCounts)) return null;
  return Object.entries(roleCounts).reduce((total, [role, count]) => (
    normalizeRoleKey(role) === requestedRole ? total + (Number.isFinite(Number(count)) ? Number(count) : 0) : total
  ), 0);
};

const formatCount = (value) => new Intl.NumberFormat().format(Math.max(0, Number(value) || 0));

const describeAuditAction = (action) => {
  const knownActions = {
    user_created: 'Account created',
    user_updated: 'Profile updated',
    user_deactivated: 'Account deactivated',
    user_reactivated: 'Account reactivated',
    password_reset: 'Password reset',
    account_unlocked: 'Account unlocked',
    role_changed: 'Role changed',
  };
  const key = String(action || '').toLowerCase();
  return knownActions[key] || key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Account activity';
};

const Avatar = ({ user, size = 'normal' }) => {
  const [failed, setFailed] = useState(false);
  const initials = String(user?.full_name || user?.username || 'U')
    .split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const tone = (String(user?.username || user?.full_name || 'U').charCodeAt(0) || 0) % 8;
  const image = user?.profile_photo && !failed ? getProfilePhotoUrl(user.profile_photo) : '';
  return image
    ? <img className={`users-avatar users-avatar-${size}`} src={image} alt="" onError={() => setFailed(true)} />
    : <span className={`users-avatar users-avatar-${size} users-avatar-tone-${tone}`} aria-hidden="true">{initials}</span>;
};

const RoleBadge = ({ role }) => (
  <span className={`users-role-badge users-role-${role}`}>
    {role === 'admin' ? <ShieldCheck size={13} aria-hidden="true" />
      : role === 'official' ? <Building2 size={13} aria-hidden="true" />
        : <HeartPulse size={13} aria-hidden="true" />}
    {roleLabel(role)}
  </span>
);

const StatusBadge = ({ user }) => {
  const status = userStatus(user);
  const label = status === 'locked' ? 'Locked' : status === 'inactive' ? 'Inactive' : 'Active';
  return <span className={`users-status-badge users-status-${status}`}><span className="users-status-dot" aria-hidden="true" />{label}</span>;
};

const RelativeDate = ({ value, empty = 'Never' }) => {
  if (!value) return <span className="users-muted">{empty}</span>;
  const relative = formatRelativeTime(value);
  const exact = formatDateTime(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <span className="users-muted">{empty}</span>;
  return <time dateTime={date.toISOString()} title={exact || ''}>{relative || exact}</time>;
};

const ExactDate = ({ value, empty = 'Not recorded' }) => {
  if (!value) return <span className="users-muted">{empty}</span>;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <span className="users-muted">{empty}</span>;
  return <time dateTime={date.toISOString()} title={formatRelativeTime(value) || ''}>{formatDateTime(value)}</time>;
};

const AccessibleModal = ({ title, onClose, children, className = '', headerContent, returnFocusRef }) => {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  const previousFocusRef = useRef(null);
  const titleId = useId();
  closeRef.current = onClose;

  useEffect(() => {
    previousFocusRef.current = returnFocusRef?.current || document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusables = () => Array.from(dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])') || []);
    const keydown = (event) => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'));
      if (dialogs[dialogs.length - 1] !== dialogRef.current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault();
        items[items.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === items[items.length - 1]) {
        event.preventDefault();
        items[0].focus();
      }
    };
    document.addEventListener('keydown', keydown);
    requestAnimationFrame(() => (focusables()[0] || dialogRef.current)?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', keydown);
      requestAnimationFrame(() => previousFocusRef.current?.focus?.());
    };
  }, [returnFocusRef]);

  return (
    <div className={`users-modal-backdrop ${className}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="users-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex="-1">
        {headerContent
          ? headerContent({ titleId, onClose })
          : <div className="users-modal-heading">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="users-icon-button" aria-label="Close dialog" onClick={onClose}><X size={19} aria-hidden="true" /></button>
          </div>}
        {children}
      </section>
    </div>
  );
};

const PasswordMeter = ({ value }) => {
  const rules = normalizePassword(value);
  const score = Object.values(rules).filter(Boolean).length;
  const label = !value ? 'Not set' : score <= 2 ? 'Weak' : score <= 4 ? 'Fair' : 'Strong';
  return (
    <div className="users-password-meter" aria-live="polite">
      <div><span>Password strength</span><strong>{label}</strong></div>
      <div className="users-password-meter-track" aria-hidden="true"><span className={`strength-${score}`} /></div>
      <ul>{PASSWORD_RULES.map(([key, text]) => <li className={rules[key] ? 'is-valid' : ''} key={key}>{text}</li>)}</ul>
    </div>
  );
};

const PasswordInput = ({ id, value, onChange, label = 'Temporary password' }) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="users-form-field">
      <label htmlFor={id}>{label}</label>
      <div className="users-password-input">
        <input id={id} type={visible ? 'text' : 'password'} autoComplete="new-password" value={value}
          onChange={(event) => onChange(event.target.value)} />
        <button type="button" className="users-password-toggle" onClick={() => setVisible((state) => !state)}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-pressed={visible}>
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      <PasswordMeter value={value} />
    </div>
  );
};

const RoleSelector = ({ value, onChange, disabled = false, idPrefix = 'role' }) => (
  <fieldset className="users-role-options" disabled={disabled}>
    <legend>Role</legend>
    {ROLES.map((role) => (
      <label key={role.value} className={`users-role-option ${value === role.value ? 'selected' : ''}`}>
        <input type="radio" name={`${idPrefix}-role`} value={role.value} checked={value === role.value}
          onChange={() => onChange(role.value)} />
        <span><strong>{role.label}</strong><small>{role.description}</small></span>
      </label>
    ))}
  </fieldset>
);

const FilterFields = ({ role, status, passwordStatus, sort, onChange }) => (
  <>
    <label className="users-filter-field"><span>Role</span>
      <select value={role} onChange={(event) => onChange('role', event.target.value)}>
        <option value="">All roles</option>{ROLES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
      </select>
    </label>
    <label className="users-filter-field"><span>Status</span>
      <select value={status} onChange={(event) => onChange('status', event.target.value)}>
        <option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="locked">Locked</option>
      </select>
    </label>
    <label className="users-filter-field"><span>Password status</span>
      <select value={passwordStatus} onChange={(event) => onChange('passwordStatus', event.target.value)}>
        <option value="">All password statuses</option><option value="temporary">Temporary</option><option value="normal">Normal</option>
      </select>
    </label>
    <label className="users-filter-field"><span>Sort by</span>
      <select value={sort} onChange={(event) => onChange('sort', event.target.value)}>
        <option value="name">Name A–Z</option><option value="newest">Newest</option><option value="last_login">Last login</option><option value="role">Role</option>
      </select>
    </label>
  </>
);

const RowActionsMenu = ({ user, currentUserId, activeAdmins, onAction, onTrigger }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const handleMenuKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key === 'Tab') {
        const items = Array.from(menuRef.current?.querySelectorAll('button:not(:disabled)') || []);
        if (!items.length) return;
        if (event.shiftKey && document.activeElement === items[0]) {
          event.preventDefault();
          items[items.length - 1].focus();
        } else if (!event.shiftKey && document.activeElement === items[items.length - 1]) {
          event.preventDefault();
          items[0].focus();
        }
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', handleMenuKey);
    requestAnimationFrame(() => menuRef.current?.querySelector('button:not(:disabled)')?.focus());
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', handleMenuKey);
    };
  }, [open]);
  const self = Number(user.user_id) === Number(currentUserId);
  const protectedUser = Boolean(user.protected);
  const lastAdmin = user.role === 'admin' && activeAdmins <= 1;
  const items = [
    { label: 'Edit user', action: 'edit', disabled: protectedUser, reason: 'The primary admin is managed through Settings.' },
    { label: 'Reset password', action: 'reset', disabled: self || protectedUser, reason: self ? 'Use Settings to change your own password.' : 'The primary admin cannot be reset here.' },
    { label: 'Change role', action: 'change-role', disabled: protectedUser || self, reason: protectedUser ? 'The primary admin is protected.' : 'You cannot change your own role.' },
    { label: user.is_active ? 'Deactivate' : 'Reactivate', action: user.is_active ? 'deactivate' : 'reactivate', disabled: user.is_active && (self || protectedUser || lastAdmin), reason: self ? 'You cannot deactivate yourself.' : protectedUser ? 'The primary admin cannot be deactivated.' : 'The last active admin cannot be deactivated.' },
    ...(user.is_locked ? [{ label: 'Unlock account', action: 'unlock' }] : []),
    { label: 'Log out of all devices', action: 'logout-all' },
    { label: 'View activity', action: 'activity' },
  ];
  return (
    <div className="users-row-menu" ref={rootRef} onClick={(event) => event.stopPropagation()}>
      <button type="button" className="users-icon-button users-menu-trigger" aria-label={`More actions for ${user.full_name}`}
        ref={triggerRef} aria-haspopup="menu" aria-expanded={open} onClick={(event) => { onTrigger?.(event); setOpen((state) => !state); }}><MoreHorizontal size={19} aria-hidden="true" /></button>
      {open && <div ref={menuRef} className="users-menu" role="menu">{items.map((item) => (
        <button key={item.action} type="button" role="menuitem" disabled={item.disabled} title={item.disabled ? item.reason : undefined}
          onClick={() => { setOpen(false); onAction(item.action, user); }}>{item.label}{item.disabled && <span className="users-menu-reason">{item.reason}</span>}</button>
      ))}</div>}
    </div>
  );
};

const UserManagementPage = () => {
  const { user: currentUser, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const querySearch = searchParams.get('search') || '';
  const role = searchParams.get('role') || '';
  const status = searchParams.get('status') || '';
  const passwordStatus = searchParams.get('passwordStatus') || '';
  const sort = searchParams.get('sort') || 'name';
  const page = Math.max(1, Number.parseInt(searchParams.get('page'), 10) || 1);
  const pageSize = [10, 25, 50].includes(Number(searchParams.get('pageSize'))) ? Number(searchParams.get('pageSize')) : 10;
  const drawerMode = searchParams.get('drawer') || '';
  const selectedUserId = searchParams.get('user') || '';
  const [searchInput, setSearchInput] = useState(querySearch);
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ total: 0, active: 0, inactive: 0, locked: 0, temporary: 0, active_admins: 0 });
  const [roleCounts, setRoleCounts] = useState(null);
  const [roleSummaryError, setRoleSummaryError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState('');
  const [actionError, setActionError] = useState('');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailReload, setDetailReload] = useState(0);
  const [detailTab, setDetailTab] = useState('profile');
  const [offlineDevices, setOfflineDevices] = useState([]);
  const [offlineDevicesError, setOfflineDevicesError] = useState('');
  const [offlineDevicesLoading, setOfflineDevicesLoading] = useState(false);
  const offlineDevicesCacheRef = useRef(new Map());
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({ full_name: '', username: '', role: 'bhw' });
  const [savedEditForm, setSavedEditForm] = useState({ full_name: '', username: '', role: 'bhw' });
  const [editErrors, setEditErrors] = useState({});
  const [editUsernameCheck, setEditUsernameCheck] = useState({ checking: false, available: null, error: '' });
  const [newForm, setNewForm] = useState(EMPTY_NEW_USER);
  const [newErrors, setNewErrors] = useState({});
  const [newUsernameCheck, setNewUsernameCheck] = useState({ checking: false, available: null, error: '' });
  const [saving, setSaving] = useState(false);
  const [credentials, setCredentials] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [deviceConfirm, setDeviceConfirm] = useState(null);
  const [resetPasswordMode, setResetPasswordMode] = useState('generated');
  const [resetPassword, setResetPassword] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [pendingDetailTab, setPendingDetailTab] = useState(null);
  const triggerRef = useRef(null);
  const detailTabRefs = useRef({});
  const drawerLocationRef = useRef({ drawer: drawerMode, user: selectedUserId });
  const searchRef = useRef(null);
  const debounceRef = useRef(null);
  const isEditDirty = editMode && JSON.stringify(editForm) !== JSON.stringify(savedEditForm);
  const isNewDirty = drawerMode === 'new' && JSON.stringify(newForm) !== JSON.stringify(EMPTY_NEW_USER);
  const isDirty = isEditDirty || isNewDirty;

  useEffect(() => {
    if (drawerMode !== 'credentials' && credentials) setCredentials(null);
  }, [credentials, drawerMode]);

  useEffect(() => {
    const previous = drawerLocationRef.current;
    const drawerChanged = previous.drawer
      && (previous.drawer !== drawerMode || previous.user !== selectedUserId);
    if (drawerChanged && isDirty) {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set('drawer', previous.drawer);
        if (previous.user) next.set('user', previous.user);
        else next.delete('user');
        return next;
      }, { replace: true });
      setPendingDetailTab(null);
      setShowLeaveConfirm(true);
      return;
    }
    drawerLocationRef.current = { drawer: drawerMode, user: selectedUserId };
  }, [drawerMode, isDirty, selectedUserId, setSearchParams]);

  const updateQuery = useCallback((updates, replace = true) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === undefined || value === '') next.delete(key);
        else next.set(key, String(value));
      });
      return next;
    }, { replace });
  }, [setSearchParams]);

  useEffect(() => {
    const defaults = { sort: 'name', page: '1', pageSize: '10' };
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      let changed = false;
      Object.entries(defaults).forEach(([key, value]) => {
        if (!next.has(key)) { next.set(key, value); changed = true; }
      });
      return changed ? next : current;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    setSearchInput(querySearch);
  }, [querySearch]);

  useEffect(() => {
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      if (searchInput.trim() !== querySearch) updateQuery({ search: searchInput.trim(), page: 1 });
    }, 300);
    return () => window.clearTimeout(debounceRef.current);
  }, [querySearch, searchInput, updateQuery]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await api.get('/users', { params: { search: querySearch, role, status, passwordStatus, sort, page, pageSize } });
      if (!response.data?.success) throw new Error(response.data?.message || 'Unable to load users.');
      setUsers(response.data.data || []);
      setTotal(Number(response.data.total || 0));
      setCounts((current) => ({ ...current, ...(response.data.counts || {}) }));
    } catch (error) {
      console.error('Unable to load users.', error);
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, passwordStatus, querySearch, role, sort, status]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const fetchRoleCounts = useCallback(async () => {
    setRoleSummaryError(null);
    try {
      const response = await api.get('/dashboard/admin-summary');
      const summary = response.data?.data;
      if (response.data?.success !== true || !summary?.usersByRole || typeof summary.usersByRole !== 'object') {
        throw new Error(response.data?.message || 'Role totals are unavailable.');
      }
      setRoleCounts(summary.usersByRole);
    } catch (error) {
      console.error('Unable to load role totals.', error);
      setRoleCounts(null);
      setRoleSummaryError(error);
    }
  }, []);

  useEffect(() => { fetchRoleCounts(); }, [fetchRoleCounts]);

  useEffect(() => {
    if (drawerMode !== 'user' || !selectedUserId) {
      setDetail(null);
      setDetailError('');
      setDetailLoading(false);
      return undefined;
    }
    let active = true;
    setDetailLoading(true);
    setDetailError('');
    api.get(`/users/${encodeURIComponent(selectedUserId)}`)
      .then((response) => {
        if (!response.data?.success) throw new Error(response.data?.message || 'Unable to load user details.');
        if (active) setDetail(response.data.data);
      })
      .catch((error) => {
        console.error('Unable to load user details.', error);
        if (active) setDetailError(error);
      })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [detailReload, drawerMode, selectedUserId]);

  useEffect(() => {
    if (!detail) return;
    const next = { full_name: detail.full_name || '', username: detail.username || '', role: detail.role || 'bhw' };
    setEditForm(next);
    setSavedEditForm(next);
  }, [detail]);

  useEffect(() => {
    if (drawerMode !== 'user' || detailTab !== 'security' || !detail?.user_id) return undefined;
    const userId = String(detail.user_id);
    if (offlineDevicesCacheRef.current.has(userId)) {
      setOfflineDevices(offlineDevicesCacheRef.current.get(userId));
      setOfflineDevicesError('');
      return undefined;
    }
    let active = true;
    setOfflineDevicesLoading(true);
    setOfflineDevicesError('');
    api.get(`/users/${encodeURIComponent(detail.user_id)}/offline-devices`)
      .then((response) => {
        if (!response.data?.success) throw new Error(response.data?.message || 'Unable to load authorized devices.');
        if (active) {
          const devices = response.data.data || [];
          setOfflineDevices(devices);
          offlineDevicesCacheRef.current.set(userId, devices);
        }
      })
      .catch((error) => {
        console.error('Unable to load authorized devices.', error);
        if (active) setOfflineDevicesError(error);
      })
      .finally(() => { if (active) setOfflineDevicesLoading(false); });
    return () => { active = false; };
  }, [detail?.user_id, detailReload, detailTab, drawerMode]);

  useEffect(() => {
    if (drawerMode !== 'new' || !newForm.username.trim()) {
      setNewUsernameCheck({ checking: false, available: null, error: '' });
      return undefined;
    }
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(newForm.username.trim())) {
      setNewUsernameCheck({ checking: false, available: false, error: 'Use 3-32 letters, numbers, dots, underscores, or hyphens.' });
      return undefined;
    }
    let active = true;
    setNewUsernameCheck({ checking: true, available: null, error: '' });
    const timer = window.setTimeout(async () => {
      try {
        const response = await api.get('/users/check-username', { params: { username: newForm.username.trim() } });
        if (active) setNewUsernameCheck({ checking: false, available: response.data?.available === true, error: response.data?.message || '' });
      } catch (error) {
        console.error('Unable to check username availability.', error);
        if (active) setNewUsernameCheck({ checking: false, available: null, error: getFriendlyError(error) });
      }
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [drawerMode, newForm.username]);

  useEffect(() => {
    if (drawerMode !== 'user' || !editMode || !detail || !editForm.username.trim()) {
      setEditUsernameCheck({ checking: false, available: null, error: '' });
      return undefined;
    }
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(editForm.username.trim())) {
      setEditUsernameCheck({ checking: false, available: false, error: 'Use 3-32 letters, numbers, dots, underscores, or hyphens.' });
      return undefined;
    }
    let active = true;
    setEditUsernameCheck({ checking: true, available: null, error: '' });
    const timer = window.setTimeout(async () => {
      try {
        const response = await api.get('/users/check-username', { params: { username: editForm.username.trim(), exclude: detail.user_id } });
        if (active) setEditUsernameCheck({ checking: false, available: response.data?.available === true, error: response.data?.message || '' });
      } catch (error) {
        console.error('Unable to check username availability.', error);
        if (active) setEditUsernameCheck({ checking: false, available: null, error: getFriendlyError(error) });
      }
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [detail, drawerMode, editForm.username, editMode]);

  useEffect(() => {
    if (!isDirty) return undefined;
    const preventLeave = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventLeave);
    return () => window.removeEventListener('beforeunload', preventLeave);
  }, [isDirty]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const shortcut = (event) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey
        || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
        || document.activeElement?.isContentEditable) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  const openNewDrawer = (event) => {
    triggerRef.current = event.currentTarget;
    setActionError('');
    setCredentials(null);
    setNewForm(EMPTY_NEW_USER);
    setNewErrors({});
    updateQuery({ drawer: 'new', user: '' }, false);
  };

  const openUserDrawer = (id, event, edit = false) => {
    if (event?.currentTarget) triggerRef.current = event.currentTarget;
    setActionError('');
    setDetailTab('profile');
    setDetail(null);
    setEditMode(edit);
    setCredentials(null);
    updateQuery({ drawer: 'user', user: id }, false);
  };

  const closeDrawer = () => {
    setShowLeaveConfirm(false);
    setPendingDetailTab(null);
    setCredentials(null);
    setEditMode(false);
    setNewForm(EMPTY_NEW_USER);
    updateQuery({ drawer: null, user: null }, false);
  };

  const requestCloseDrawer = () => {
    if (isDirty) {
      setPendingDetailTab(null);
      setShowLeaveConfirm(true);
    }
    else closeDrawer();
  };

  const selectDetailTab = (nextTab) => {
    if (nextTab === detailTab) return;
    if (isEditDirty) {
      setPendingDetailTab(nextTab);
      setShowLeaveConfirm(true);
      return;
    }
    setEditMode(false);
    setDetailTab(nextTab);
  };

  const handleDetailTabKeyDown = (event, currentTab) => {
    const tabs = ['profile', 'security', 'activity'];
    const currentIndex = tabs.indexOf(currentTab);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    if (isEditDirty) {
      setPendingDetailTab(nextTab);
      setShowLeaveConfirm(true);
      return;
    }
    selectDetailTab(nextTab);
    requestAnimationFrame(() => detailTabRefs.current[nextTab]?.focus());
  };

  const discardChangesAndContinue = () => {
    if (pendingDetailTab) {
      setEditForm(savedEditForm);
      setEditMode(false);
      setEditErrors({});
      setDetailTab(pendingDetailTab);
      setPendingDetailTab(null);
      setShowLeaveConfirm(false);
      return;
    }
    closeDrawer();
  };

  const keepEditing = () => {
    setPendingDetailTab(null);
    setShowLeaveConfirm(false);
  };

  const chooseFilter = (key, value) => updateQuery({ [key]: value, page: 1 });
  const clearFilters = () => {
    setSearchInput('');
    updateQuery({ search: null, role: null, status: null, passwordStatus: null, sort: 'name', page: 1 });
  };

  const roleFilterOptions = <FilterFields role={role} status={status} passwordStatus={passwordStatus} sort={sort} onChange={chooseFilter} />;

  const activeFilters = [
    ...(querySearch ? [{ key: 'search', label: `Search: ${querySearch}` }] : []),
    ...(role ? [{ key: 'role', label: `Role: ${roleLabel(role)}` }] : []),
    ...(status ? [{ key: 'status', label: `Status: ${status[0].toUpperCase()}${status.slice(1)}` }] : []),
    ...(passwordStatus ? [{ key: 'passwordStatus', label: `Password: ${passwordStatus === 'temporary' ? 'Temporary' : 'Normal'}` }] : []),
    ...(sort !== 'name' ? [{ key: 'sort', label: `Sort: ${{ newest: 'Newest', last_login: 'Last login', role: 'Role' }[sort] || sort}` }] : []),
  ];

  const changeSort = (next) => updateQuery({ sort: next, page: 1 });

  const handleRowAction = (action, selected) => {
    setActionError('');
    if (action === 'activity') {
      navigate(`/audit-logs?target_user_id=${encodeURIComponent(selected.user_id)}`);
      return;
    }
    if (action === 'reset') {
      openResetPassword(selected);
      return;
    }
    if (action === 'change-role') {
      openUserDrawer(selected.user_id, null, true);
      return;
    }
    if (action === 'edit') {
      openUserDrawer(selected.user_id, null, true);
      return;
    }
    setConfirmAction({ type: action, user: selected });
  };

  const handleOfflineDeviceAction = async (device, action) => {
    setOfflineDevicesError('');
    setSaving(true);
    try {
      const response = await api.post(
        `/users/${encodeURIComponent(detail.user_id)}/offline-devices/${encodeURIComponent(device.device_id)}/${action}`
      );
      if (!response.data?.success) throw new Error(response.data?.message || 'Unable to update device authorization.');
      const refreshed = await api.get(`/users/${encodeURIComponent(detail.user_id)}/offline-devices`);
      if (!refreshed.data?.success) throw new Error(refreshed.data?.message || 'Device updated but the list could not be refreshed.');
      const devices = refreshed.data.data || [];
      setOfflineDevices(devices);
      offlineDevicesCacheRef.current.set(String(detail.user_id), devices);
      setToast(response.data.message || (action === 'approve' ? 'Device approved.' : 'Device revoked.'));
      return true;
    } catch (error) {
      console.error('Unable to update device authorization.', error);
      setOfflineDevicesError(error);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const openResetPassword = (target) => {
    setResetPasswordMode('generated');
    setResetPassword('');
    setAdminPassword('');
    setActionError('');
    setConfirmAction({ type: 'reset', user: target });
  };

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    const { type, user: target } = confirmAction;
    setSaving(true);
    setActionError('');
    try {
      if (type === 'reset') {
        const payload = {
          current_password: adminPassword,
          password_mode: resetPasswordMode,
          ...(resetPasswordMode === 'manual' ? { password: resetPassword } : {}),
        };
        const response = await api.post(`/users/${target.user_id}/reset-password`, payload);
        setCredentials({ username: target.username, password: response.data.data.temporary_password, expires_at: response.data.data.expires_at, source: 'reset' });
        setConfirmAction(null);
        setAdminPassword('');
        setResetPassword('');
        updateQuery({ drawer: 'credentials', user: target.user_id }, false);
        setToast('Password reset. Copy the temporary password now.');
        await fetchUsers();
        return;
      }
      const endpoint = {
        deactivate: 'deactivate',
        reactivate: 'reactivate',
        unlock: 'unlock',
        'logout-all': 'logout-all',
      }[type];
      const response = await api.post(`/users/${target.user_id}/${endpoint}`);
      if (!response.data?.success) throw new Error(response.data?.message || 'The action could not be completed.');
      setConfirmAction(null);
      setToast(type === 'deactivate' ? 'User deactivated.' : type === 'reactivate' ? 'User reactivated.' : type === 'unlock' ? 'User unlocked.' : 'All sessions signed out.');
      setDetail(null);
      await fetchUsers();
      if (type === 'logout-all' && Number(target.user_id) === Number(currentUser?.user_id)) {
        await logout();
        navigate('/login', { replace: true });
      }
    } catch (error) {
      console.error('Unable to complete user action.', error);
      setActionError(error);
    } finally {
      setSaving(false);
    }
  };

  const handleEditSave = async (event) => {
    event.preventDefault();
    if (!detail) return;
    setEditErrors({});
    if (editUsernameCheck.available !== true) return;
    setSaving(true);
    try {
      const response = await api.put(`/users/${detail.user_id}`, {
        full_name: editForm.full_name.trim(),
        username: editForm.username.trim(),
        role: editForm.role,
      });
      if (!response.data?.success) throw new Error(response.data?.message || 'Unable to save changes.');
      setToast(editForm.role !== detail.role ? 'User updated and role changed.' : 'User updated.');
      if (Number(detail.user_id) === Number(currentUser?.user_id) && editForm.username.trim() !== detail.username) {
        await logout();
        navigate('/login', { replace: true, state: { message: 'Your username was changed. Sign in again with your new username.' } });
        return;
      }
      setEditMode(false);
      const updatedResponse = await api.get(`/users/${detail.user_id}`);
      setDetail(updatedResponse.data.data);
      const saved = { full_name: editForm.full_name.trim(), username: editForm.username.trim(), role: editForm.role };
      setEditForm(saved);
      setSavedEditForm(saved);
      await fetchUsers();
    } catch (error) {
      setEditErrors(error.response?.data?.fieldErrors || {});
      console.error('Unable to save user changes.', error);
      setActionError(error);
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    setNewErrors({});
    if (newUsernameCheck.available !== true || (newForm.password_mode === 'manual' && !Object.values(normalizePassword(newForm.password)).every(Boolean))) return;
    setSaving(true);
    setActionError('');
    try {
      const response = await api.post('/users', {
        full_name: newForm.full_name.trim(),
        username: newForm.username.trim(),
        contact_number: newForm.contact_number.trim(),
        email: newForm.email.trim(),
        role: newForm.role,
        password_mode: newForm.password_mode,
        ...(newForm.password_mode === 'manual' ? { password: newForm.password } : {}),
      });
      const created = response.data.data;
      setCredentials({
        username: created.user.username,
        password: created.temporary_password,
        expires_at: created.user.temp_password_expires_at,
        expires_in_hours: created.user.temp_password_expires_in_hours,
        source: 'create',
      });
      setNewForm(EMPTY_NEW_USER);
      setToast('User created. Copy the temporary password now.');
      updateQuery({ drawer: 'credentials', user: created.user.user_id, page: 1 }, false);
      await fetchUsers();
    } catch (error) {
      setNewErrors(error.response?.data?.fieldErrors || {});
      console.error('Unable to create user.', error);
      setActionError(error);
    } finally {
      setSaving(false);
    }
  };

  const pageCount = Math.ceil(total / pageSize);
  const first = total ? ((page - 1) * pageSize) + 1 : 0;
  const last = Math.min(page * pageSize, total);
  const tempPasswordExpired = (entry) => Boolean(entry.must_change_password && (
    typeof entry.temp_password_expired === 'boolean'
      ? entry.temp_password_expired
      : entry.temp_password_expires_at && new Date(entry.temp_password_expires_at).getTime() <= Date.now()
  ));
  const updateNewForm = (key, value) => setNewForm((current) => ({ ...current, [key]: value }));
  const updateEditForm = (key, value) => setEditForm((current) => ({ ...current, [key]: value }));

  const getDrawer = () => {
    if (drawerMode === 'new') {
      const passwordValid = newForm.password_mode !== 'manual' || Object.values(normalizePassword(newForm.password)).every(Boolean);
      const formValid = newForm.full_name.trim().length >= 2 && /^[A-Za-z0-9._-]{3,32}$/.test(newForm.username.trim())
        && newForm.contact_number.trim().length > 0 && newForm.email.trim().length > 0
        && newUsernameCheck.available === true && passwordValid;
      return (
        <AccessibleModal title="Add user" onClose={requestCloseDrawer} className="users-add-modal" returnFocusRef={triggerRef}
          headerContent={({ titleId, onClose }) => (
            <div className="users-modal-heading users-modal-heading-copy">
              <div><span className="users-eyebrow">SYSTEM ACCESS</span><h2 id={titleId}>Add user</h2><p>Create a HealthSync account for a staff member.</p></div>
              <button type="button" className="users-icon-button" aria-label="Close add user dialog" onClick={onClose}><X size={19} aria-hidden="true" /></button>
            </div>
          )}>
          <form className="users-modal-content users-add-form" onSubmit={handleCreate} noValidate>
            {actionError && <StatusBanner error={actionError} compact />}
            <div className="users-form-field">
              <label htmlFor="new-full-name">Full name</label>
              <input id="new-full-name" autoComplete="name" maxLength="120" value={newForm.full_name} onChange={(event) => updateNewForm('full_name', event.target.value)} aria-invalid={Boolean(newErrors.full_name)} />
              {newErrors.full_name && <small className="users-field-error">{newErrors.full_name}</small>}
            </div>
            <div className="users-form-field">
              <label htmlFor="new-contact-number">Contact number</label>
              <input id="new-contact-number" type="tel" autoComplete="tel" maxLength="32" required value={newForm.contact_number} onChange={(event) => updateNewForm('contact_number', event.target.value)} aria-invalid={Boolean(newErrors.contact_number)} />
              {newErrors.contact_number && <small className="users-field-error">{newErrors.contact_number}</small>}
              {!newErrors.contact_number && <small className="users-field-hint">Required for every new account.</small>}
            </div>
            <div className="users-form-field">
              <label htmlFor="new-email">Email address</label>
              <input id="new-email" type="email" autoComplete="email" maxLength="254" required value={newForm.email} onChange={(event) => updateNewForm('email', event.target.value)} aria-invalid={Boolean(newErrors.email)} />
              {newErrors.email && <small className="users-field-error">{newErrors.email}</small>}
              {!newErrors.email && <small className="users-field-hint">Required for every new account.</small>}
            </div>
            <div className="users-form-field">
              <div className="users-field-label-row"><label htmlFor="new-username">Username</label>
                {suggestUsername(newForm.full_name) && <button type="button" className="users-text-button" onClick={() => updateNewForm('username', suggestUsername(newForm.full_name))}>Use suggestion: {suggestUsername(newForm.full_name)}</button>}
              </div>
              <input id="new-username" autoComplete="off" maxLength="32" value={newForm.username} onChange={(event) => updateNewForm('username', event.target.value)} aria-invalid={Boolean(newErrors.username || newUsernameCheck.available === false)} aria-describedby="new-username-status" />
              <small id="new-username-status" className={newUsernameCheck.error || newErrors.username || newUsernameCheck.available === false ? 'users-field-error' : 'users-field-hint'}>
                {newErrors.username || newUsernameCheck.error || (newUsernameCheck.checking ? 'Checking availability…' : newUsernameCheck.available ? 'Username is available.' : newUsernameCheck.available === false ? 'That username is already in use.' : '3-32 letters, numbers, dots, underscores, or hyphens.')}
              </small>
            </div>
            <RoleSelector value={newForm.role} onChange={(value) => updateNewForm('role', value)} idPrefix="new" />
            {newErrors.role && <small className="users-field-error">{newErrors.role}</small>}
            <section className="users-temporary-section">
              <div><h3>Temporary password</h3><p>The user will be asked to choose their own password at first login.</p></div>
              <div className="users-password-mode" role="group" aria-label="Temporary password mode">
                <button type="button" className={newForm.password_mode === 'generated' ? 'selected' : ''} onClick={() => updateNewForm('password_mode', 'generated')}>Generate on server</button>
                <button type="button" className={newForm.password_mode === 'manual' ? 'selected' : ''} onClick={() => updateNewForm('password_mode', 'manual')}>Set manually</button>
              </div>
              {newForm.password_mode === 'generated'
                ? <p className="users-generated-note">A secure, readable temporary password will be generated when the account is created.</p>
                : <><PasswordInput id="new-temporary-password" value={newForm.password} onChange={(value) => updateNewForm('password', value)} />
                  {newErrors.password && <small className="users-field-error">{newErrors.password}</small>}</>}
            </section>
            <div className="users-modal-footer">
              <button type="button" className="users-button users-button-outline" onClick={requestCloseDrawer}>Cancel</button>
              <button type="submit" className="users-button users-button-primary" disabled={!formValid || saving}>
                {saving ? <><span className="users-spinner" aria-hidden="true" /> Creating…</> : 'Create user'}
              </button>
            </div>
          </form>
        </AccessibleModal>
      );
    }

    if (drawerMode === 'credentials') {
      const available = Boolean(credentials?.password);
      const copyText = async (value) => {
        try {
          await navigator.clipboard.writeText(value);
          setToast(value === credentials?.password ? 'Temporary password copied.' : 'Credentials copied.');
        } catch (error) {
          setActionError('Clipboard access is unavailable. Select and copy the credentials manually.');
        }
      };
      return (
        <AccessibleModal title={available ? 'Share these credentials' : 'Credentials unavailable'}
          onClose={requestCloseDrawer} className="users-credentials-modal" returnFocusRef={triggerRef}
          headerContent={({ titleId, onClose }) => (
            <div className="users-modal-heading users-modal-heading-copy">
              <div><span className="users-eyebrow">ACCOUNT READY</span><h2 id={titleId}>{available ? 'Share these credentials' : 'Credentials unavailable'}</h2></div>
              <button type="button" className="users-icon-button" aria-label="Close credentials dialog" onClick={onClose}><X size={19} aria-hidden="true" /></button>
            </div>
          )}>
          <div className="users-modal-content users-credentials-content">
            {available ? <>
              <div className="users-credentials-warning" role="alert"><strong>This password is shown only once.</strong><span>Copy or print it now. Closing this screen permanently discards it.</span></div>
              <div className="users-credential-line"><span>Username</span><strong>{credentials.username}</strong></div>
              <div className="users-secret-box">
                <span>Temporary password</span>
                <code aria-label={`Temporary password for ${credentials.username}`}>{credentials.password}</code>
                <button type="button" className="users-button users-button-outline" onClick={() => copyText(credentials.password)}>Copy password</button>
              </div>
              <div className="users-credential-actions">
                <button type="button" className="users-button users-button-outline" onClick={() => copyText(`Username: ${credentials.username}\nTemporary password: ${credentials.password}`)}>Copy credentials</button>
                <button type="button" className="users-button users-button-primary" onClick={() => window.print()}>Print credentials slip</button>
              </div>
              <p className="users-expiry-note">Temporary password expires in {credentials.expires_in_hours || 72} hours if it is not used.</p>
              <div className="users-credentials-print" aria-hidden="true">
                <h1>HealthSync</h1><p>Barangay Health Monitoring</p><hr />
                <dl><dt>Username</dt><dd>{credentials.username}</dd><dt>Temporary password</dt><dd>{credentials.password}</dd><dt>Login URL</dt><dd>{`${window.location.origin}/login`}</dd></dl>
                <p>Sign in using these credentials. You will be asked to choose your own password at first login.</p>
              </div>
            </> : <div className="users-empty-state"><strong>For your security, the password is not recoverable.</strong><p>Generate a new temporary password by resetting this user’s password.</p></div>}
            {actionError && <StatusBanner error={actionError} compact />}
            <div className="users-modal-footer"><button type="button" className="users-button users-button-primary" onClick={requestCloseDrawer}>Done</button></div>
          </div>
        </AccessibleModal>
      );
    }

    if (drawerMode !== 'user' || !selectedUserId) return null;
    return (
      <AccessibleModal title={detail?.full_name || 'User details'} onClose={requestCloseDrawer} className="users-detail-modal" returnFocusRef={triggerRef}
        headerContent={({ titleId, onClose }) => (
          <div className="users-modal-heading users-user-modal-heading">
            <div className="users-modal-identity">
              {detail ? <Avatar user={detail} size="large" /> : <span className="users-avatar users-avatar-large users-avatar-placeholder" aria-hidden="true" />}
              <div className="users-modal-identity-copy">
                <span className="users-eyebrow">USER ACCOUNT</span>
                <h2 id={titleId}>{detail?.full_name || 'User details'}</h2>
                <p>{detail ? `@${detail.username}` : detailLoading ? 'Loading user details…' : 'Profile details unavailable'}</p>
                {detail && <div className="users-heading-badges"><RoleBadge role={detail.role} /><StatusBadge user={detail} /></div>}
              </div>
            </div>
            <button type="button" className="users-icon-button" aria-label="Close user details" onClick={onClose}><X size={19} aria-hidden="true" /></button>
          </div>
        )}>
        <div className="users-detail-tabs" role="tablist" aria-label="User detail sections">
          {['profile', 'security', 'activity'].map((tab) => <button key={tab} id={`user-detail-tab-${tab}`} type="button" role="tab"
            aria-selected={detailTab === tab} aria-controls="users-detail-panel" tabIndex={detailTab === tab ? 0 : -1}
            ref={(element) => { detailTabRefs.current[tab] = element; }}
            className={detailTab === tab ? 'active' : ''} onClick={() => selectDetailTab(tab)}
            onKeyDown={(event) => handleDetailTabKeyDown(event, tab)}>
            {tab === 'profile' ? <UserRound size={16} aria-hidden="true" />
              : tab === 'security' ? <KeyRound size={16} aria-hidden="true" />
                : <Activity size={16} aria-hidden="true" />}
            {tab === 'profile' ? 'Profile' : tab === 'security' ? 'Security' : 'Recent activity'}
          </button>)}
        </div>
        <div id="users-detail-panel" role="tabpanel" aria-labelledby={`user-detail-tab-${detailTab}`} tabIndex="0" className="users-modal-content users-detail-content">
          {detailLoading && <div className="users-detail-skeleton" aria-label="Loading user details"><span /><span /><span /><span /></div>}
          {!detailLoading && detailError && <StatusBanner error={detailError} retry={() => setDetailReload((current) => current + 1)} compact />}
          {!detailLoading && detail && detailTab === 'profile' && <>
            {detail.protected && <div className="users-protected-chip" title="The primary HealthSync admin account is managed through its own Settings page."><ShieldCheck size={13} aria-hidden="true" /> Protected — managed through Settings</div>}
            {editMode ? (
              <form className="users-edit-form" onSubmit={handleEditSave} noValidate>
                <div className="users-form-field"><label htmlFor="edit-full-name">Full name</label>
                  <input id="edit-full-name" maxLength="120" value={editForm.full_name} onChange={(event) => updateEditForm('full_name', event.target.value)} aria-invalid={Boolean(editErrors.full_name)} />
                  {editErrors.full_name && <small className="users-field-error">{editErrors.full_name}</small>}
                </div>
                <div className="users-form-field"><label htmlFor="edit-username">Username</label>
                  <input id="edit-username" maxLength="32" value={editForm.username} onChange={(event) => updateEditForm('username', event.target.value)} aria-invalid={Boolean(editErrors.username || editUsernameCheck.available === false)} />
                  <small className={editErrors.username || editUsernameCheck.error || editUsernameCheck.available === false ? 'users-field-error' : 'users-field-hint'}>
                    {editErrors.username || editUsernameCheck.error || (editUsernameCheck.checking ? 'Checking availability…' : editUsernameCheck.available ? 'Username is available.' : editUsernameCheck.available === false ? 'That username is already in use.' : '3-32 letters, numbers, dots, underscores, or hyphens.')}
                  </small>
                </div>
                <RoleSelector value={editForm.role} onChange={(value) => updateEditForm('role', value)}
                  disabled={Boolean(detail.protected || Number(detail.user_id) === Number(currentUser?.user_id))} idPrefix="edit" />
                {editErrors.role && <small className="users-field-error">{editErrors.role}</small>}
                {actionError && <StatusBanner error={actionError} compact />}
                <div className="users-detail-save-bar">
                  <button type="button" className="users-button users-button-outline" onClick={() => { setEditForm(savedEditForm); setEditMode(false); setEditErrors({}); }}>Cancel</button>
                  <button type="submit" className="users-button users-button-primary" disabled={!isEditDirty || editUsernameCheck.available !== true || saving}>
                    {saving ? <><span className="users-spinner" aria-hidden="true" /> Saving…</> : 'Save changes'}
                  </button>
                </div>
              </form>
            ) : <>
              <div className="users-detail-groups">
                <section className="users-detail-group" aria-labelledby="users-personal-heading">
                  <h3 id="users-personal-heading"><UserRound size={16} aria-hidden="true" /> Personal information</h3>
                  <dl className="users-detail-list">
                    <div><dt>Full name</dt><dd>{detail.full_name}</dd></div>
                    <div><dt>Username</dt><dd>@{detail.username}</dd></div>
                    <div><dt>Contact number</dt><dd>{detail.contact_number || 'Not provided'}</dd></div>
                    <div><dt>Email address</dt><dd>{detail.email || 'Not provided'}</dd></div>
                  </dl>
                </section>
                <section className="users-detail-group" aria-labelledby="users-account-heading">
                  <h3 id="users-account-heading"><ShieldCheck size={16} aria-hidden="true" /> Account information</h3>
                  <dl className="users-detail-list">
                    <div><dt>Account role</dt><dd><RoleBadge role={detail.role} /></dd></div>
                    <div><dt>Account status</dt><dd><StatusBadge user={detail} /></dd></div>
                    <div><dt>Account created</dt><dd><ExactDate value={detail.created_at} /></dd></div>
                    <div><dt>Created by</dt><dd>{detail.created_by_name || 'System setup'}</dd></div>
                  </dl>
                </section>
              </div>
              <div className="users-detail-actions">
                <button type="button" className="users-button users-button-primary" disabled={detail.protected} title={detail.protected ? 'The primary admin is managed through Settings.' : undefined} onClick={() => setEditMode(true)}>Edit profile</button>
                <button type="button" className="users-button users-button-outline" onClick={() => handleRowAction('activity', detail)}>View activity</button>
              </div>
            </>}
          </>}
          {!detailLoading && detail && detailTab === 'security' && <>
            <div className="users-security-grid">
              <div><span>Last login</span><strong>{detail.last_login_at ? <RelativeDate value={detail.last_login_at} /> : 'Never'}</strong></div>
              <div><span>Last password change</span><strong>{detail.password_changed_at ? <RelativeDate value={detail.password_changed_at} /> : 'Not recorded'}</strong></div>
              <div><span>Password status</span><strong>{detail.must_change_password ? (tempPasswordExpired(detail) ? 'Temporary — expired' : 'Temporary — must change') : 'Normal'}</strong></div>
              <div><span>Failed attempts</span><strong>{Number(detail.failed_login_attempts || 0)}</strong></div>
              <div><span>Locked until</span><strong>{detail.is_locked ? <RelativeDate value={detail.locked_until} /> : 'Not locked'}</strong></div>
              <div><span>Active sessions</span><strong>{detail.active_sessions}</strong></div>
            </div>
            {detail.must_change_password && tempPasswordExpired(detail) && <div className="users-inline-alert" role="status">This temporary password has expired. Reset it to issue a new one.</div>}
            <div className="users-security-actions">
              {detail.is_locked && <button type="button" className="users-button users-button-outline" onClick={() => setConfirmAction({ type: 'unlock', user: detail })}>Unlock account</button>}
              <button type="button" className="users-button users-button-outline" onClick={() => openResetPassword(detail)} disabled={detail.protected || Number(detail.user_id) === Number(currentUser?.user_id)}>Reset password</button>
              <button type="button" className="users-button users-button-outline" onClick={() => setConfirmAction({ type: 'logout-all', user: detail })}>Log out of all devices</button>
            </div>
            <section className="users-offline-devices" aria-label="Offline authorized devices">
              <h3>Offline authorized devices</h3>
              <p>Revoked devices lose access when they reconnect. A disconnected device may remain usable until then.</p>
              {offlineDevicesError && <StatusBanner error={offlineDevicesError} compact />}
              {offlineDevicesLoading ? <p>Loading devices…</p> : offlineDevices.length ? (
                <ul>
                  {offlineDevices.map((device) => (
                    <li key={device.device_id}>
                      <span>
                        <strong>{device.status === 'PENDING' ? 'Approval required' : device.status === 'REVOKED' ? 'Revoked' : 'Authorized'}</strong>
                        {' · '}
                        {device.last_seen_at ? `Last connected ${formatRelativeTime(device.last_seen_at)}` : `Added ${formatDateTime(device.created_at)}`}
                        {device.device_id === currentUser?.device_id && ' · Current device'}
                      </span>
                      <span>
                        {device.status === 'PENDING' && <button type="button" className="users-button users-button-outline" disabled={saving} onClick={() => setDeviceConfirm({ device, action: 'approve' })}>Approve</button>}
                        {device.status === 'ACTIVE' && device.device_id !== currentUser?.device_id && <button type="button" className="users-button users-button-danger-outline" disabled={saving} onClick={() => setDeviceConfirm({ device, action: 'revoke' })}>Revoke</button>}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <p>No device registrations.</p>}
            </section>
          </>}
          {!detailLoading && detail && detailTab === 'activity' && <>
            {detail.activity?.length ? <ul className="users-activity-list">{detail.activity.map((item) => (
              <li key={item.audit_id}><span className="users-activity-dot" aria-hidden="true" /><div><strong>{describeAuditAction(item.action)}</strong><p>{item.description || 'Account activity recorded.'}{item.actor_name ? ` · by ${item.actor_name}` : ''}</p><div className="users-activity-meta"><RelativeDate value={item.created_at} empty="Unknown time" />{item.status && <span>{String(item.status).replace(/[_-]+/g, ' ')}</span>}</div></div></li>
            ))}</ul> : <div className="users-empty-state"><strong>No recent activity</strong><p>Account events will appear here as they occur.</p></div>}
            <button type="button" className="users-text-button users-view-all" onClick={() => navigate(`/audit-logs?target_user_id=${encodeURIComponent(detail.user_id)}`)}>View all activity in Audit Logs</button>
          </>}
        </div>
      </AccessibleModal>
    );
  };

  const selectedActionName = confirmAction?.type === 'deactivate' ? 'Deactivate user'
    : confirmAction?.type === 'reactivate' ? 'Reactivate user'
      : confirmAction?.type === 'unlock' ? 'Unlock account'
        : confirmAction?.type === 'logout-all' ? 'Log out of all devices' : 'Reset password';
  const selectedActionBody = confirmAction?.type === 'deactivate'
    ? `${confirmAction.user.full_name} will no longer be able to log in and will be signed out immediately.`
    : confirmAction?.type === 'reactivate' ? `Restore sign-in access for ${confirmAction?.user.full_name}?`
      : confirmAction?.type === 'unlock' ? `Clear the lockout and failed login attempts for ${confirmAction?.user.full_name}?`
        : confirmAction?.type === 'logout-all' ? `All active sessions for ${confirmAction?.user.full_name} will be signed out.`
          : `A new temporary password will be generated for ${confirmAction?.user.full_name}. Their active sessions will be signed out, and they must choose a new password at their next login.`;

  return (
    <div className="users-page">
      <header className="users-page-header">
        <div><span className="users-eyebrow">SYSTEM MANAGEMENT</span><h1>System Users</h1>
          <p>Manage HealthSync accounts, roles, and access permissions. <span aria-live="polite">{formatCount(counts.total)} total users</span></p></div>
        <button type="button" className="users-button users-button-primary users-add-button" onClick={openNewDrawer}><Plus size={17} aria-hidden="true" /> Add user</button>
      </header>

      <section className="users-summary" aria-label="User account summaries">
        {[
          { key: 'total', label: 'Total Users', value: counts.total, Icon: Users },
          { key: 'active', label: 'Active Users', value: counts.active, Icon: Check },
          { key: 'bhw', label: 'BHW Accounts', value: getRoleCount(roleCounts, 'bhw') ?? '—', Icon: HeartPulse },
          { key: 'official', label: 'Official Accounts', value: getRoleCount(roleCounts, 'official') ?? '—', Icon: Building2 },
        ].map((chip) => {
          const selected = chip.key === 'total'
            ? activeFilters.length === 0
            : chip.key === 'active' ? status === 'active'
              : role === chip.key;
          return <button type="button" key={chip.key} className={`users-summary-chip ${selected ? 'selected' : ''}`} aria-pressed={selected}
            onClick={() => chip.key === 'total'
              ? clearFilters()
              : chip.key === 'active'
                ? updateQuery({ status: 'active', passwordStatus: null, page: 1 })
                : updateQuery({ role: chip.key, page: 1 })}>
            <span className={`users-summary-icon users-summary-${chip.key}`} aria-hidden="true"><chip.Icon size={18} strokeWidth={2} /></span>
            <span><strong>{typeof chip.value === 'number' ? formatCount(chip.value) : chip.value}</strong><small>{chip.label}</small></span>
          </button>;
        })}
      </section>
      {roleSummaryError && <div className="users-summary-note" role="status">
        <span>Role totals are unavailable.</span>
        <button type="button" className="users-text-button" onClick={fetchRoleCounts}>Retry</button>
      </div>}

      {actionError && !drawerMode && <StatusBanner error={actionError} compact />}
      <section className="users-directory-card" aria-label="System users directory">
        <div className="users-directory-heading"><div><h2>System users</h2><p>Current access roster</p></div>
          <span className="users-result-count" aria-live="polite">{loading ? 'Updating users…' : `${total} result${total === 1 ? '' : 's'}`}</span>
        </div>
        <div className="users-toolbar">
          <label className="users-search" htmlFor="users-search-input">
            <Search size={17} className="users-search-icon" aria-hidden="true" />
            <input id="users-search-input" ref={searchRef} value={searchInput} onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search by name or username…" aria-label="Search users by name or username" />
            {!searchInput && <kbd aria-hidden="true">/</kbd>}
            {searchInput && <button type="button" aria-label="Clear search" onClick={() => { setSearchInput(''); updateQuery({ search: null, page: 1 }); }}><X size={15} aria-hidden="true" /></button>}
          </label>
          <div className="users-toolbar-filters">{roleFilterOptions}</div>
          <button type="button" className="users-mobile-filter-button" aria-haspopup="dialog" onClick={() => setMobileFiltersOpen(true)}>Filters{activeFilters.length > 0 && <span>{activeFilters.length}</span>}</button>
        </div>
        {!!activeFilters.length && <div className="users-active-filters" aria-label="Active filters">
          {activeFilters.map((filter) => <button type="button" key={filter.key} className="users-filter-chip" aria-label={`Remove ${filter.label} filter`}
            onClick={() => { updateQuery({ [filter.key]: filter.key === 'sort' ? 'name' : null, page: 1 }); if (filter.key === 'search') setSearchInput(''); }}>
            {filter.label}<span aria-hidden="true">×</span>
          </button>)}
          <button type="button" className="users-clear-filters" onClick={clearFilters}>Clear all</button>
        </div>}

        {loadError ? <StatusBanner error={loadError} retry={fetchUsers} /> : (
          <>
            <div className="users-table-wrap">
              <table className="users-table">
                <thead><tr>
                  <th scope="col" aria-sort={sort === 'name' ? 'ascending' : 'none'}><button type="button" onClick={() => changeSort('name')}>User{sort === 'name' && <span aria-hidden="true"> ↑</span>}</button></th>
                  <th scope="col" aria-sort={sort === 'role' ? 'ascending' : 'none'}><button type="button" onClick={() => changeSort('role')}>Role{sort === 'role' && <span aria-hidden="true"> ↑</span>}</button></th>
                  <th scope="col">Status</th>
                  <th scope="col" aria-sort={sort === 'last_login' ? 'descending' : 'none'}><button type="button" onClick={() => changeSort('last_login')}>Last login{sort === 'last_login' && <span aria-hidden="true"> ↓</span>}</button></th>
                  <th scope="col" className="users-password-col">Password</th>
                  <th scope="col" className="users-created-heading" aria-sort={sort === 'newest' ? 'descending' : 'none'}><button type="button" onClick={() => changeSort('newest')}>Created{sort === 'newest' && <span aria-hidden="true"> ↓</span>}</button></th>
                  <th scope="col"><span className="users-sr-only">Actions</span></th>
                </tr></thead>
                <tbody>
                  {loading ? Array.from({ length: 5 }, (_, index) => <tr className="users-skeleton-row" key={`skeleton-${index}`} aria-hidden="true">{Array.from({ length: 7 }, (_, cell) => <td key={cell}><span /></td>)}</tr>)
                    : users.length ? users.map((entry) => (
                      <tr key={entry.user_id} className={`users-data-row${selectedUserId === String(entry.user_id) ? ' is-selected' : ''}`} tabIndex="0" aria-label={`Open ${entry.full_name}, ${roleLabel(entry.role)}, ${userStatus(entry)}`}
                        onClick={(event) => openUserDrawer(entry.user_id, event)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openUserDrawer(entry.user_id, event); } }}>
                        <td><div className="users-user-cell"><Avatar user={entry} /><span><strong>{entry.full_name}</strong><small>@{entry.username}</small>
                          {entry.protected && <span className="users-protected-chip" title="The primary admin account is managed through its own Settings page."><ShieldCheck size={12} aria-hidden="true" /> Protected</span>}</span></div></td>
                        <td><RoleBadge role={entry.role} /></td>
                        <td><StatusBadge user={entry} /></td>
                        <td><RelativeDate value={entry.last_login_at} /></td>
                        <td className="users-password-col">{entry.must_change_password && <span className={`users-temp-chip ${tempPasswordExpired(entry) ? 'expired' : ''}`}>{tempPasswordExpired(entry) ? 'Expired' : 'Temporary · must change'}</span>}</td>
                        <td className="users-created-cell"><RelativeDate value={entry.created_at} empty="—" /></td>
                        <td><div className="users-row-actions" onClick={(event) => event.stopPropagation()}>
                          <button type="button" className="users-icon-button users-edit-icon" aria-label={`Edit ${entry.full_name}`} title="Edit user"
                            onClick={(event) => openUserDrawer(entry.user_id, event, true)}><Pencil size={15} aria-hidden="true" /></button>
                          <RowActionsMenu user={entry} currentUserId={currentUser?.user_id} activeAdmins={counts.active_admins || 0} onAction={handleRowAction} onTrigger={(event) => { triggerRef.current = event.currentTarget; }} />
                        </div></td>
                      </tr>
                    )) : <tr><td className="users-empty-cell" colSpan="7"><div className="users-empty-state"><strong>No users match your filters</strong><p>Try changing your search or filters.</p>
                      {activeFilters.length > 0 && <button type="button" className="users-button users-button-outline" onClick={clearFilters}>Clear filters</button>}</div></td></tr>}
                </tbody>
              </table>
            </div>
            {loading && <div className="users-mobile-list" aria-label="Loading users">{Array.from({ length: 3 }, (_, index) => <article className="users-mobile-card users-mobile-skeleton" key={`mobile-skeleton-${index}`} aria-hidden="true"><span /><span /><span /></article>)}</div>}
            {!loading && users.length > 0 && <div className="users-mobile-list">
              {users.map((entry) => <article className={`users-mobile-card${selectedUserId === String(entry.user_id) ? ' is-selected' : ''}`} key={`mobile-${entry.user_id}`} onClick={(event) => openUserDrawer(entry.user_id, event)} tabIndex="0"
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openUserDrawer(entry.user_id, event); } }}>
                <div className="users-mobile-card-top"><Avatar user={entry} /><div className="users-mobile-user"><strong>{entry.full_name}</strong><small>@{entry.username}</small><div><RoleBadge role={entry.role} /></div></div>
                  <div className="users-mobile-menu" onClick={(event) => event.stopPropagation()}><RowActionsMenu user={entry} currentUserId={currentUser?.user_id} activeAdmins={counts.active_admins || 0} onAction={handleRowAction} onTrigger={(event) => { triggerRef.current = event.currentTarget; }} /></div>
                </div>
                <div className="users-mobile-status"><StatusBadge user={entry} />{entry.must_change_password && <span className={`users-temp-chip ${tempPasswordExpired(entry) ? 'expired' : ''}`}>{tempPasswordExpired(entry) ? 'Expired' : 'Temporary · must change'}</span>}</div>
                <div className="users-mobile-last-login">Last login <RelativeDate value={entry.last_login_at} /></div>
              </article>)}
            </div>}
            {!loading && users.length > 0 && <Pagination currentPage={page} totalPages={pageCount} first={first} last={last} total={total}
              itemLabel="users" pageSize={pageSize} onPageSizeChange={(value) => updateQuery({ pageSize: value, page: 1 })}
              onPageChange={(value) => updateQuery({ page: value })} />}
          </>
        )}
      </section>

      {toast && <div className="users-toast" role="status" aria-live="polite">{toast}</div>}
      <span className="users-sr-only" aria-live="polite">{saving ? 'Saving user changes' : ''}</span>
      {getDrawer()}

      {mobileFiltersOpen && <AccessibleModal title="Filter users" className="users-mobile-filter-sheet" onClose={() => setMobileFiltersOpen(false)}>
        <div className="users-mobile-filter-fields">{roleFilterOptions}</div>
        <div className="users-modal-actions"><button type="button" className="users-button users-button-outline" onClick={clearFilters}>Clear filters</button>
          <button type="button" className="users-button users-button-primary" onClick={() => setMobileFiltersOpen(false)}>Show {total} results</button></div>
      </AccessibleModal>}

      {deviceConfirm && <AccessibleModal
        title={deviceConfirm.action === 'approve' ? 'Approve offline device?' : 'Revoke offline device?'}
        onClose={() => { if (!saving) setDeviceConfirm(null); }}>
        <div className="users-modal-body">
          <p>{deviceConfirm.action === 'approve'
            ? 'Allow this device to use the account’s offline access when it is disconnected?'
            : 'This device will lose offline access the next time it reconnects.'}</p>
          {offlineDevicesError && <StatusBanner error={offlineDevicesError} compact />}
        </div>
        <div className="users-modal-actions">
          <button type="button" className="users-button users-button-outline" disabled={saving} onClick={() => setDeviceConfirm(null)}>Cancel</button>
          <button type="button" className={deviceConfirm.action === 'revoke' ? 'users-button users-button-danger' : 'users-button users-button-primary'}
            disabled={saving}
            onClick={async () => {
              const succeeded = await handleOfflineDeviceAction(deviceConfirm.device, deviceConfirm.action);
              if (succeeded) setDeviceConfirm(null);
            }}>
            {saving ? <><span className="users-spinner" aria-hidden="true" /> Working…</> : deviceConfirm.action === 'approve' ? 'Approve device' : 'Revoke device'}
          </button>
        </div>
      </AccessibleModal>}

      {confirmAction && <AccessibleModal title={selectedActionName} onClose={() => { if (!saving) { setConfirmAction(null); setAdminPassword(''); setResetPassword(''); } }}>
        <div className="users-modal-body">
          <p>{selectedActionBody}</p>
          {confirmAction.type === 'reset' && <>
            <label className="users-filter-field"><span>Temporary password</span><select value={resetPasswordMode} onChange={(event) => setResetPasswordMode(event.target.value)}>
              <option value="generated">Generate a password on the server</option><option value="manual">Set one manually</option>
            </select></label>
            {resetPasswordMode === 'manual' && <PasswordInput id="reset-temporary-password" value={resetPassword} onChange={setResetPassword} />}
            <div className="users-form-field"><label htmlFor="admin-current-password">Your current password</label>
              <input id="admin-current-password" type="password" autoComplete="current-password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} /></div>
            <p className="users-modal-note">The reset signs out all active sessions. The user must choose a new password at next sign-in.</p>
          </>}
          {actionError && <StatusBanner error={actionError} compact />}
        </div>
        <div className="users-modal-actions">
          <button type="button" className="users-button users-button-outline" disabled={saving} onClick={() => setConfirmAction(null)}>Cancel</button>
          <button type="button" className={`users-button ${confirmAction.type === 'deactivate' ? 'users-button-danger' : 'users-button-primary'}`}
            disabled={saving || (confirmAction.type === 'reset' && (!adminPassword || (resetPasswordMode === 'manual' && !Object.values(normalizePassword(resetPassword)).every(Boolean))))}
            onClick={handleConfirmAction}>{saving ? <><span className="users-spinner" aria-hidden="true" /> Working…</> : confirmAction.type === 'reset' ? 'Reset password' : confirmAction.type === 'deactivate' ? 'Deactivate user' : confirmAction.type === 'reactivate' ? 'Reactivate user' : confirmAction.type === 'unlock' ? 'Unlock account' : 'Log out all devices'}</button>
        </div>
      </AccessibleModal>}

      {showLeaveConfirm && <AccessibleModal title="Discard unsaved changes?" onClose={keepEditing}>
        <div className="users-modal-body"><p>Your changes have not been saved. Leave this dialog and discard them?</p></div>
        <div className="users-modal-actions"><button type="button" className="users-button users-button-outline" onClick={keepEditing}>Keep editing</button>
          <button type="button" className="users-button users-button-danger" onClick={discardChangesAndContinue}>Discard changes</button></div>
      </AccessibleModal>}
    </div>
  );
};

export default UserManagementPage;
