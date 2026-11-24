const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

const migrationPath = path.join(__dirname, 'migrateFhsisRemarks.sql');

async function run() {
  try {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    await pool.query(sql);
    console.log('FHSIS report remarks migration applied successfully.');
  } catch (error) {
    console.error('FHSIS report remarks migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
