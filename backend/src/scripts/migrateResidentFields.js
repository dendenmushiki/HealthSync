const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

(async () => {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'healthsync_db'
  });

  try {
    const [columns] = await connection.query('SHOW COLUMNS FROM residents');
    const fields = new Set(columns.map((column) => column.Field));
    const additions = [
      ['civil_status', "VARCHAR(20) NOT NULL DEFAULT 'Unknown'"],
      ['occupation', 'VARCHAR(100) NULL'],
      ['resident_status', "VARCHAR(20) NOT NULL DEFAULT 'Active'"],
      ['pregnant', 'TINYINT(1) NOT NULL DEFAULT 0'],
      ['lactating', 'TINYINT(1) NOT NULL DEFAULT 0']
    ];

    for (const [field, definition] of additions) {
      if (!fields.has(field)) {
        await connection.query(`ALTER TABLE residents ADD COLUMN ${field} ${definition}`);
        console.log(`Added residents.${field}`);
      }
    }

    await connection.query("UPDATE residents SET civil_status = 'Unknown' WHERE civil_status IS NULL OR civil_status = ''");
    await connection.query("UPDATE residents SET resident_status = 'Active' WHERE resident_status IS NULL OR resident_status = ''");
    console.log('Resident field migration completed without dropping existing columns.');
  } finally {
    await connection.end();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
