const pool = require('../../config/database');
const logger = require('../logger');
const references = require('./who2007-bmi-for-age.json');

const Z_SCORE_COLUMNS = [
  [-3, 4],
  [-2, 5],
  [0, 2],
  [2, 6],
  [3, 7]
];

const WHO_REFERENCE_DATA = ['male', 'female'].flatMap((sex) => references[sex].flatMap((row) => (
  Z_SCORE_COLUMNS.map(([zscore, bmiColumn]) => ({
    sex,
    ageMonths: row[0],
    bmi: row[bmiColumn],
    zscore
  }))
)));

async function populateWHOReference() {
  const connection = await pool.getConnection();
  try {
    const [existing] = await connection.query('SELECT COUNT(*) AS count FROM who_bmi_for_age_ref');
    if (Number(existing[0].count) > 0) {
      logger.warn('WHO reference table already contains rows; existing data was left unchanged.');
      return { success: true, message: 'Existing data left unchanged', recordsAdded: 0 };
    }

    for (const row of WHO_REFERENCE_DATA) {
      await connection.query(
        'INSERT INTO who_bmi_for_age_ref (sex, age_months, bmi, zscore) VALUES (?, ?, ?, ?)',
        [row.sex, row.ageMonths, row.bmi, row.zscore]
      );
    }
    logger.info(`WHO BMI-for-age reference data populated: ${WHO_REFERENCE_DATA.length} records added`);
    return { success: true, message: 'WHO data populated', recordsAdded: WHO_REFERENCE_DATA.length };
  } catch (error) {
    logger.error('Failed to populate WHO reference', error);
    throw error;
  } finally {
    connection.release();
  }
}

async function clearWHOReference() {
  const connection = await pool.getConnection();
  try {
    const [result] = await connection.query('DELETE FROM who_bmi_for_age_ref');
    logger.info(`WHO reference data cleared: ${result.affectedRows} records deleted`);
    return { success: true, message: 'WHO data cleared', recordsDeleted: result.affectedRows };
  } catch (error) {
    logger.error('Failed to clear WHO reference', error);
    throw error;
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  populateWHOReference()
    .then((result) => {
      console.log(result.message, `(${result.recordsAdded} records)`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('Failed:', error.message);
      process.exit(1);
    });
}

module.exports = { populateWHOReference, clearWHOReference, WHO_REFERENCE_DATA };
