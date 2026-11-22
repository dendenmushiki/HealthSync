const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'healthsync_db'
  });

  try {
    const [columns] = await conn.query('SHOW COLUMNS FROM residents');
    let fields = columns.map((column) => column.Field);

    if (fields.includes('purok') && !fields.includes('legacy_purok')) {
      await conn.query('ALTER TABLE residents CHANGE COLUMN purok legacy_purok VARCHAR(20) NULL');
      fields = fields.filter((field) => field !== 'purok').concat('legacy_purok');
    }

    const additions = [
      ['suffix', 'VARCHAR(20) NULL'],
      ['household_no', 'VARCHAR(50) NULL'],
      ['contact_no', 'VARCHAR(30) NULL'],
      ['philhealth_id_no', 'VARCHAR(50) NULL'],
      ['is_4ps', 'TINYINT(1) NOT NULL DEFAULT 0'],
      ['category_flags', 'JSON NULL'],
      ['sitio', 'VARCHAR(100) NULL'],
      ['region_code', 'VARCHAR(10) NULL'],
      ['province_code', 'VARCHAR(10) NULL'],
      ['city_municipality_code', 'VARCHAR(10) NULL'],
      ['barangay_code', 'VARCHAR(10) NULL'],
      ['created_by', 'INT NULL']
    ];

    for (const [name, definition] of additions) {
      if (!fields.includes(name)) {
        await conn.query(`ALTER TABLE residents ADD COLUMN ${name} ${definition}`);
      }
    }

    const demographicColumns = columns.filter((column) => ['sex', 'civil_status'].includes(column.Field));
    const sexColumn = demographicColumns.find((column) => column.Field === 'sex');
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
        await conn.query(
          `ALTER TABLE residents MODIFY COLUMN sex ENUM(${values.map((value) => `'${value.replace(/'/g, "''")}'`).join(', ')}) ${nullability}${defaultClause}`
        );
      }
    }

    const civilStatusColumn = demographicColumns.find((column) => column.Field === 'civil_status');
    if (civilStatusColumn?.Default === 'Unknown') {
      const nullability = civilStatusColumn.Null === 'YES' ? 'NULL' : 'NOT NULL';
      await conn.query(
        `ALTER TABLE residents MODIFY COLUMN civil_status ${civilStatusColumn.Type} ${nullability} DEFAULT ''`
      );
    }

    const schema = process.env.DB_NAME || 'healthsync_db';
    const [fkRows] = await conn.query(
      'SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?',
      [schema, 'residents', 'fk_residents_created_by']
    );

    if (!fkRows.length) {
      await conn.query('ALTER TABLE residents ADD CONSTRAINT fk_residents_created_by FOREIGN KEY (created_by) REFERENCES users(user_id)');
    }

    const [updatedColumns] = await conn.query('SHOW COLUMNS FROM residents');
    console.log(JSON.stringify(updatedColumns, null, 2));
  } finally {
    await conn.end();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
