const pool = require('../src/config/database');

(async () => {
  try {
    const conn = await pool.getConnection();
    
    console.log('=== USERS ===');
    const [users] = await conn.query('SELECT user_id, full_name, username, role FROM users');
    users.forEach(u => {
      console.log(`${u.user_id}: ${u.full_name} (${u.username}) - ${u.role}`);
    });
    
    console.log('\n=== RESIDENTS ===');
    const [residents] = await conn.query('SELECT resident_id, first_name, last_name, birthdate, sex FROM residents');
    residents.forEach(r => {
      console.log(`${r.resident_id}: ${r.first_name} ${r.last_name} (DOB: ${r.birthdate}, ${r.sex})`);
    });
    
    console.log('\n=== WHO BMI REFERENCE DATA ===');
    const [whoData] = await conn.query('SELECT COUNT(*) as count FROM who_bmi_for_age_ref');
    console.log('Records:', whoData[0].count);
    
    const [sampleWho] = await conn.query('SELECT * FROM who_bmi_for_age_ref LIMIT 3');
    sampleWho.forEach(row => {
      console.log(`  Sex: ${row.sex}, Age: ${row.age_months}m, BMI: ${row.bmi}, Z-score: ${row.zscore}`);
    });
    
    conn.release();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
