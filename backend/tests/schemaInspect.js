const pool = require('../src/config/database');

(async () => {
  try {
    const conn = await pool.getConnection();
    
    const tables = [
      'residents',
      'users',
      'health_records',
      'operation_timbang',
      'operation_timbang_assessments',
      'adolescent_bmi_records',
      'adult_bmi_records',
      'senior_citizen_records',
      'who_bmi_for_age_ref',
      'sync_idempotency'
    ];
    
    for (const table of tables) {
      const [columns] = await conn.query(`DESCRIBE ${table}`);
      console.log(`\n📋 Table: ${table}`);
      columns.forEach(col => {
        const nullable = col.Null === 'YES' ? 'NULL' : 'NOT NULL';
        const key = col.Key ? ` [${col.Key}]` : '';
        console.log(`  - ${col.Field} (${col.Type}) ${nullable}${key}`);
      });
    }
    
    conn.release();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
})();
