const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config();

async function inspect() {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
    multipleStatements: false,
  };

  const logger = require('../services/logger');
  if (!config.database) {
    logger.error('DB_NAME not set in .env');
    process.exit(1);
  }

  const conn = await mysql.createConnection(config);
  try {
    const [tables] = await conn.execute(
      `SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
      [config.database]
    );

    const result = {};
    for (const t of tables) {
      const tableName = t.TABLE_NAME;
      const [columns] = await conn.execute(
        `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [config.database, tableName]
      );

      const [pkRows] = await conn.execute(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION`,
        [config.database, tableName]
      );

      const [fkRows] = await conn.execute(
        `SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
         FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
        [config.database, tableName]
      );

      const [indexes] = await conn.execute(
        `SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns, NON_UNIQUE
         FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         GROUP BY INDEX_NAME, NON_UNIQUE`,
        [config.database, tableName]
      );

      result[tableName] = {
        columns,
        primaryKey: pkRows.map(r => r.COLUMN_NAME),
        foreignKeys: fkRows,
        indexes,
      };
    }

    logger.info('DB inspection result', { database: config.database, tables: result });
  } catch (err) {
    logger.error('Error inspecting DB', err);
    process.exitCode = 2;
  } finally {
    await conn.end();
  }
}

inspect();
