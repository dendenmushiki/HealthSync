export const AUDIT_CATEGORIES = {
  authentication: { label: 'Authentication', modules: ['auth'], tone: 'info' },
  user_management: { label: 'User management', modules: ['users'], tone: 'warning' },
  resident: { label: 'Residents', modules: ['residents'], tone: 'success' },
  health_record: { label: 'Health records', modules: ['health_records', 'child_health_records', 'clinical', 'child', 'maternal', 'immunization'], tone: 'info' },
  nutrition: { label: 'Nutrition', modules: ['operation_timbang', 'adolescent_bmi', 'adult_bmi'], tone: 'success' },
  senior_registry: { label: 'Senior registry', modules: ['senior_citizens'], tone: 'info' },
  settings: { label: 'Settings', modules: ['account-settings', 'admin-settings'], tone: 'neutral' },
  reports: { label: 'Reports', modules: ['reports'], tone: 'neutral' },
  sync: { label: 'Sync', modules: ['sync'], tone: 'neutral' },
  system: { label: 'System', modules: ['system', 'audit'], tone: 'neutral' },
};

export const AUDIT_MODULES = {
  auth: { label: 'Authentication', category: 'authentication' },
  users: { label: 'User management', category: 'user_management' },
  residents: { label: 'Residents', category: 'resident' },
  health_records: { label: 'Health records', category: 'health_record' },
  child_health_records: { label: 'Child health', category: 'health_record' },
  clinical: { label: 'Clinical records', category: 'health_record' },
  child: { label: 'Child health', category: 'health_record' },
  maternal: { label: 'Maternal records', category: 'health_record' },
  immunization: { label: 'Immunization', category: 'health_record' },
  operation_timbang: { label: 'Nutrition monitoring', category: 'nutrition' },
  adolescent_bmi: { label: 'Adolescent BMI', category: 'nutrition' },
  adult_bmi: { label: 'Adult BMI', category: 'nutrition' },
  senior_citizens: { label: 'Senior registry', category: 'senior_registry' },
  'account-settings': { label: 'Account settings', category: 'settings' },
  'admin-settings': { label: 'Admin settings', category: 'settings' },
  reports: { label: 'Reports', category: 'reports' },
  sync: { label: 'Sync', category: 'sync' },
  audit: { label: 'Audit logs', category: 'system' },
};

const event = (label, category, icon, severity = 'info') => ({ label, category, icon, severity });

export const AUDIT_EVENTS = {
  LOGIN: event('Signed in', 'authentication', 'login'),
  LOGOUT: event('Signed out', 'authentication', 'logout'),
  LOGIN_FAILED: event('Failed sign-in', 'authentication', 'failure', 'warning'),
  ACCOUNT_LOCKED: event('Account locked', 'authentication', 'locked', 'critical'),
  PASSWORD_CHANGED: event('Password changed', 'authentication', 'password'),
  CREATE: event('Created record', 'system', 'created'),
  UPDATE: event('Updated record', 'system', 'updated'),
  DELETE: event('Deleted record', 'system', 'deleted', 'warning'),
  VIEW: event('Viewed record', 'system', 'activity'),
  USER_CREATED: event('User created', 'user_management', 'created'),
  user_created: event('User created', 'user_management', 'created'),
  user_updated: event('User updated', 'user_management', 'updated'),
  role_changed: event('Role changed', 'user_management', 'updated', 'warning'),
  user_deactivated: event('User deactivated', 'user_management', 'deleted', 'warning'),
  user_reactivated: event('User reactivated', 'user_management', 'created'),
  password_reset: event('Password reset', 'user_management', 'password', 'warning'),
  user_unlocked: event('User unlocked', 'user_management', 'locked'),
  sessions_revoked: event('Sessions revoked', 'user_management', 'logout', 'warning'),
  audit_exported: event('Audit exported', 'system', 'download'),
  ACCOUNT_SETTINGS_UPDATED: event('Settings updated', 'settings', 'updated'),
  ACCOUNT_PASSWORD_UPDATED: event('Password changed', 'settings', 'password'),
  ACCOUNT_SESSIONS_REVOKED: event('Sessions revoked', 'settings', 'logout', 'warning'),
  ACCOUNT_PHOTO_UPDATED: event('Profile photo updated', 'settings', 'updated'),
  ACCOUNT_PHOTO_REMOVED: event('Profile photo removed', 'settings', 'deleted'),
};

export const getEventConfig = (action) => {
  const raw = String(action || 'unknown');
  return AUDIT_EVENTS[raw] || { label: raw.replace(/[_-]+/g, ' '), category: 'system', icon: 'activity', severity: 'info', unknown: true };
};

export const getModuleLabel = (module) => AUDIT_MODULES[module]?.label || String(module || 'System').replace(/[_-]+/g, ' ');
export const getCategoryLabel = (category) => AUDIT_CATEGORIES[category]?.label || 'Other';

export const getEventSummary = (item) => {
  const key = String(item.action || '').toLowerCase();
  const target = item.target_label || item.target_user_name || item.target_username;
  const namedTarget = target ? ` ${target}` : '';
  const summaries = {
    login: 'Signed in',
    logout: 'Signed out',
    login_failed: item.description || 'Failed sign-in attempt',
    account_locked: `Account locked${namedTarget}`,
    password_changed: 'Changed account password',
    user_created: `Created user${namedTarget}`,
    user_updated: `Updated user${namedTarget}`,
    user_created_legacy: `Created user${namedTarget}`,
    role_changed: `Changed role${namedTarget}`,
    user_deactivated: `Deactivated user${namedTarget}`,
    user_reactivated: `Reactivated user${namedTarget}`,
    password_reset: `Reset password${namedTarget}`,
    user_unlocked: `Unlocked user${namedTarget}`,
    sessions_revoked: `Signed out all sessions${namedTarget}`,
    audit_exported: 'Exported audit events',
    account_settings_updated: 'Updated account settings',
    account_password_updated: 'Changed account password',
    account_sessions_revoked: 'Signed out all sessions',
    create: `Created ${getModuleLabel(item.module).toLowerCase()} record`,
    update: `Updated ${getModuleLabel(item.module).toLowerCase()} record`,
    delete: `Deleted ${getModuleLabel(item.module).toLowerCase()} record`,
    view: `Viewed ${getModuleLabel(item.module).toLowerCase()} record`,
  };
  const result = summaries[key] || String(item.description || getEventConfig(item.action).label);
  return result.replace(/\b(?:user|resident|record)\s+#?\d+\b/gi, (match) => {
    if (/^user/i.test(match) && target) return target;
    return match.replace(/#?\d+/, 'record');
  });
};
