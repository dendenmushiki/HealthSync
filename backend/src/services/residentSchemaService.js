const pool = require('../config/database');

let schemaPromise;

async function ensureResidentSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const [columns] = await pool.query('SHOW COLUMNS FROM residents');
      const fields = new Set(columns.map((column) => column.Field));
      const additions = [
        ['profile_photo', 'VARCHAR(500) NULL'],
        ['region_code', 'VARCHAR(10) NULL'],
        ['province_code', 'VARCHAR(10) NULL'],
        ['city_municipality_code', 'VARCHAR(10) NULL'],
        ['barangay_code', 'VARCHAR(10) NULL']
      ];

      for (const [field, definition] of additions) {
        if (!fields.has(field)) {
          await pool.query(`ALTER TABLE residents ADD COLUMN ${field} ${definition}`);
        }
      }
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

module.exports = { ensureResidentSchema };
