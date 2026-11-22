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
      ['civil_status', "VARCHAR(20) NOT NULL DEFAULT ''"],
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

    const [updatedColumns] = await connection.query('SHOW COLUMNS FROM residents');
    const sexColumn = updatedColumns.find((column) => column.Field === 'sex');
    if (sexColumn?.Type.toLowerCase().startsWith('enum(')) {
      const values = [];
      const enumValuePattern = /'((?:''|[^'])*)'/g;
      let match = enumValuePattern.exec(sexColumn.Type);
      while (match) {
        values.push(match[1].replace(/''/g, "'"));
        match = enumValuePattern.exec(sexColumn.Type);
      }
      if (!values.some((value) => value.toLowerCase() === 'others')) {
        values.push('others');
        const nullability = sexColumn.Null === 'YES' ? 'NULL' : 'NOT NULL';
        const defaultClause = sexColumn.Default === null
          ? (sexColumn.Null === 'YES' ? ' DEFAULT NULL' : '')
          : ` DEFAULT '${String(sexColumn.Default).replace(/'/g, "''")}'`;
        await connection.query(
          `ALTER TABLE residents MODIFY COLUMN sex ENUM(${values.map((value) => `'${value.replace(/'/g, "''")}'`).join(', ')}) ${nullability}${defaultClause}`
        );
      }
    }

    const civilStatusColumn = updatedColumns.find((column) => column.Field === 'civil_status');
    if (civilStatusColumn?.Default === 'Unknown') {
      const nullability = civilStatusColumn.Null === 'YES' ? 'NULL' : 'NOT NULL';
      await connection.query(
        `ALTER TABLE residents MODIFY COLUMN civil_status ${civilStatusColumn.Type} ${nullability} DEFAULT ''`
      );
    }

    await connection.query("UPDATE residents SET resident_status = 'Active' WHERE resident_status IS NULL OR resident_status = ''");
    console.log('Resident field migration completed without dropping existing columns.');
  } finally {
    await connection.end();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
