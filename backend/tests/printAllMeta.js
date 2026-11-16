const svc = require('../src/services/syncService');

(async () => {
  await svc.initializeFromDatabase(process.env.DB_NAME);
  const tables = ['health_records','residents','operation_timbang'];
  for (const t of tables) {
    console.log(t, svc.getTableColumnMeta(t));
  }
})();
