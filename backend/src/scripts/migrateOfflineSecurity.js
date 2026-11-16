const pool = require('../config/database');
const { ensureOfflineSecuritySchema } = require('../services/offlineSecurityService');

ensureOfflineSecuritySchema()
  .then(() => {
    console.log('Offline PIN and device authorization schema is ready.');
  })
  .catch((error) => {
    console.error('Unable to prepare offline security schema.', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
