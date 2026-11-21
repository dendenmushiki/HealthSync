const pool = require('../config/database');
const logger = require('../services/logger');
const { getManilaToday } = require('../services/manilaDateService');
const { writeAudit } = require('../services/auditService');

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function reportPeriod(query) {
  const today = getManilaToday();
  const period = ['month', 'quarter', 'year', 'custom'].includes(query.period) ? query.period : 'month';
  let from;
  let to;

  if (period === 'custom') {
    from = String(query.from || '');
    to = String(query.to || '');
    if (!isCalendarDate(from) || !isCalendarDate(to) || from > to || to > today) {
      const error = new Error('Choose a valid reporting range. The start must not be after the end, and the end cannot be in the future.');
      error.statusCode = 400;
      throw error;
    }
  } else if (period === 'year') {
    const year = /^\d{4}$/.test(String(query.year || '')) ? String(query.year) : today.slice(0, 4);
    from = `${year}-01-01`;
    to = `${year}-12-31`;
    if (to > today) to = today;
  } else if (period === 'quarter') {
    const quarter = Number(query.quarter);
    const year = /^\d{4}$/.test(String(query.year || '')) ? Number(query.year) : Number(today.slice(0, 4));
    const selectedQuarter = Number.isInteger(quarter) && quarter >= 1 && quarter <= 4
      ? quarter
      : Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
    const startMonth = (selectedQuarter - 1) * 3 + 1;
    from = `${year}-${String(startMonth).padStart(2, '0')}-01`;
    const end = new Date(Date.UTC(year, startMonth + 2, 0));
    to = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(end.getUTCDate()).padStart(2, '0')}`;
    if (to > today) to = today;
  } else {
    const month = /^\d{4}-\d{2}$/.test(String(query.month || '')) ? String(query.month) : today.slice(0, 7);
    const [year, monthNumber] = month.split('-').map(Number);
    if (monthNumber < 1 || monthNumber > 12) {
      const error = new Error('Choose a valid reporting month.');
      error.statusCode = 400;
      throw error;
    }
    from = `${month}-01`;
    const end = new Date(Date.UTC(year, monthNumber, 0));
    to = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(end.getUTCDate()).padStart(2, '0')}`;
    if (to > today) to = today;
  }

  if (!isCalendarDate(from) || !isCalendarDate(to) || from > to || from > today) {
    const error = new Error('The selected reporting period is not valid.');
    error.statusCode = 400;
    throw error;
  }
  return { period, from, to, today };
}

const sexTotals = (rows, field) => {
  const totals = { male: 0, female: 0, total: 0 };
  rows.forEach((row) => {
    const count = Number(row[field] || 0);
    const sex = String(row.sex || '').toLowerCase();
    if (sex === 'male') totals.male += count;
    if (sex === 'female') totals.female += count;
    totals.total += count;
  });
  return totals;
};

const getMonthlyReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const params = [];
    let dateClause = 'WHERE 1=1';

    if (startDate) {
      dateClause += ' AND record_date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      dateClause += ' AND record_date <= ?';
      params.push(endDate);
    }

    const [residents] = await pool.query('SELECT COUNT(*) AS total FROM residents');
    const [newResidents] = await pool.query(`
      SELECT COUNT(*) AS total
      FROM residents
      WHERE DATE(CONVERT_TZ(created_at, @@session.time_zone, '+08:00'))
        BETWEEN DATE_SUB(?, INTERVAL 29 DAY) AND ?
    `, [getManilaToday(), getManilaToday()]);
    const [healthRecords] = await pool.query(`SELECT COUNT(*) AS total FROM health_records ${dateClause}` , params);
    const [operationTimbang] = await pool.query(`SELECT COUNT(*) AS total FROM operation_timbang ${dateClause.replace(/record_date/g, 'date_recorded')}` , params);
    const [adolescentBMI] = await pool.query(`SELECT COUNT(*) AS total FROM adolescent_bmi_records ${dateClause}` , params);
    const [adultBMI] = await pool.query(`SELECT COUNT(*) AS total FROM adult_bmi_records ${dateClause.replace(/record_date/g, 'date_recorded')}` , params);
    const [seniorCitizens] = await pool.query('SELECT COUNT(DISTINCT resident_id) AS total FROM senior_citizen_records');

    return res.json({
      success: true,
      data: {
        totalResidents: residents[0].total,
        newResidents: newResidents[0].total,
        healthRecords: healthRecords[0].total,
        operationTimbang: operationTimbang[0].total,
        adolescentBMI: adolescentBMI[0].total,
        adultBMI: adultBMI[0].total,
        seniorCitizens: seniorCitizens[0].total,
      },
    });
  } catch (error) {
    logger.error('getMonthlyReport error', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getFhsisReport = async (req, res) => {
  try {
    const range = reportPeriod(req.query);
    const [operationTimbang] = await pool.query(`
      SELECT ota.wflh_status AS status,
        SUM(CASE WHEN LOWER(r.sex) = 'male' THEN 1 ELSE 0 END) AS male,
        SUM(CASE WHEN LOWER(r.sex) = 'female' THEN 1 ELSE 0 END) AS female,
        COUNT(*) AS total
      FROM operation_timbang_assessments ota
      JOIN operation_timbang ot ON ot.timbang_id = ota.timbang_id
      LEFT JOIN residents r ON r.resident_id = ot.resident_id
      WHERE ota.wflh_status IS NOT NULL AND ot.date_recorded >= ? AND ot.date_recorded <= ?
      GROUP BY ota.wflh_status
    `, [range.from, range.to]);
    const [adolescent] = await pool.query(`
      SELECT abr.bmi_for_age_category AS status,
        SUM(CASE WHEN LOWER(r.sex) = 'male' THEN 1 ELSE 0 END) AS male,
        SUM(CASE WHEN LOWER(r.sex) = 'female' THEN 1 ELSE 0 END) AS female,
        COUNT(*) AS total
      FROM adolescent_bmi_records abr
      LEFT JOIN residents r ON r.resident_id = abr.resident_id
      WHERE abr.bmi_for_age_category IS NOT NULL AND abr.record_date >= ? AND abr.record_date <= ?
      GROUP BY abr.bmi_for_age_category
    `, [range.from, range.to]);
    const [adult] = await pool.query(`
      SELECT abr.bmi_category AS status,
        SUM(CASE WHEN LOWER(r.sex) = 'male' THEN 1 ELSE 0 END) AS male,
        SUM(CASE WHEN LOWER(r.sex) = 'female' THEN 1 ELSE 0 END) AS female,
        COUNT(*) AS total
      FROM adult_bmi_records abr
      LEFT JOIN residents r ON r.resident_id = abr.resident_id
      WHERE abr.bmi_category IS NOT NULL AND abr.date_recorded >= ? AND abr.date_recorded <= ?
      GROUP BY abr.bmi_category
    `, [range.from, range.to]);

    const [immunizationRows] = await pool.query(`
      SELECT LOWER(r.sex) AS sex,
        COUNT(DISTINCT CASE WHEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ir.record_data, '$.bcg_date')), '') IS NOT NULL THEN ir.resident_id END) AS bcg,
        COUNT(DISTINCT CASE WHEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ir.record_data, '$.hepa_b1_within_24_hours_date')), '') IS NOT NULL THEN ir.resident_id END) AS hepaBWithin24Hours,
        COUNT(DISTINCT CASE WHEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ir.record_data, '$.vaccine_rows[0].penta_hib')), '') IS NOT NULL THEN ir.resident_id END) AS penta1,
        COUNT(DISTINCT CASE WHEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ir.record_data, '$.vaccine_rows[1].penta_hib')), '') IS NOT NULL THEN ir.resident_id END) AS penta2,
        COUNT(DISTINCT CASE WHEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ir.record_data, '$.vaccine_rows[2].penta_hib')), '') IS NOT NULL THEN ir.resident_id END) AS penta3,
        COUNT(DISTINCT CASE WHEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ir.record_data, '$.vaccine_rows[0].opv_ipv')), '') IS NOT NULL THEN ir.resident_id END) AS opv1,
        COUNT(DISTINCT CASE WHEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ir.record_data, '$.vaccine_rows[1].opv_ipv')), '') IS NOT NULL THEN ir.resident_id END) AS opv2,
        COUNT(DISTINCT CASE WHEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ir.record_data, '$.vaccine_rows[2].opv_ipv')), '') IS NOT NULL THEN ir.resident_id END) AS opv3,
        COUNT(DISTINCT CASE WHEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ir.record_data, '$.vaccine_rows[0].pcv_1_3')), '') IS NOT NULL THEN ir.resident_id END) AS pcv1,
        COUNT(DISTINCT CASE WHEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ir.record_data, '$.vaccine_rows[1].pcv_1_3')), '') IS NOT NULL THEN ir.resident_id END) AS pcv2,
        COUNT(DISTINCT CASE WHEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ir.record_data, '$.vaccine_rows[2].pcv_1_3')), '') IS NOT NULL THEN ir.resident_id END) AS pcv3,
        COUNT(DISTINCT CASE WHEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ir.record_data, '$.mmr_date')), '') IS NOT NULL THEN ir.resident_id END) AS mmrRecorded,
        COUNT(DISTINCT CASE WHEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ir.record_data, '$.vitamin_a_first_dose_date')), '') IS NOT NULL THEN ir.resident_id END) AS vitaminA6To11Months,
        COUNT(DISTINCT CASE WHEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ir.record_data, '$.vitamin_a_second_dose_date')), '') IS NOT NULL THEN ir.resident_id END) AS vitaminA12To15Months
      FROM immunization_records ir
      JOIN residents r ON r.resident_id = ir.resident_id
      WHERE COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ir.record_data, '$.visit_date')), ''), DATE_FORMAT(CONVERT_TZ(ir.created_at, @@session.time_zone, '+08:00'), '%Y-%m-%d')) BETWEEN ? AND ?
      GROUP BY LOWER(r.sex)
    `, [range.from, range.to]);
    const [maternalRows] = await pool.query(`
      SELECT LOWER(r.sex) AS sex,
        COUNT(DISTINCT mr.resident_id) AS womenSeen,
        COUNT(DISTINCT CASE
          WHEN NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(mr.record_data, '$.tt_status'))), '') IS NOT NULL
          THEN mr.resident_id
        END) AS ttStatusDocumented
      FROM maternal_records mr
      JOIN residents r ON r.resident_id = mr.resident_id
      WHERE COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(mr.record_data, '$.visit_date')), ''), DATE_FORMAT(CONVERT_TZ(mr.created_at, @@session.time_zone, '+08:00'), '%Y-%m-%d')) BETWEEN ? AND ?
      GROUP BY LOWER(r.sex)
    `, [range.from, range.to]);
    const [seniorRows] = await pool.query(`
      SELECT LOWER(r.sex) AS sex, COUNT(DISTINCT scr.resident_id) AS total
      FROM senior_citizen_records scr
      JOIN residents r ON r.resident_id = scr.resident_id
      GROUP BY LOWER(r.sex)
    `);
    const [[residentSummary]] = await pool.query(`
      SELECT COUNT(*) AS totalResidents,
        SUM(resident_status = 'Active') AS activeResidents,
        SUM(DATE(CONVERT_TZ(created_at, @@session.time_zone, '+08:00')) BETWEEN ? AND ?) AS newResidents,
        SUM(LOWER(TRIM(sex)) = 'male') AS residentMale,
        SUM(LOWER(TRIM(sex)) = 'female') AS residentFemale,
        SUM(resident_status = 'Active' AND LOWER(TRIM(sex)) = 'male') AS activeMale,
        SUM(resident_status = 'Active' AND LOWER(TRIM(sex)) = 'female') AS activeFemale
      FROM residents
    `, [range.from, range.to]);
    const [[clinicalSummary]] = await pool.query(`
      SELECT COUNT(*) AS clinicalRecords
      FROM health_records
      WHERE record_date >= ? AND record_date <= ?
    `, [range.from, range.to]);

    const immunization = Object.keys(immunizationRows[0] || {})
      .filter((key) => key !== 'sex')
      .reduce((totals, key) => {
        totals[key] = sexTotals(immunizationRows, key);
        return totals;
      }, {});

    return res.json({
      success: true,
      data: {
        nutrition: { operationTimbang, adolescent, adult },
        immunization,
        maternal: {
          womenSeen: sexTotals(maternalRows, 'womenSeen'),
          ttStatusDocumented: sexTotals(maternalRows, 'ttStatusDocumented'),
        },
        seniorCitizens: sexTotals(seniorRows, 'total'),
        summary: {
          totalResidents: Number(residentSummary?.totalResidents || 0),
          activeResidents: Number(residentSummary?.activeResidents || 0),
          newResidents: Number(residentSummary?.newResidents || 0),
          residentSex: {
            male: Number(residentSummary?.residentMale || 0),
            female: Number(residentSummary?.residentFemale || 0),
          },
          activeSex: {
            male: Number(residentSummary?.activeMale || 0),
            female: Number(residentSummary?.activeFemale || 0),
          },
          clinicalRecords: Number(clinicalSummary?.clinicalRecords || 0),
          seniorCitizens: sexTotals(seniorRows, 'total'),
        },
        metadata: {
          ...range,
          generatedAt: new Date().toISOString(),
          barangay: process.env.BARANGAY_NAME || '',
          municipality: process.env.MUNICIPALITY_NAME || '',
        },
      },
    });
  } catch (error) {
    logger.error('getFhsisReport error', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Unable to load FHSIS report data.' });
  }
};

const getFhsisRemarks = async (req, res) => {
  try {
    const reportPeriodValue = String(req.query.reportPeriod || '');
    if (!reportPeriodValue || reportPeriodValue.length > 64) {
      return res.status(400).json({ success: false, message: 'A valid report period is required.' });
    }
    const [rows] = await pool.query(`
      SELECT rr.indicator_key, rr.remark, rr.updated_at, u.full_name AS updated_by_name
      FROM report_remarks rr
      LEFT JOIN users u ON u.user_id = rr.updated_by
      WHERE rr.report_period = ?
    `, [reportPeriodValue]);
    return res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('getFhsisRemarks error', error);
    return res.status(500).json({ success: false, message: 'Unable to load report remarks.' });
  }
};

const saveFhsisRemark = async (req, res) => {
  try {
    const connection = req.idempotencyConnection || pool;
    const reportPeriodValue = String(req.body?.reportPeriod || '');
    const indicatorKey = String(req.body?.indicatorKey || '');
    const remark = req.body?.remark;
    if (!reportPeriodValue || reportPeriodValue.length > 64 || !/^[a-z0-9:_-]{1,120}$/i.test(indicatorKey)
      || typeof remark !== 'string' || remark.length > 1000) {
      return res.status(400).json({ success: false, message: 'Provide a valid report period, indicator, and remark of at most 1,000 characters.' });
    }
    const value = remark.trim();
    if (!value) {
      const [[existing]] = await connection.query(
        'SELECT report_period, indicator_key, remark, updated_by, updated_at FROM report_remarks WHERE report_period = ? AND indicator_key = ?',
        [reportPeriodValue, indicatorKey]
      );
      await connection.query('DELETE FROM report_remarks WHERE report_period = ? AND indicator_key = ?', [reportPeriodValue, indicatorKey]);
      if (existing) {
        await writeAudit({
          user_id: req.user.user_id,
          action: 'DELETE',
          module: 'reports',
          description: 'Deleted an FHSIS report remark.',
          table_name: 'report_remarks',
          targetType: 'report_remark',
          targetId: `${reportPeriodValue}:${indicatorKey}`,
          targetLabel: indicatorKey,
          old_data: existing,
          connection,
        });
      }
      return res.json({ success: true, data: { indicatorKey, remark: '' } });
    }
    await connection.query(`
      INSERT INTO report_remarks (report_period, indicator_key, remark, updated_by)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE remark = VALUES(remark), updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP
    `, [reportPeriodValue, indicatorKey, value, req.user.user_id]);
    const [[saved]] = await connection.query(`
      SELECT rr.indicator_key, rr.remark, rr.updated_at, u.full_name AS updated_by_name
      FROM report_remarks rr
      LEFT JOIN users u ON u.user_id = rr.updated_by
      WHERE rr.report_period = ? AND rr.indicator_key = ?
    `, [reportPeriodValue, indicatorKey]);
    return res.json({ success: true, data: saved });
  } catch (error) {
    logger.error('saveFhsisRemark error', error);
    return res.status(500).json({ success: false, message: 'Unable to save report remark.' });
  }
};

const getFhsisDrilldown = async (req, res) => {
  try {
    const from = String(req.query.from || '');
    const to = String(req.query.to || '');
    if (!isCalendarDate(from) || !isCalendarDate(to) || from > to || to > getManilaToday()) {
      return res.status(400).json({ success: false, message: 'A valid reporting period is required.' });
    }

    const indicator = String(req.query.indicator || '');
    const categoryValue = String(req.query.category || '').trim().slice(0, 100);
    const sex = ['male', 'female', 'total'].includes(String(req.query.sex || '')) ? String(req.query.sex) : '';
    const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
    const pageSize = [10, 25, 50].includes(Number(req.query.pageSize)) ? Number(req.query.pageSize) : 10;
    const search = String(req.query.search || '').trim().slice(0, 100);
    const today = getManilaToday();
    const dateQuery = (source, dateExpression, where, countMode = 'records', residentJoin = 'JOIN residents r ON r.resident_id = src.resident_id', extraParams = []) => ({
      source,
      residentJoin,
      dateExpression,
      where: `${where} AND ${dateExpression} BETWEEN ? AND ?`,
      params: [...extraParams, from, to],
      countMode,
      sexAllowed: true,
    });

    let definition;
    if (indicator === 'resident-total') {
      definition = { source: 'residents src', residentJoin: 'JOIN residents r ON r.resident_id = src.resident_id', dateExpression: "DATE(CONVERT_TZ(src.created_at, @@session.time_zone, '+08:00'))", where: '1 = 1', params: [], countMode: 'residents', sexAllowed: true, sexColumn: 'LOWER(TRIM(r.sex))' };
    } else if (indicator === 'resident-active') {
      definition = { source: 'residents src', residentJoin: 'JOIN residents r ON r.resident_id = src.resident_id', dateExpression: "DATE(CONVERT_TZ(src.created_at, @@session.time_zone, '+08:00'))", where: "src.resident_status = 'Active'", params: [], countMode: 'residents', sexAllowed: true, sexColumn: 'LOWER(TRIM(r.sex))' };
    } else if (indicator === 'resident-new') {
      definition = dateQuery('residents src', "DATE(CONVERT_TZ(src.created_at, @@session.time_zone, '+08:00'))", '1 = 1', 'residents', 'JOIN residents r ON r.resident_id = src.resident_id');
    } else if (indicator === 'clinical-records') {
      definition = dateQuery('health_records src', 'src.record_date', '1 = 1', 'records', 'LEFT JOIN residents r ON r.resident_id = src.resident_id');
    } else if (indicator === 'seniorRegistered') {
      definition = { source: 'senior_citizen_records src', residentJoin: 'JOIN residents r ON r.resident_id = src.resident_id', dateExpression: 'DATE(src.date_registered)', where: '1 = 1', params: [], countMode: 'residents', sexAllowed: true };
    } else {
      const nutritionCategory = indicator.match(/^(operation-timbang|adolescent-bmi|adult-bmi):([a-z0-9-]+)$/);
      if (nutritionCategory?.[1] === 'operation-timbang') {
        const category = nutritionCategory[2];
        const statusSql = category === 'normal' ? "LOWER(src.wflh_status) = 'normal'"
          : category === 'underweight-thin' ? "(LOWER(src.wflh_status) LIKE '%underweight%' OR LOWER(src.wflh_status) LIKE '%thin%' OR LOWER(src.wflh_status) LIKE '%wast%' OR LOWER(src.wflh_status) LIKE '%stunt%' OR LOWER(src.wflh_status) LIKE '%mixed%')"
            : category === 'overweight' ? "LOWER(src.wflh_status) LIKE '%overweight%'"
              : category === 'obese' ? "LOWER(src.wflh_status) LIKE '%obes%'"
                : category === 'total-assessments' ? 'src.wflh_status IS NOT NULL' : null;
        if (statusSql || categoryValue) {
          definition = dateQuery('operation_timbang_assessments src', 'ot.date_recorded', statusSql || 'LOWER(ota.wflh_status) = LOWER(?)', 'records',
            'JOIN operation_timbang ot ON ot.timbang_id = src.timbang_id LEFT JOIN residents r ON r.resident_id = ot.resident_id',
            statusSql ? [] : [categoryValue]);
          definition.residentId = 'ot.resident_id';
          definition.recordId = 'ot.timbang_id';
          definition.dateExpression = 'ot.date_recorded';
        }
      } else if (nutritionCategory?.[1] === 'adolescent-bmi' && ['severe-thinness', 'thinness', 'normal', 'overweight', 'obesity'].includes(nutritionCategory[2])) {
        const label = nutritionCategory[2].replace(/-/g, ' ');
        definition = dateQuery('adolescent_bmi_records src', 'src.record_date', 'LOWER(src.bmi_for_age_category) = ?', 'records',
          'LEFT JOIN residents r ON r.resident_id = src.resident_id', [label]);
        definition.recordId = 'src.record_id';
      } else if (nutritionCategory?.[1] === 'adolescent-bmi' && nutritionCategory[2] === 'total-assessments') {
        definition = dateQuery('adolescent_bmi_records src', 'src.record_date', 'src.bmi_for_age_category IS NOT NULL', 'records', 'LEFT JOIN residents r ON r.resident_id = src.resident_id');
        definition.recordId = 'src.record_id';
      } else if (nutritionCategory?.[1] === 'adolescent-bmi' && categoryValue) {
        definition = dateQuery('adolescent_bmi_records src', 'src.record_date', 'LOWER(src.bmi_for_age_category) = LOWER(?)', 'records',
          'LEFT JOIN residents r ON r.resident_id = src.resident_id', [categoryValue]);
        definition.recordId = 'src.record_id';
      } else if (nutritionCategory?.[1] === 'adult-bmi' && ['underweight', 'normal', 'overweight', 'obese'].includes(nutritionCategory[2])) {
        definition = dateQuery('adult_bmi_records src', 'src.date_recorded', 'LOWER(src.bmi_category) = ?', 'records',
          'LEFT JOIN residents r ON r.resident_id = src.resident_id', [nutritionCategory[2]]);
        definition.recordId = 'src.record_id';
      } else if (nutritionCategory?.[1] === 'adult-bmi' && nutritionCategory[2] === 'total-assessments') {
        definition = dateQuery('adult_bmi_records src', 'src.date_recorded', 'src.bmi_category IS NOT NULL', 'records', 'LEFT JOIN residents r ON r.resident_id = src.resident_id');
        definition.recordId = 'src.record_id';
      } else if (nutritionCategory?.[1] === 'adult-bmi' && categoryValue) {
        definition = dateQuery('adult_bmi_records src', 'src.date_recorded', 'LOWER(src.bmi_category) = LOWER(?)', 'records',
          'LEFT JOIN residents r ON r.resident_id = src.resident_id', [categoryValue]);
        definition.recordId = 'src.record_id';
      } else {
        const immunizationFields = {
          bcg: '$.bcg_date',
          hepaBWithin24Hours: '$.hepa_b1_within_24_hours_date',
          penta1: '$.vaccine_rows[0].penta_hib',
          penta2: '$.vaccine_rows[1].penta_hib',
          penta3: '$.vaccine_rows[2].penta_hib',
          opv1: '$.vaccine_rows[0].opv_ipv',
          opv2: '$.vaccine_rows[1].opv_ipv',
          opv3: '$.vaccine_rows[2].opv_ipv',
          pcv1: '$.vaccine_rows[0].pcv_1_3',
          pcv2: '$.vaccine_rows[1].pcv_1_3',
          pcv3: '$.vaccine_rows[2].pcv_1_3',
          mmrRecorded: '$.mmr_date',
          vitaminA6To11Months: '$.vitamin_a_first_dose_date',
          vitaminA12To15Months: '$.vitamin_a_second_dose_date',
        };
        const immunizationPath = immunizationFields[indicator];
        if (immunizationPath) {
          const valueExpression = `NULLIF(JSON_UNQUOTE(JSON_EXTRACT(src.record_data, '${immunizationPath}')), '')`;
          const periodExpression = "COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(src.record_data, '$.visit_date')), ''), DATE_FORMAT(CONVERT_TZ(src.created_at, @@session.time_zone, '+08:00'), '%Y-%m-%d'))";
          definition = dateQuery('immunization_records src', periodExpression, `${valueExpression} IS NOT NULL`, 'residents',
            'JOIN residents r ON r.resident_id = src.resident_id');
          definition.dateExpression = periodExpression;
          definition.recordId = 'src.id';
          definition.residentId = 'src.resident_id';
        } else if (indicator === 'womenSeen' || indicator === 'ttStatusDocumented') {
          const condition = indicator === 'ttStatusDocumented'
            ? "NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(src.record_data, '$.tt_status'))), '') IS NOT NULL"
            : '1 = 1';
          const periodExpression = "COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(src.record_data, '$.visit_date')), ''), DATE_FORMAT(CONVERT_TZ(src.created_at, @@session.time_zone, '+08:00'), '%Y-%m-%d'))";
          definition = dateQuery('maternal_records src', periodExpression, condition, 'residents',
            'JOIN residents r ON r.resident_id = src.resident_id');
          definition.dateExpression = periodExpression;
          definition.recordId = 'src.id';
          definition.residentId = 'src.resident_id';
        }
      }
    }

    if (!definition) return res.status(400).json({ success: false, message: 'This indicator cannot be drilled down.' });
    const whereParts = [definition.where];
    const params = [...definition.params];
    if (sex !== 'total' && sex && definition.sexAllowed) {
      whereParts.push(`${definition.sexColumn || 'LOWER(r.sex)'} = ?`);
      params.push(sex);
    }
    if (search) {
      whereParts.push("CONCAT_WS(' ', r.first_name, r.middle_name, r.last_name, r.suffix) LIKE ?");
      params.push(`%${search}%`);
    }
    const whereSql = whereParts.join(' AND ');
    const countExpression = definition.countMode === 'residents' ? 'COUNT(DISTINCT r.resident_id)' : 'COUNT(*)';
    const [[countRow]] = await pool.query(`SELECT ${countExpression} AS total FROM ${definition.source} ${definition.residentJoin} WHERE ${whereSql}`, params);
    const distinct = definition.countMode === 'residents' ? 'DISTINCT ' : '';
    const recordId = definition.countMode === 'residents'
      ? 'r.resident_id'
      : definition.recordId || 'src.health_record_id';
    const relevantDate = definition.countMode === 'residents' && !['resident-new', 'resident-total', 'resident-active', 'seniorRegistered'].includes(indicator)
      ? 'NULL'
      : definition.dateExpression;
    const orderBy = definition.countMode === 'residents' && relevantDate === 'NULL'
      ? 'r.last_name, r.first_name'
      : `${definition.dateExpression} DESC, r.last_name, r.first_name`;
    const [items] = await pool.query(`
      SELECT ${distinct}${recordId} AS drilldown_id, r.resident_id,
        CONCAT_WS(' ', r.first_name, r.middle_name, r.last_name, r.suffix) AS name,
        TIMESTAMPDIFF(YEAR, r.birthdate, ?) AS age,
        LOWER(TRIM(r.sex)) AS sex, r.sitio,
        DATE_FORMAT(${relevantDate}, '%Y-%m-%d') AS relevant_date
      FROM ${definition.source} ${definition.residentJoin}
      WHERE ${whereSql}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `, [today, ...params, pageSize, (page - 1) * pageSize]);
    return res.json({
      success: true,
      data: {
        items,
        total: Number(countRow?.total || 0),
        page,
        pageSize,
        period: { from, to },
      },
    });
  } catch (error) {
    logger.error('getFhsisDrilldown error', error);
    return res.status(500).json({ success: false, message: 'Unable to load FHSIS count details.' });
  }
};
const getNutritionReport = async (req, res) => {
  try {
    const [operationTimbang] = await pool.query(`
      SELECT ota.wflh_status AS status, COUNT(*) AS total
      FROM operation_timbang_assessments ota
      WHERE ota.wflh_status IS NOT NULL
      GROUP BY ota.wflh_status
    `);

    const [adolescent] = await pool.query(`
      SELECT abr.bmi_for_age_category AS status, COUNT(*) AS total
      FROM adolescent_bmi_records abr
      WHERE abr.bmi_for_age_category IS NOT NULL
      GROUP BY abr.bmi_for_age_category
    `);

    const [adult] = await pool.query(`
      SELECT abr.bmi_category AS status, COUNT(*) AS total
      FROM adult_bmi_records abr
      WHERE abr.bmi_category IS NOT NULL
      GROUP BY abr.bmi_category
    `);

    return res.json({
      success: true,
      data: {
        operationTimbang,
        adolescent,
        adult,
      },
    });
  } catch (error) {
    logger.error('getNutritionReport error', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getOperationTimbangReport = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT r.sex, COUNT(*) AS total
      FROM operation_timbang ot
      LEFT JOIN residents r ON ot.resident_id = r.resident_id
      GROUP BY r.sex
    `);
    return res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('getOperationTimbangReport error', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getAdolescentBMIReport = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT bmi_for_age_category AS category, COUNT(*) AS total
      FROM adolescent_bmi_records
      GROUP BY bmi_for_age_category
    `);
    return res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('getAdolescentBMIReport error', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getAdultBMIReport = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT bmi_category AS category, COUNT(*) AS total
      FROM adult_bmi_records
      GROUP BY bmi_category
    `);
    return res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('getAdultBMIReport error', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
  getMonthlyReport,
  getFhsisReport,
  getFhsisRemarks,
  saveFhsisRemark,
  getFhsisDrilldown,
  getNutritionReport,
  getOperationTimbangReport,
  getAdolescentBMIReport,
  getAdultBMIReport,
};
