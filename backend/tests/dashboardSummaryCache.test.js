const test = require('node:test');
const assert = require('node:assert/strict');
const dashboardSummaryCache = require('../src/services/dashboardSummaryCache');

test('dashboard summaries can be invalidated when resident data changes', () => {
  const summary = { recentResidents: [{ id: 8, name: 'Maria Santos' }] };
  dashboardSummaryCache.clear();
  dashboardSummaryCache.set('this_month', summary);

  assert.deepEqual(dashboardSummaryCache.get('this_month'), summary);

  dashboardSummaryCache.clear();
  assert.equal(dashboardSummaryCache.get('this_month'), null);
});
