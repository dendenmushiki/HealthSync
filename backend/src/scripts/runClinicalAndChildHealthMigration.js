const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const healthRecordColumns = [
  ['chief_complaint', 'VARCHAR(255) NULL'],
  ['history_of_present_illness', 'TEXT NULL'],
  ['past_medical_history', 'TEXT NULL'],
  ['allergies', 'TEXT NULL'],
  ['family_medical_history', 'TEXT NULL'],
  ['personal_social_history', 'TEXT NULL'],
  ['blood_pressure', 'VARCHAR(20) NULL'],
  ['heart_rate', 'VARCHAR(20) NULL'],
  ['respiratory_rate', 'VARCHAR(20) NULL'],
  ['temperature', 'DECIMAL(4,1) NULL'],
  ['weight_kg', 'DECIMAL(5,2) NULL'],
  ['height_cm', 'DECIMAL(5,2) NULL'],
  ['findings', 'TEXT NULL'],
  ['assessment', 'TEXT NULL'],
  ['plan', 'TEXT NULL'],
  ['maintenance_medications', 'TEXT NULL'],
  ['past_surgical_history', 'TEXT NULL'],
  ['immunization_history', 'TEXT NULL'],
  ['family_planning_history', 'TEXT NULL'],
  ['menstrual_history', 'TEXT NULL'],
  ['pregnancy_history', 'TEXT NULL'],
  ['remarks', 'TEXT NULL'],
  ['updated_at', 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP']
];

(async () => {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'healthsync_db'
  });

  try {
    const [healthColumns] = await connection.query('SHOW COLUMNS FROM health_records');
    const existingHealthColumns = new Set(healthColumns.map((column) => column.Field));

    for (const [columnName, definition] of healthRecordColumns) {
      if (!existingHealthColumns.has(columnName)) {
        await connection.query(`ALTER TABLE health_records ADD COLUMN ${columnName} ${definition}`);
      }
    }

    const [childTableRows] = await connection.query('SHOW TABLES LIKE ?', ['child_health_records']);
    if (!childTableRows.length) {
      await connection.query(`
        CREATE TABLE child_health_records (
          id INT NOT NULL AUTO_INCREMENT,
          resident_id INT NOT NULL,
          family_serial_number VARCHAR(100) NULL,
          nhts_number VARCHAR(100) NULL,
          philhealth_number VARCHAR(100) NULL,
          philhealth_category VARCHAR(100) NULL,
          religion VARCHAR(100) NULL,
          birthplace VARCHAR(255) NULL,
          birth_weight_kg DECIMAL(5,2) NULL,
          school_name VARCHAR(255) NULL,
          grade_level VARCHAR(50) NULL,
          parent_guardian_name VARCHAR(255) NULL,
          parent_guardian_relationship VARCHAR(100) NULL,
          record_date DATE NOT NULL,
          history_of_present_illness TEXT NULL,
          past_medical_history TEXT NULL,
          hospitalization_history TEXT NULL,
          medication_allergies TEXT NULL,
          food_allergies TEXT NULL,
          family_medical_history TEXT NULL,
          birth_history TEXT NULL,
          immunization_history TEXT NULL,
          blood_pressure VARCHAR(20) NULL,
          heart_rate VARCHAR(20) NULL,
          respiratory_rate VARCHAR(20) NULL,
          temperature DECIMAL(4,1) NULL,
          weight_kg DECIMAL(5,2) NULL,
          height_cm DECIMAL(5,2) NULL,
          findings TEXT NULL,
          assessment TEXT NULL,
          plan TEXT NULL,
          remarks TEXT NULL,
          recorded_by INT NOT NULL,
          created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_child_health_resident (resident_id),
          KEY idx_child_health_date (record_date),
          KEY idx_child_health_recorded_by (recorded_by),
          CONSTRAINT fk_child_health_resident FOREIGN KEY (resident_id) REFERENCES residents(resident_id) ON DELETE CASCADE,
          CONSTRAINT fk_child_health_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(user_id)
        ) ENGINE=InnoDB
      `);
    }

    console.log('Clinical and child health migration applied successfully.');
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
})();
