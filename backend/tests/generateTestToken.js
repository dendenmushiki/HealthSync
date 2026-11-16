const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const pool = require('../src/config/database');

dotenv.config();

async function main() {
  try {
    const [rows] = await pool.query('SELECT user_id, username, role FROM users LIMIT 1');
    let user;
    if (rows && rows.length > 0) {
      user = rows[0];
      console.log('Found existing user:', user.username || user.user_id);
    } else {
      console.log('No users found, creating test user...');
      const [res] = await pool.query('INSERT INTO users (full_name, username, password, role) VALUES (?, ?, ?, ?)', ['Smoke Test', 'smoke_test_bot', 'password', 'admin']);
      const insertedId = res.insertId;
      const [newRows] = await pool.query('SELECT user_id, username, role FROM users WHERE user_id = ?', [insertedId]);
      user = newRows[0];
      console.log('Created user id:', user.user_id);
    }

    const payload = {
      user_id: user.user_id,
      username: user.username || 'smoke_test',
      role: user.role || 'admin',
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
    console.log('\nTEST_TOKEN=' + token + '\n');
  } catch (err) {
    console.error('Error generating token:', err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
