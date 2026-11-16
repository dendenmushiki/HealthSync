const pool = require('../config/database');
const { ensureAccountSecuritySchema } = require('../services/accountSecurityService');

ensureAccountSecuritySchema()
  .then(() => {
    console.log('Account security tables and columns are ready.');
  })
  .catch((error) => {
    console.error('Unable to prepare account security schema.', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
