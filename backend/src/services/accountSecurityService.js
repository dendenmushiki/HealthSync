const pool = require('../config/database');

let schemaPromise;

const ensureAccountSecuritySchema = async () => {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const [columns] = await pool.query("SHOW COLUMNS FROM users LIKE 'token_version'");
      if (!columns.length) {
        await pool.query('ALTER TABLE users ADD COLUMN token_version INT NOT NULL DEFAULT 0');
      }

      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_preferences (
          user_id INT NOT NULL PRIMARY KEY,
          preferences JSON NOT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);

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

      const [historyColumns] = await pool.query("SHOW COLUMNS FROM user_login_history LIKE 'expires_at'");
      if (!historyColumns.length) {
        await pool.query('ALTER TABLE user_login_history ADD COLUMN expires_at DATETIME NULL');
      }
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }

  return schemaPromise;
};

const defaultPreferences = {
  theme: 'system',
  textSize: 'default',
  notifications: {
    nutritionAlerts: true,
    seniorFollowUpAlerts: true,
    offlineSyncAlerts: true,
    newResidentAlerts: true,
  },
};

const readPreferences = async (userId) => {
  await ensureAccountSecuritySchema();
  const [rows] = await pool.query('SELECT preferences FROM user_preferences WHERE user_id = ? LIMIT 1', [userId]);
  if (!rows.length) return { ...defaultPreferences, notifications: { ...defaultPreferences.notifications } };

  const stored = typeof rows[0].preferences === 'string'
    ? JSON.parse(rows[0].preferences)
    : rows[0].preferences;

  const savedPreferences = { ...(stored || {}) };
  delete savedPreferences.autoLogout;
  delete savedPreferences.autoLogoutMinutes;

  return {
    ...defaultPreferences,
    ...savedPreferences,
    notifications: {
      ...defaultPreferences.notifications,
      ...(stored?.notifications || {}),
    },
  };
};

module.exports = { ensureAccountSecuritySchema, defaultPreferences, readPreferences };
