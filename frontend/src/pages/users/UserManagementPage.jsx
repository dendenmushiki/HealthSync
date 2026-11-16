import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../services/api/apiClient';
import Pagination from '../../components/common/Pagination';
import { AuthContext } from '../../context/AuthContext';
import { formatDateTime, formatRelativeTime } from '../../utils/dateUtils';
import { getProfilePhotoUrl } from '../../utils/profilePhoto';
import './UserManagementPage.css';

const ROLES = [
  { value: 'admin', label: 'Admin', description: 'Manages system accounts, settings, and audit logs.' },
  { value: 'official', label: 'Official', description: 'Views dashboards, reports, and nutrition monitoring.' },
  { value: 'bhw', label: 'BHW', description: 'Records resident and health data for the barangay.' },
];
const EMPTY_NEW_USER = { full_name: '', username: '', role: 'bhw', password_mode: 'generated', password: '' };
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
    <span aria-hidden="true">{role === 'admin' ? '⌘' : role === 'official' ? '▤' : '＋'}</span>
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

const AccessibleModal = ({ title, onClose, children, className = '' }) => {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  const previousFocusRef = useRef(null);
  closeRef.current = onClose;

  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusables = () => Array.from(dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])') || []);
    const keydown = (event) => {
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
  }, []);

  return (
    <div className={`users-modal-backdrop ${className}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="users-modal" role="dialog" aria-modal="true" aria-labelledby="users-modal-title" tabIndex="-1">
        <div className="users-modal-heading">
          <h2 id="users-modal-title">{title}</h2>
          <button type="button" className="users-icon-button" aria-label="Close dialog" onClick={onClose}>×</button>
        </div>
        {children}
      </section>
    </div>
  );
};

const UserDrawer = ({ title, onClose, returnFocusRef, children, className = '' }) => {
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const returnTarget = returnFocusRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusables = () => Array.from(panelRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])') || []);
    const keydown = (event) => {
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
    requestAnimationFrame(() => (focusables()[0] || panelRef.current)?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', keydown);
      requestAnimationFrame(() => returnTarget?.focus?.());
    };
  }, [returnFocusRef]);

  return (
    <div className="users-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside ref={panelRef} className={`users-drawer ${className}`} role="dialog" aria-modal="true" aria-label={title} tabIndex="-1">
        {children}
      </aside>
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
        ref={triggerRef} aria-haspopup="menu" aria-expanded={open} onClick={(event) => { onTrigger?.(event); setOpen((state) => !state); }}>⋯</button>
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
  const [resetPasswordMode, setResetPasswordMode] = useState('generated');
  const [resetPassword, setResetPassword] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const triggerRef = useRef(null);
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
      setLoadError(error.response?.data?.message || error.message || 'Unable to load users.');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, passwordStatus, querySearch, role, sort, status]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  useEffect(() => {
    if (drawerMode !== 'user' || !selectedUserId) {
      setDetail(null);
      setDetailReload((current) => current + 1);
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
      .catch((error) => { if (active) setDetailError(error.response?.data?.message || error.message || 'Unable to load user details.'); })
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
        if (active) setNewUsernameCheck({ checking: false, available: null, error: error.response?.data?.message || 'Could not verify username availability.' });
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
        if (active) setEditUsernameCheck({ checking: false, available: null, error: error.response?.data?.message || 'Could not verify username availability.' });
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
    setCredentials(null);
    setEditMode(false);
    setNewForm(EMPTY_NEW_USER);
    updateQuery({ drawer: null, user: null }, false);
  };

  const requestCloseDrawer = () => {
    if (isDirty) setShowLeaveConfirm(true);
    else closeDrawer();
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
      setActionError(error.response?.data?.message || error.message || 'The action could not be completed.');
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
      setActionError(error.response?.data?.message || error.message || 'Unable to save changes.');
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
      setActionError(error.response?.data?.message || error.message || 'Unable to create user.');
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
        && newUsernameCheck.available === true && passwordValid;
      return (
        <UserDrawer title="Add user" onClose={requestCloseDrawer} returnFocusRef={triggerRef} className="users-add-drawer">
          <div className="users-drawer-header">
            <div><span className="users-eyebrow">SYSTEM ACCESS</span><h2>Add user</h2><p>Create a HealthSync account for a staff member.</p></div>
            <button type="button" className="users-icon-button" aria-label="Close add user drawer" onClick={requestCloseDrawer}>×</button>
          </div>
          <form className="users-drawer-content users-add-form" onSubmit={handleCreate} noValidate>
            {actionError && <div className="users-inline-alert" role="alert">{actionError}</div>}
            <div className="users-form-field">
              <label htmlFor="new-full-name">Full name</label>
              <input id="new-full-name" autoComplete="name" maxLength="120" value={newForm.full_name} onChange={(event) => updateNewForm('full_name', event.target.value)} aria-invalid={Boolean(newErrors.full_name)} />
              {newErrors.full_name && <small className="users-field-error">{newErrors.full_name}</small>}
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
            <div className="users-drawer-footer">
              <button type="button" className="users-button users-button-outline" onClick={requestCloseDrawer}>Cancel</button>
              <button type="submit" className="users-button users-button-primary" disabled={!formValid || saving}>
                {saving ? <><span className="users-spinner" aria-hidden="true" /> Creating…</> : 'Create user'}
              </button>
            </div>
          </form>
        </UserDrawer>
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
        <UserDrawer title="One-time credentials" onClose={requestCloseDrawer} returnFocusRef={triggerRef} className="users-credentials-drawer">
          <div className="users-drawer-header">
            <div><span className="users-eyebrow">ACCOUNT READY</span><h2>{available ? 'Share these credentials' : 'Credentials unavailable'}</h2></div>
            <button type="button" className="users-icon-button" aria-label="Close credentials" onClick={requestCloseDrawer}>×</button>
          </div>
          <div className="users-drawer-content">
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
            {actionError && <div className="users-inline-alert" role="alert">{actionError}</div>}
            <div className="users-drawer-footer"><button type="button" className="users-button users-button-primary" onClick={requestCloseDrawer}>Done</button></div>
          </div>
        </UserDrawer>
      );
    }

    if (drawerMode !== 'user' || !selectedUserId) return null;
    return (
      <UserDrawer title={detail?.full_name || 'User details'} onClose={requestCloseDrawer} returnFocusRef={triggerRef} className="users-detail-drawer">
        <div className="users-drawer-header users-detail-heading">
          <button type="button" className="users-icon-button" aria-label="Close user details" onClick={requestCloseDrawer}>×</button>
          {detail && <div className="users-profile-heading"><Avatar user={detail} size="large" /><div><h2>{detail.full_name}</h2><p>@{detail.username}</p><div className="users-heading-badges"><RoleBadge role={detail.role} /><StatusBadge user={detail} /></div></div></div>}
          {!detail && <h2>User details</h2>}
        </div>
        <div className="users-detail-tabs" role="tablist" aria-label="User detail sections">
          {['profile', 'security', 'activity'].map((tab) => <button key={tab} type="button" role="tab" aria-selected={detailTab === tab}
            className={detailTab === tab ? 'active' : ''} onClick={() => { setDetailTab(tab); setEditMode(false); }}>
            {tab === 'profile' ? 'Profile' : tab === 'security' ? 'Security' : 'Recent activity'}
          </button>)}
        </div>
        <div className="users-drawer-content users-detail-content">
          {detailLoading && <div className="users-detail-skeleton" aria-label="Loading user details"><span /><span /><span /><span /></div>}
          {!detailLoading && detailError && <div className="users-error-state" role="alert"><p>{detailError}</p>          <button type="button" className="users-button users-button-outline" onClick={() => setDetailReload((current) => current + 1)}>Try again</button></div>}
          {!detailLoading && detail && detailTab === 'profile' && <>
            {detail.protected && <div className="users-protected-chip" title="The primary HealthSync admin account is managed through its own Settings page.">🔒 Protected — managed through Settings</div>}
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
                {actionError && <div className="users-inline-alert" role="alert">{actionError}</div>}
                <div className="users-detail-save-bar">
                  <button type="button" className="users-button users-button-outline" onClick={() => { setEditForm(savedEditForm); setEditMode(false); setEditErrors({}); }}>Cancel</button>
                  <button type="submit" className="users-button users-button-primary" disabled={!isEditDirty || editUsernameCheck.available !== true || saving}>
                    {saving ? <><span className="users-spinner" aria-hidden="true" /> Saving…</> : 'Save changes'}
                  </button>
                </div>
              </form>
            ) : <>
              <dl className="users-detail-list">
                <div><dt>Full name</dt><dd>{detail.full_name}</dd></div><div><dt>Username</dt><dd>@{detail.username}</dd></div>
                <div><dt>Role</dt><dd><RoleBadge role={detail.role} /></dd></div>
                <div><dt>Created</dt><dd><RelativeDate value={detail.created_at} empty="Not recorded" /></dd></div>
                <div><dt>Created by</dt><dd>{detail.created_by_name || 'System setup'}</dd></div>
              </dl>
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
          </>}
          {!detailLoading && detail && detailTab === 'activity' && <>
            {detail.activity?.length ? <ul className="users-activity-list">{detail.activity.map((item) => (
              <li key={item.audit_id}><span className="users-activity-dot" aria-hidden="true" /><div><strong>{String(item.action).replace(/_/g, ' ')}</strong><p>{item.description || 'Account activity recorded.'}{item.actor_name ? ` · by ${item.actor_name}` : ''}</p><RelativeDate value={item.created_at} empty="Unknown time" /></div></li>
            ))}</ul> : <div className="users-empty-state"><strong>No recent activity</strong><p>Account events will appear here as they occur.</p></div>}
            <button type="button" className="users-text-button users-view-all" onClick={() => navigate(`/audit-logs?target_user_id=${encodeURIComponent(detail.user_id)}`)}>View all activity in Audit Logs</button>
          </>}
        </div>
      </UserDrawer>
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
        <div><span className="users-eyebrow">SYSTEM MANAGEMENT</span><h1>Users</h1>
          <p>Manage who can access HealthSync. <span aria-live="polite">{counts.total} users · {counts.active} active</span></p></div>
        <button type="button" className="users-button users-button-primary users-add-button" onClick={openNewDrawer}><span aria-hidden="true">＋</span> Add user</button>
      </header>

      <section className="users-summary" aria-label="User account summaries">
        {[
          { key: 'total', label: 'Total', value: counts.total, filters: { status: null, passwordStatus: null } },
          { key: 'active', label: 'Active', value: counts.active, filters: { status: 'active', passwordStatus: null } },
          { key: 'inactive', label: 'Inactive', value: counts.inactive, filters: { status: 'inactive', passwordStatus: null } },
          { key: 'locked', label: 'Locked', value: counts.locked, filters: { status: 'locked', passwordStatus: null } },
          { key: 'temporary', label: 'Must change password', value: counts.temporary, filters: { status: null, passwordStatus: 'temporary' } },
        ].map((chip) => {
          const active = chip.key === 'total' ? !status && !passwordStatus : chip.key === 'temporary' ? passwordStatus === 'temporary' : status === chip.key;
          const selected = chip.key === 'total' ? activeFilters.length === 0 : active;
          return <button type="button" key={chip.key} className={`users-summary-chip ${selected ? 'selected' : ''}`} aria-pressed={selected}
            onClick={() => chip.key === 'total' ? clearFilters() : updateQuery({ ...chip.filters, page: 1 })}>
            <span className={`users-summary-icon users-summary-${chip.key}`} aria-hidden="true">{({ total: '◉', active: '✓', inactive: '○', locked: '⌑', temporary: '⟳' })[chip.key]}</span>
            <span><strong>{chip.value}</strong><small>{chip.label}</small></span>
          </button>;
        })}
      </section>

      {actionError && !drawerMode && <div className="users-page-alert" role="alert">{actionError}<button type="button" aria-label="Dismiss error" onClick={() => setActionError('')}>×</button></div>}
      <section className="users-directory-card" aria-label="System users directory">
        <div className="users-directory-heading"><div><h2>System users</h2><p>Current access roster</p></div>
          <span className="users-result-count" aria-live="polite">{loading ? 'Updating users…' : `${total} result${total === 1 ? '' : 's'}`}</span>
        </div>
        <div className="users-toolbar">
          <label className="users-search" htmlFor="users-search-input">
            <span className="users-search-icon" aria-hidden="true">⌕</span>
            <input id="users-search-input" ref={searchRef} value={searchInput} onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search by name or username…" aria-label="Search users by name or username" />
            {!searchInput && <kbd aria-hidden="true">/</kbd>}
            {searchInput && <button type="button" aria-label="Clear search" onClick={() => { setSearchInput(''); updateQuery({ search: null, page: 1 }); }}>×</button>}
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

        {loadError ? <div className="users-error-state" role="alert"><strong>Couldn’t load users</strong><p>{loadError}</p><button type="button" className="users-button users-button-outline" onClick={fetchUsers}>Try again</button></div> : (
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
                      <tr key={entry.user_id} className="users-data-row" tabIndex="0" aria-label={`Open ${entry.full_name}, ${roleLabel(entry.role)}, ${userStatus(entry)}`}
                        onClick={(event) => openUserDrawer(entry.user_id, event)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openUserDrawer(entry.user_id, event); } }}>
                        <td><div className="users-user-cell"><Avatar user={entry} /><span><strong>{entry.full_name}</strong><small>@{entry.username}</small>
                          {entry.protected && <span className="users-protected-chip" title="The primary admin account is managed through its own Settings page.">🔒 Protected</span>}</span></div></td>
                        <td><RoleBadge role={entry.role} /></td>
                        <td><StatusBadge user={entry} /></td>
                        <td><RelativeDate value={entry.last_login_at} /></td>
                        <td className="users-password-col">{entry.must_change_password && <span className={`users-temp-chip ${tempPasswordExpired(entry) ? 'expired' : ''}`}>{tempPasswordExpired(entry) ? 'Expired' : 'Temporary · must change'}</span>}</td>
                        <td className="users-created-cell"><RelativeDate value={entry.created_at} empty="—" /></td>
                        <td><div className="users-row-actions" onClick={(event) => event.stopPropagation()}>
                          <button type="button" className="users-icon-button users-edit-icon" aria-label={`Edit ${entry.full_name}`} title="Edit user"
                            onClick={(event) => openUserDrawer(entry.user_id, event, true)}>✎</button>
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
              {users.map((entry) => <article className="users-mobile-card" key={`mobile-${entry.user_id}`} onClick={(event) => openUserDrawer(entry.user_id, event)} tabIndex="0"
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
          {actionError && <div className="users-inline-alert" role="alert">{actionError}</div>}
        </div>
        <div className="users-modal-actions">
          <button type="button" className="users-button users-button-outline" disabled={saving} onClick={() => setConfirmAction(null)}>Cancel</button>
          <button type="button" className={`users-button ${confirmAction.type === 'deactivate' ? 'users-button-danger' : 'users-button-primary'}`}
            disabled={saving || (confirmAction.type === 'reset' && (!adminPassword || (resetPasswordMode === 'manual' && !Object.values(normalizePassword(resetPassword)).every(Boolean))))}
            onClick={handleConfirmAction}>{saving ? <><span className="users-spinner" aria-hidden="true" /> Working…</> : confirmAction.type === 'reset' ? 'Reset password' : confirmAction.type === 'deactivate' ? 'Deactivate user' : confirmAction.type === 'reactivate' ? 'Reactivate user' : confirmAction.type === 'unlock' ? 'Unlock account' : 'Log out all devices'}</button>
        </div>
      </AccessibleModal>}

      {showLeaveConfirm && <AccessibleModal title="Discard unsaved changes?" onClose={() => setShowLeaveConfirm(false)}>
        <div className="users-modal-body"><p>Your changes have not been saved. Leave this drawer and discard them?</p></div>
        <div className="users-modal-actions"><button type="button" className="users-button users-button-outline" onClick={() => setShowLeaveConfirm(false)}>Keep editing</button>
          <button type="button" className="users-button users-button-danger" onClick={closeDrawer}>Discard changes</button></div>
      </AccessibleModal>}
    </div>
  );
};

export default UserManagementPage;
