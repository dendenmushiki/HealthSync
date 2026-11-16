const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeAuditData } = require('../src/services/auditService');
const {
  buildFilters,
  cleanRow,
  csvCell,
  dateToManilaSql,
  activityPreviewSelect,
  formatManilaTimestamp,
  validateDateRange,
} = require('../src/controllers/auditController');

test('audit metadata redacts credential keys recursively', () => {
  const safe = sanitizeAuditData({
    user: { username: 'staff', password: 'temporary-password', password_hash: '$2b$10$private' },
    access_token: 'eyJhbGciOiJIUzI1NiJ9.abcdefghijk.abcdefghijk',
    changes: [{ field: 'role', value: 'bhw' }],
  });
  assert.equal(safe.user.username, 'staff');
  assert.equal(safe.user.password, '[REDACTED]');
  assert.equal(safe.user.password_hash, '[REDACTED]');
  assert.equal(safe.access_token, '[REDACTED]');
  assert.deepEqual(safe.changes, [{ field: 'role', value: 'bhw' }]);
});

test('audit search and filters bind values and retain actor/target distinction', () => {
  const query = buildFilters({
    q: "'; DROP TABLE audit_logs; --",
    actions: 'LOGIN_FAILED,user_created',
    modules: 'auth,users',
    userId: '12',
    target_user_id: '12',
    from: '2026-11-01',
    to: '2026-11-08',
    result: 'failure',
  });
  assert.match(query.where, /actor_id/);
  assert.match(query.where, /target_id/);
  assert.match(query.where, /ip_address LIKE \?/);
  assert.equal(query.params.includes("'; DROP TABLE audit_logs; --"), false);
  assert.ok(query.params.some((value) => String(value).includes("'; DROP TABLE audit_logs; --")));
  assert.deepEqual(query.params.slice(0, 9), Array(9).fill("%'; DROP TABLE audit_logs; --%"));
});

test('legacy failed sign-ins render the attempted username as target, never as actor', () => {
  const row = cleanRow({
    audit_id: 7,
    user_id: 12,
    actor_id: null,
    action: 'LOGIN_FAILED',
    target_type: 'user',
    target_label: '@hsync_admin',
    target_username: 'hsync_admin',
    description: 'Invalid password for account',
  });
  assert.equal(row.actor_id, null);
  assert.equal(row.description, 'Failed sign-in for @hsync_admin');
});

test('descriptions do not expose legacy numeric user or record identifiers', () => {
  const row = cleanRow({ action: 'UPDATE', description: 'Updated user 5 and resident #41' });
  assert.equal(row.description, 'Updated user account and record');
});

test('dashboard activity preview selects no audit payload or source details', () => {
  assert.match(activityPreviewSelect, /actor\.username AS actor_username/);
  assert.match(activityPreviewSelect, /target_label/);
  assert.doesNotMatch(activityPreviewSelect, /old_data|new_data|metadata|ip_address|user_agent/);
  const cleaned = cleanRow({ audit_id: 1, action: 'LOGIN', description: 'Signed in' });
  assert.equal('old_data' in cleaned || 'new_data' in cleaned || 'metadata' in cleaned, false);
});

test('audit dates use Manila wall time and reject invalid or reversed ranges', () => {
  assert.equal(dateToManilaSql('2026-11-08T11:29:00.000Z'), '2026-11-08 19:29:00');
  assert.equal(dateToManilaSql('2026-02-30'), null);
  assert.equal(formatManilaTimestamp(new Date('2026-11-08T11:29:00.000Z')), '2026-11-08T19:29:00+08:00');
  assert.equal(validateDateRange({ from: '2000-01-02', to: '2000-01-01' }), 'From date must be on or before To date.');
  assert.equal(validateDateRange({ from: '2026-02-30' }), 'Enter a valid date range.');
});

test('CSV cells quote content and neutralize spreadsheet formulas', () => {
  assert.equal(csvCell('=HYPERLINK("https://example.invalid")'), '"\'=HYPERLINK(""https://example.invalid"")"');
});
