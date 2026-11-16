const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const pool = require('../config/database');

dotenv.config();

const migrationPath = path.join(__dirname, 'migrateResidentMedicalRecords.sql');

async function run() {
  try {
    const [residentColumns] = await pool.query('SHOW COLUMNS FROM residents');
    if (!residentColumns.some((column) => column.Field === 'address')) {
      await pool.query('ALTER TABLE residents ADD COLUMN address TEXT NULL AFTER household_no');
    }
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const statements = sql.split(';').map((statement) => statement.trim()).filter(Boolean);
    for (const statement of statements) await pool.query(statement);
    console.log('Resident medical records migration applied successfully.');
  } catch (error) {
    console.error('Resident medical records migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
