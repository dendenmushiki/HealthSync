const pool = require('../config/database');

let schemaPromise;

const ensureUserManagementSchema = async () => {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const additions = [
        ['contact_number', 'VARCHAR(32) NULL'],
        ['email', 'VARCHAR(254) NULL'],
        ['is_active', 'BOOLEAN NOT NULL DEFAULT TRUE'],
        ['token_version', 'INT NOT NULL DEFAULT 0'],
        ['must_change_password', 'TINYINT(1) NOT NULL DEFAULT 0'],
        ['offline_pin_setup_required', 'TINYINT(1) NOT NULL DEFAULT 0'],
        ['password_changed_at', 'DATETIME NULL'],
        ['temp_password_expires_at', 'DATETIME NULL'],
        ['last_login_at', 'DATETIME NULL'],
        ['failed_login_attempts', 'INT NOT NULL DEFAULT 0'],
        ['locked_until', 'DATETIME NULL'],
        ['created_by', 'INT NULL'],
        ['created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
        ['updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
      ];

      for (const [name, definition] of additions) {
        const [columns] = await pool.query('SHOW COLUMNS FROM users LIKE ?', [name]);
        if (!columns.length) {
          await pool.query(`ALTER TABLE users ADD COLUMN \`${name}\` ${definition}`);
        }
      }

      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_login_history (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          user_id INT NULL,
          session_id VARCHAR(64) NULL,
          ip_address VARCHAR(45) NULL,
          user_agent VARCHAR(512) NULL,
          status VARCHAR(16) NOT NULL,
          occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME NULL,
          ended_at DATETIME NULL,
          UNIQUE KEY uq_user_login_session (session_id),
          KEY idx_user_login_history (user_id, occurred_at)
        )
      `);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }

  return schemaPromise;
};

module.exports = { ensureUserManagementSchema };
