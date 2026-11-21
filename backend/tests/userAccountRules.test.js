const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { normalizeUserRole, normalizeUserStatus, isProtectedSystemUser, generateTemporaryPassword } = require('../src/controllers/userController');
const { validatePassword } = require('../src/services/passwordPolicy');
const { validateUserContactInfo } = require('../src/services/userProfileValidation');

const readRouteFile = (fileName) => fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', fileName), 'utf8');

test('normalizeUserRole accepts valid admin values and lowercases them', () => {
  assert.equal(normalizeUserRole('ADMIN'), 'admin');
  assert.equal(normalizeUserRole('official'), 'barangay_official');
  assert.equal(normalizeUserRole('barangay_official'), 'barangay_official');
  assert.equal(normalizeUserRole('bhw'), 'bhw');
});

test('normalizeUserStatus defaults to active and handles falsey values', () => {
  assert.equal(normalizeUserStatus(undefined), true);
  assert.equal(normalizeUserStatus(true), true);
  assert.equal(normalizeUserStatus(false), false);
  assert.equal(normalizeUserStatus('0'), false);
  assert.equal(normalizeUserStatus('inactive'), false);
});

test('hsync_admin is treated as a protected primary admin account', () => {
  assert.equal(isProtectedSystemUser({ username: 'hsync_admin' }), true);
  assert.equal(isProtectedSystemUser({ username: 'HSYNC_ADMIN' }), true);
  assert.equal(isProtectedSystemUser({ username: 'bhw_staff' }), false);
});

test('generated temporary passwords meet policy and avoid look-alike characters', () => {
  const password = generateTemporaryPassword();
  assert.equal(validatePassword(password).valid, true);
  assert.ok(password.length >= 18);
  assert.doesNotMatch(password, /[O0l1]/);
});

test('new user contact details require a valid phone number and email address', () => {
  const valid = validateUserContactInfo({
    contact_number: '+63 917-123-4567',
    email: 'Staff.Example@healthsync.test',
  }, { required: true });
  assert.deepEqual(valid, {
    contact_number: '+63 917-123-4567',
    email: 'staff.example@healthsync.test',
    fieldErrors: {},
  });

  const invalid = validateUserContactInfo({ contact_number: '123', email: 'not-an-email' }, { required: true });
  assert.ok(invalid.fieldErrors.contact_number);
  assert.ok(invalid.fieldErrors.email);
});

test('existing user contact details may be left blank or cleared', () => {
  assert.deepEqual(validateUserContactInfo({ contact_number: '', email: '' }), {
    contact_number: null,
    email: null,
    fieldErrors: {},
  });
});

test('official accounts are restricted to dashboard, report, and settings access', () => {
  const residentRoutes = readRouteFile('residentRoutes.js');
  const healthRecordRoutes = readRouteFile('healthRecordRoutes.js');
  const seniorCitizenRoutes = readRouteFile('seniorCitizenRoutes.js');
  const childHealthRoutes = readRouteFile('childHealthRoutes.js');
  const nutritionRecordRoutes = readRouteFile('nutritionRecordRoutes.js');
  const dashboardRoutes = readRouteFile('dashboardRoutes.js');
  const reportRoutes = readRouteFile('reportRoutes.js');
  const settingsRoutes = readRouteFile('adminSettingsRoutes.js');
  const appRoutes = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'App.jsx'), 'utf8');

  assert.match(residentRoutes, /authorizeRole\(\['bhw'\]\)/);
  assert.doesNotMatch(residentRoutes, /official/);
  assert.match(healthRecordRoutes, /authorizeRole\(\['bhw'\]\)/);
  assert.doesNotMatch(healthRecordRoutes, /official/);
  assert.match(seniorCitizenRoutes, /authorizeRole\(\['bhw'\]\)/);
  assert.doesNotMatch(seniorCitizenRoutes, /official/);
  assert.match(childHealthRoutes, /authorizeRole\(\['bhw'\]\)/);
  assert.doesNotMatch(childHealthRoutes, /official/);
  assert.match(nutritionRecordRoutes, /authorizeRole\(\['bhw', 'admin'\]\)/);
  assert.doesNotMatch(nutritionRecordRoutes, /official/);

  assert.match(dashboardRoutes, /authorizeRole\(\['bhw', 'official'\]\)/);
  assert.match(dashboardRoutes, /authorizeRole\(\['bhw'\]\)/);
  assert.match(reportRoutes, /authorizeRole\(\['bhw', 'official'\]\)/);
  assert.match(settingsRoutes, /authorizeRole\(\['admin', 'bhw', 'official'\]\)/);

  assert.match(appRoutes, /allowed=\{\['bhw', 'official'\]\}/);
  assert.match(appRoutes, /RoleGuard allowed=\{\['bhw'\]\}/);
  assert.match(appRoutes, /path="\/admin-settings"/);
  assert.match(appRoutes, /path="\/nutrition" element=\{<ProtectedRoute><RoleGuard allowed=\{\['bhw'\]\}/);
  assert.match(appRoutes, /path="\/reports"/);
  assert.doesNotMatch(appRoutes, /RoleGuard allowed=\{\['bhw', 'official'\]\}>\s*<ResidentsPage|RoleGuard allowed=\{\['bhw', 'official'\]\}>\s*<HealthRecordsPage|RoleGuard allowed=\{\['bhw', 'official'\]\}>\s*<SeniorCitizenPage|RoleGuard allowed=\{\['bhw', 'official'\]\}>\s*<SyncStatus/);
});
