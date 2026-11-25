const pool = require('../config/database');

let schemaPromise;

async function ensureMaternalRecordSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const [columns] = await pool.query('SHOW COLUMNS FROM maternal_records');
      if (!columns.some((column) => column.Field === 'edc')) {
        await pool.query('ALTER TABLE maternal_records ADD COLUMN IF NOT EXISTS edc DATE NULL AFTER record_data');
      }
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

module.exports = { ensureMaternalRecordSchema };
