const pool = require('../config/database');

let schemaPromise;

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function ensureResidentSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const [columns] = await pool.query('SHOW COLUMNS FROM residents');
      const fields = new Map(columns.map((column) => [column.Field, column]));
      const additions = [
        ['profile_photo', 'VARCHAR(500) NULL'],
        ['region_code', 'VARCHAR(10) NULL'],
        ['province_code', 'VARCHAR(10) NULL'],
        ['city_municipality_code', 'VARCHAR(10) NULL'],
        ['barangay_code', 'VARCHAR(10) NULL']
      ];

      for (const [field, definition] of additions) {
        if (!fields.has(field)) {
          await pool.query(`ALTER TABLE residents ADD COLUMN ${field} ${definition}`);
        }
      }

      const sexColumn = fields.get('sex');
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
            : ` DEFAULT ${sqlString(sexColumn.Default)}`;
          await pool.query(
            `ALTER TABLE residents MODIFY COLUMN sex ENUM(${values.map(sqlString).join(', ')}) ${nullability}${defaultClause}`
          );
        }
      }

      const civilStatusColumn = fields.get('civil_status');
      if (civilStatusColumn && civilStatusColumn.Default === 'Unknown') {
        const nullability = civilStatusColumn.Null === 'YES' ? 'NULL' : 'NOT NULL';
        await pool.query(
          `ALTER TABLE residents MODIFY COLUMN civil_status ${civilStatusColumn.Type} ${nullability} DEFAULT ''`
        );
      }
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

module.exports = { ensureResidentSchema };
