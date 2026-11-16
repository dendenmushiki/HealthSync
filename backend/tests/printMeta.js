const { getTableColumnMeta } = require('../src/services/syncService');

(async () => {
  const meta = getTableColumnMeta('health_records');
  console.log('health_records meta:', meta);
})();
