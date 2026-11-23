/**
 * Dashboard Controller
 * Provides summary statistics and health metrics for the dashboard
 */

const pool = require('../config/database');
const logger = require('../services/logger');
const SITIOS = require('../config/sitios');
const { getManilaToday: getManilaDate } = require('../services/manilaDateService');
const dashboardSummaryCache = require('../services/dashboardSummaryCache');
const { classifyOperationTimbang, normalizeNutritionStatus } = require('../services/nutritionClassificationService');

/**
 * Get dashboard summary statistics
 */
function getManilaToday() {
  const text = getManilaDate();
  const [year, month, day] = text.split('-').map(Number);
  return { year, month, day, text };
}

function monthStart(year, month) {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function addMonths(year, month, delta) {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

async function getRecentActivityItems() {
  const [rows] = await pool.query(`
    SELECT * FROM (
      SELECT hr.health_record_id AS record_id, hr.resident_id, r.first_name, r.last_name,
        'clinical' AS record_type, 'Clinical record' AS record_label,
        COALESCE(NULLIF(hr.assessment,''), NULLIF(hr.chief_complaint,''), NULLIF(hr.notes,''), 'Clinical record') AS summary,
        DATE_FORMAT(hr.record_date,'%Y-%m-%d') AS record_date, u.full_name AS recorded_by_name,
        COALESCE(hr.updated_at, hr.created_at) AS activity_at
      FROM health_records hr
      JOIN residents r ON r.resident_id=hr.resident_id
      LEFT JOIN users u ON u.user_id=hr.recorded_by

      UNION ALL SELECT pcr.id, pcr.resident_id, r.first_name, r.last_name,
        'clinical_form', 'Clinical record',
        COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(pcr.record_data,'$.assessment')),''),
          NULLIF(JSON_UNQUOTE(JSON_EXTRACT(pcr.record_data,'$.chief_complaint')),''), 'Clinical record'),
        COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(pcr.record_data,'$.visit_date')),''),
          DATE_FORMAT(pcr.created_at,'%Y-%m-%d')), u.full_name,
        COALESCE(pcr.updated_at, pcr.created_at)
      FROM patient_clinical_records pcr
      JOIN residents r ON r.resident_id=pcr.resident_id
      LEFT JOIN users u ON u.user_id=pcr.recorded_by

      UNION ALL SELECT chr.id, chr.resident_id, r.first_name, r.last_name,
        'child_health', 'Child health record',
        COALESCE(NULLIF(chr.assessment,''), NULLIF(chr.findings,''), NULLIF(chr.plan,''), 'Child health record'),
        DATE_FORMAT(chr.record_date,'%Y-%m-%d'), u.full_name,
        COALESCE(chr.updated_at, chr.created_at)
      FROM child_health_records chr
      JOIN residents r ON r.resident_id=chr.resident_id
      LEFT JOIN users u ON u.user_id=chr.recorded_by

      UNION ALL SELECT cr.id, cr.resident_id, r.first_name, r.last_name,
        'child', 'Child record',
        COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(cr.record_data,'$.assessment')),''),
          NULLIF(JSON_UNQUOTE(JSON_EXTRACT(cr.record_data,'$.chief_complaint')),''), 'Child record'),
        COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(cr.record_data,'$.visit_date')),''),
          DATE_FORMAT(cr.created_at,'%Y-%m-%d')), u.full_name,
        COALESCE(cr.updated_at, cr.created_at)
      FROM child_records cr
      JOIN residents r ON r.resident_id=cr.resident_id
      LEFT JOIN users u ON u.user_id=cr.recorded_by

      UNION ALL SELECT ot.timbang_id, ot.resident_id, r.first_name, r.last_name,
        'operation_timbang', 'Operation Timbang',
        CONCAT_WS(' · ', CONCAT(COALESCE(ot.weight_kg,'-'),' kg'), NULLIF(ota.wflh_status,'')),
        DATE_FORMAT(ot.date_recorded,'%Y-%m-%d'), u.full_name, ot.created_at
      FROM operation_timbang ot
      JOIN residents r ON r.resident_id=ot.resident_id
      LEFT JOIN users u ON u.user_id=ot.recorded_by
      LEFT JOIN operation_timbang_assessments ota ON ota.timbang_id=ot.timbang_id

      UNION ALL SELECT mr.id, mr.resident_id, r.first_name, r.last_name,
        'maternal', 'Maternal record',
        COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(mr.record_data,'$.assessment')),''),
          NULLIF(JSON_UNQUOTE(JSON_EXTRACT(mr.record_data,'$.chief_complaint')),''), 'Maternal record'),
        COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(mr.record_data,'$.visit_date')),''),
          DATE_FORMAT(mr.created_at,'%Y-%m-%d')), u.full_name,
        COALESCE(mr.updated_at, mr.created_at)
      FROM maternal_records mr
      JOIN residents r ON r.resident_id=mr.resident_id
      LEFT JOIN users u ON u.user_id=mr.recorded_by

      UNION ALL SELECT ir.id, ir.resident_id, r.first_name, r.last_name,
        'immunization', 'Immunization record',
        COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ir.record_data,'$.vaccine_summary')),''), 'Vaccine record'),
        COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ir.record_data,'$.visit_date')),''),
          DATE_FORMAT(ir.created_at,'%Y-%m-%d')), u.full_name,
        COALESCE(ir.updated_at, ir.created_at)
      FROM immunization_records ir
      JOIN residents r ON r.resident_id=ir.resident_id
      LEFT JOIN users u ON u.user_id=ir.recorded_by

      UNION ALL SELECT abr.record_id, abr.resident_id, r.first_name, r.last_name,
        'adolescent_bmi', 'Adolescent BMI assessment',
        CONCAT_WS(' · ', CONCAT(COALESCE(abr.bmi,'-'),' BMI'), NULLIF(abr.bmi_for_age_category,'')),
        DATE_FORMAT(abr.record_date,'%Y-%m-%d'), u.full_name, abr.created_at
      FROM adolescent_bmi_records abr
      JOIN residents r ON r.resident_id=abr.resident_id
      LEFT JOIN users u ON u.user_id=abr.recorded_by

      UNION ALL SELECT abr.bmi_id, abr.resident_id, r.first_name, r.last_name,
        'adult_bmi', 'Adult BMI assessment',
        CONCAT_WS(' · ', CONCAT(COALESCE(abr.bmi,'-'),' BMI'), NULLIF(abr.bmi_category,'')),
        DATE_FORMAT(abr.date_recorded,'%Y-%m-%d'), u.full_name, abr.created_at
      FROM adult_bmi_records abr
      JOIN residents r ON r.resident_id=abr.resident_id
      LEFT JOIN users u ON u.user_id=abr.recorded_by
    ) activity
    ORDER BY activity_at DESC, record_id DESC
    LIMIT 8
  `);

  return (rows || []).map((row) => ({
    id: `${row.record_type}-${row.record_id}`,
    residentId: row.resident_id,
    residentName: [row.first_name, row.last_name].filter(Boolean).join(' ').trim(),
    type: row.record_type,
    label: row.record_label,
    summary: row.summary,
    recordedBy: row.recorded_by_name || 'Unknown user',
    date: row.record_date,
    createdAt: row.activity_at,
  }));
}

const getRecentActivity = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const data = await getRecentActivityItems();
    return res.json({ success: true, data });
  } catch (err) {
    logger.error('getRecentActivity error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

function resolveRange(query) {
  const today = getManilaToday();
  const allowed = new Set(['this_month', 'last_30_days', 'last_3_months', 'this_year', 'custom']);
  const range = allowed.has(String(query.range || 'this_month')) ? String(query.range) : 'this_month';
  if (range === 'last_30_days') {
    const start = new Date(Date.UTC(today.year, today.month - 1, today.day - 29));
    return { range, from: start.toISOString().slice(0, 10), to: today.text };
  }
  if (range === 'last_3_months') {
    const start = addMonths(today.year, today.month, -2);
    return { range, from: monthStart(start.year, start.month), to: today.text };
  }
  if (range === 'this_year') return { range, from: `${today.year}-01-01`, to: today.text };
  if (range === 'custom') return {
    range,
    from: /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : monthStart(today.year, today.month),
    to: /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : today.text
  };
  return { range, from: monthStart(today.year, today.month), to: today.text };
}

const getSummary = async (req, res) => {
  try {
    const resolved = resolveRange(req.query);
    const cacheKey = `${resolved.range}:${resolved.from}:${resolved.to}`;
    const cached = dashboardSummaryCache.get(cacheKey);
    if (cached) return res.json({ success: true, data: cached });

    const today = getManilaToday();
    const currentMonth = monthStart(today.year, today.month);
    const previous = addMonths(today.year, today.month, -1);
    const previousMonth = monthStart(previous.year, previous.month);

    const [residentAuditRows] = await pool.query(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN LOWER(TRIM(sex))='male' THEN 1 ELSE 0 END) AS male,
        SUM(CASE WHEN LOWER(TRIM(sex))='female' THEN 1 ELSE 0 END) AS female,
        SUM(CASE WHEN sex IS NULL OR TRIM(sex)='' OR LOWER(TRIM(sex)) NOT IN ('male','female') THEN 1 ELSE 0 END) AS unspecified,
        SUM(CASE WHEN sitio IS NULL OR TRIM(sitio)='' THEN 1 ELSE 0 END) AS no_sitio,
        SUM(TIMESTAMPDIFF(YEAR,birthdate,?) < 5) AS under5,
        SUM(TIMESTAMPDIFF(YEAR,birthdate,?) BETWEEN 5 AND 19) AS age5_19,
        SUM(TIMESTAMPDIFF(YEAR,birthdate,?) BETWEEN 20 AND 59) AS age20_59,
        SUM(TIMESTAMPDIFF(YEAR,birthdate,?) >= 60) AS age60_plus,
        SUM(TIMESTAMPDIFF(YEAR,birthdate,?) >= 60 AND NOT EXISTS
          (SELECT 1 FROM senior_citizen_records s WHERE s.resident_id=residents.resident_id)) AS unregistered_seniors,
        SUM(is_4ps=1) AS fourps,
        SUM(pregnant=1) AS pregnant,
        SUM(lactating=1) AS lactating,
        SUM(JSON_CONTAINS(COALESCE(category_flags,JSON_ARRAY()),JSON_QUOTE('PWD'))) AS pwd,
        SUM(resident_status='Active') AS active,
        SUM(resident_status='Inactive') AS inactive,
        SUM(resident_status='Transferred') AS transferred,
        SUM(resident_status='Deceased') AS deceased,
        SUM(DATE(CONVERT_TZ(created_at, @@session.time_zone, '+08:00')) >= ?
          AND DATE(CONVERT_TZ(created_at, @@session.time_zone, '+08:00')) < DATE_ADD(?, INTERVAL 1 MONTH)) AS added_current_month,
        SUM(DATE(CONVERT_TZ(created_at, @@session.time_zone, '+08:00')) >= ?
          AND DATE(CONVERT_TZ(created_at, @@session.time_zone, '+08:00')) < ?) AS added_previous_month
      FROM residents
      WHERE birthdate IS NOT NULL OR resident_id IS NOT NULL
    `, [today.text, today.text, today.text, today.text, today.text, currentMonth, currentMonth, previousMonth, currentMonth]);
    const residentAudit = residentAuditRows[0] || {};

    const [ageSexRows] = await pool.query(`
      SELECT CASE
        WHEN TIMESTAMPDIFF(YEAR,birthdate,?) < 5 THEN '0-4'
        WHEN TIMESTAMPDIFF(YEAR,birthdate,?) BETWEEN 5 AND 19 THEN '5-19'
        WHEN TIMESTAMPDIFF(YEAR,birthdate,?) BETWEEN 20 AND 59 THEN '20-59'
        ELSE '60+' END AS age_group,
        LOWER(TRIM(sex)) AS sex, COUNT(*) AS count
      FROM residents WHERE birthdate IS NOT NULL
      GROUP BY age_group, sex
    `, [today.text, today.text, today.text]);

    const [[seniorRow]] = await pool.query(`
      SELECT COUNT(DISTINCT scr.resident_id) AS registered
      FROM senior_citizen_records scr
      JOIN residents r ON r.resident_id = scr.resident_id
    `);
    const [[seniorEmergencyRow]] = await pool.query(`SELECT COUNT(*) AS count FROM senior_citizen_records
      WHERE emergency_contact_number IS NULL OR TRIM(emergency_contact_number)=''`);

    const [trendRows] = await pool.query(`
      SELECT DATE_FORMAT(date_recorded,'%Y-%m') AS month, record_type, COUNT(*) AS count
      FROM (
        SELECT record_date AS date_recorded, 'clinical' AS record_type FROM health_records WHERE record_date >= ? AND record_date <= ?
        UNION ALL SELECT record_date, 'child' FROM child_health_records WHERE record_date >= ? AND record_date <= ?
        UNION ALL SELECT COALESCE(JSON_UNQUOTE(JSON_EXTRACT(record_data,'$.visit_date')),DATE_FORMAT(created_at,'%Y-%m-%d')), 'clinical' FROM patient_clinical_records
          WHERE COALESCE(JSON_UNQUOTE(JSON_EXTRACT(record_data,'$.visit_date')),DATE_FORMAT(created_at,'%Y-%m-%d')) >= ? AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(record_data,'$.visit_date')),DATE_FORMAT(created_at,'%Y-%m-%d')) <= ?
        UNION ALL SELECT COALESCE(JSON_UNQUOTE(JSON_EXTRACT(record_data,'$.visit_date')),DATE_FORMAT(created_at,'%Y-%m-%d')), 'child' FROM child_records
          WHERE COALESCE(JSON_UNQUOTE(JSON_EXTRACT(record_data,'$.visit_date')),DATE_FORMAT(created_at,'%Y-%m-%d')) >= ? AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(record_data,'$.visit_date')),DATE_FORMAT(created_at,'%Y-%m-%d')) <= ?
        UNION ALL SELECT COALESCE(JSON_UNQUOTE(JSON_EXTRACT(record_data,'$.visit_date')),DATE_FORMAT(created_at,'%Y-%m-%d')), 'maternal' FROM maternal_records
          WHERE COALESCE(JSON_UNQUOTE(JSON_EXTRACT(record_data,'$.visit_date')),DATE_FORMAT(created_at,'%Y-%m-%d')) >= ? AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(record_data,'$.visit_date')),DATE_FORMAT(created_at,'%Y-%m-%d')) <= ?
        UNION ALL SELECT COALESCE(JSON_UNQUOTE(JSON_EXTRACT(record_data,'$.visit_date')),DATE_FORMAT(created_at,'%Y-%m-%d')), 'immunization' FROM immunization_records
          WHERE COALESCE(JSON_UNQUOTE(JSON_EXTRACT(record_data,'$.visit_date')),DATE_FORMAT(created_at,'%Y-%m-%d')) >= ? AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(record_data,'$.visit_date')),DATE_FORMAT(created_at,'%Y-%m-%d')) <= ?
      ) records GROUP BY month, record_type ORDER BY month, record_type
    `, [resolved.from,resolved.to,resolved.from,resolved.to,resolved.from,resolved.to,resolved.from,resolved.to,resolved.from,resolved.to,resolved.from,resolved.to]);

    const months = [];
    const startParts = resolved.from.split('-').map(Number);
    const endParts = resolved.to.split('-').map(Number);
    if (startParts.length === 3 && endParts.length === 3) {
      let cursor = addMonths(startParts[0], startParts[1], 0);
      const endIndex = endParts[0] * 12 + endParts[1];
      const startIndex = startParts[0] * 12 + startParts[1];
      for (let i = 0; i <= Math.min(23, endIndex - startIndex); i += 1) {
        const value = addMonths(cursor.year, cursor.month, i);
        months.push(`${value.year}-${String(value.month).padStart(2, '0')}`);
      }
    }
    if (!months.length) {
      const value = `${today.year}-${String(today.month).padStart(2,'0')}`;
      months.push(value);
    }
    const trendMap = {};
    months.forEach((month) => { trendMap[month] = { month, clinical: 0, child: 0, maternal: 0, immunization: 0 }; });
    trendRows.forEach((row) => { if (trendMap[row.month]) trendMap[row.month][row.record_type] = Number(row.count || 0); });

    const chartMonths = Array.from({ length: 12 }, (_, index) => {
      const value = addMonths(today.year, today.month, index - 11);
      return `${value.year}-${String(value.month).padStart(2, '0')}`;
    });
    const chartStart = `${chartMonths[0]}-01`;

    const [sitioRows] = await pool.query(`SELECT sitio, COUNT(*) AS count FROM residents
      WHERE sitio IS NOT NULL AND TRIM(sitio)<>'' GROUP BY sitio ORDER BY count DESC, sitio ASC`);
    const sitio = (sitioRows || []).map((row) => ({ label: row.sitio, count: Number(row.count), isNoSitio: false }));
    if (Number(residentAudit.no_sitio || 0) > 0) sitio.push({ label: 'No sitio recorded', count: Number(residentAudit.no_sitio), isNoSitio: true });

    const [timbangRows] = await pool.query(`SELECT ota.wfa_status, ota.hfa_status, ota.wflh_status
      FROM operation_timbang_assessments ota JOIN operation_timbang ot ON ot.timbang_id=ota.timbang_id
      JOIN residents r ON r.resident_id=ot.resident_id
      WHERE ot.date_recorded >= ? AND TIMESTAMPDIFF(MONTH,r.birthdate,ot.date_recorded) BETWEEN 0 AND 59`, [`${today.year}-01-01`]);
    const [[timbangEligibleRow]] = await pool.query(`SELECT COUNT(*) AS count FROM residents
      WHERE TIMESTAMPDIFF(MONTH,birthdate,?) BETWEEN 0 AND 59`, [today.text]);
    const [[timbangWeighedRow]] = await pool.query(`SELECT COUNT(DISTINCT ot.resident_id) AS count
      FROM operation_timbang ot JOIN residents r ON r.resident_id=ot.resident_id
      WHERE ot.date_recorded >= ? AND ot.date_recorded <= ? AND TIMESTAMPDIFF(MONTH,r.birthdate,ot.date_recorded) BETWEEN 0 AND 59`, [`${today.year}-01-01`, today.text]);

    const [adultNutrition] = await pool.query('SELECT bmi_category AS category, COUNT(*) AS count FROM adult_bmi_records WHERE bmi_category IS NOT NULL GROUP BY bmi_category');
    const [adolescentNutrition] = await pool.query('SELECT bmi_for_age_category AS category, COUNT(*) AS count FROM adolescent_bmi_records WHERE bmi_for_age_category IS NOT NULL GROUP BY bmi_for_age_category');
    const [nutritionRecordRows] = await pool.query(`
      SELECT 'child' AS record_group, ota.wfa_status, ota.hfa_status, ota.wflh_status, NULL AS status
      FROM operation_timbang ot
      LEFT JOIN operation_timbang_assessments ota ON ota.timbang_id = ot.timbang_id
      UNION ALL
      SELECT 'adolescent' AS record_group, NULL, NULL, NULL, abr.bmi_for_age_category
      FROM adolescent_bmi_records abr
      UNION ALL
      SELECT 'adult' AS record_group, NULL, NULL, NULL, adult.bmi_category
      FROM adult_bmi_records adult
    `);
    const fixedCategories = ['Severely underweight','Moderately underweight','Underweight','Severely wasted/SAM','Moderately wasted/MAM','Thinness','Severe Thinness','Normal','Overweight','Obese','Tall','Moderately stunted','Severely stunted'];
    const normalizeNutrition = (rows) => {
      const map = {};
      (rows || []).forEach((row) => { map[row.category] = Number(row.count || 0); });
      const categories = [...fixedCategories];
      Object.keys(map).forEach((category) => { if (!categories.includes(category)) categories.push(category); });
      return categories.map((category) => ({ category, count: map[category] || 0 }));
    };
    const nutritionByType = { child: new Map(), adolescent: new Map(), adult: new Map() };
    (nutritionRecordRows || []).forEach((row) => {
      const status = row.record_group === 'child'
        ? classifyOperationTimbang(row).status
        : normalizeNutritionStatus(row.status);
      if (!status) return;
      const counts = nutritionByType[row.record_group];
      counts.set(status, (counts.get(status) || 0) + 1);
    });
    const nutritionCounts = (counts) => normalizeNutrition(
      [...counts.entries()].map(([category, count]) => ({ category, count }))
    );

    const [nutritionRiskRows] = await pool.query(`SELECT COUNT(DISTINCT resident_id) AS count FROM (
      SELECT ot.resident_id FROM operation_timbang_assessments ota JOIN operation_timbang ot ON ot.timbang_id=ota.timbang_id
      WHERE LOWER(COALESCE(ota.wfa_status,'')) LIKE '%underweight%' OR LOWER(COALESCE(ota.wflh_status,'')) LIKE '%wasted%' OR LOWER(COALESCE(ota.wflh_status,'')) LIKE '%obese%' OR LOWER(COALESCE(ota.wflh_status,'')) LIKE '%overweight%' OR LOWER(COALESCE(ota.hfa_status,'')) LIKE '%stunted%'
      UNION SELECT resident_id FROM adolescent_bmi_records WHERE LOWER(COALESCE(bmi_for_age_category,'')) IN ('severe thinness','thinness','overweight','obese')
      UNION SELECT resident_id FROM adult_bmi_records WHERE LOWER(COALESCE(bmi_category,'')) IN ('underweight','overweight','obese')
    ) risk`);

    const recentActivity = await getRecentActivityItems();

    const [nutritionTrendRows] = await pool.query(`
      SELECT DATE_FORMAT(ot.date_recorded,'%Y-%m') AS month, LOWER(TRIM(ota.wfa_status)) AS category, COUNT(*) AS count
      FROM operation_timbang ot
      JOIN residents r ON r.resident_id=ot.resident_id
      JOIN operation_timbang_assessments ota ON ota.timbang_id=ot.timbang_id
      WHERE ot.date_recorded >= ? AND ot.date_recorded <= ?
        AND TIMESTAMPDIFF(MONTH,r.birthdate,ot.date_recorded) BETWEEN 0 AND 59
        AND ota.wfa_status IS NOT NULL AND TRIM(ota.wfa_status)<>''
      GROUP BY month, category
    `, [chartStart, today.text]);
    const [timbangMonthlyRows] = await pool.query(`
      SELECT DATE_FORMAT(ot.date_recorded,'%Y-%m') AS month, COUNT(DISTINCT ot.timbang_id) AS count
      FROM operation_timbang ot
      JOIN residents r ON r.resident_id=ot.resident_id
      WHERE ot.date_recorded >= ? AND ot.date_recorded <= ?
        AND TIMESTAMPDIFF(MONTH,r.birthdate,ot.date_recorded) BETWEEN 0 AND 59
      GROUP BY month
    `, [chartStart, today.text]);
    const [recentResidentRows] = await pool.query(`
      SELECT resident_id, first_name, middle_name, last_name, sex, resident_status,
        TIMESTAMPDIFF(YEAR,birthdate,?) AS age,
        DATE_FORMAT(CONVERT_TZ(created_at, @@session.time_zone, '+08:00'), '%Y-%m-%d') AS registered_on
      FROM residents
      ORDER BY created_at DESC, resident_id DESC
      LIMIT 5
    `, [today.text]);

    const nutritionTrendByMonth = {};
    chartMonths.forEach((month) => {
      nutritionTrendByMonth[month] = { month, assessed: 0, normal: 0, underweight: 0, overweight: 0 };
    });
    nutritionTrendRows.forEach((row) => {
      const month = nutritionTrendByMonth[row.month];
      if (!month) return;
      const count = Number(row.count || 0);
      if (row.category === 'normal') month.normal += count;
      else if (row.category.includes('underweight')) month.underweight += count;
      else if (row.category === 'overweight' || row.category === 'obese') month.overweight += count;
      else return;
      month.assessed += count;
    });
    const nutritionTrend = chartMonths.map((month) => {
      const row = nutritionTrendByMonth[month];
      const percent = (count) => row.assessed ? Number(((count / row.assessed) * 100).toFixed(1)) : 0;
      return {
        month,
        assessed: row.assessed,
        normal: percent(row.normal),
        underweight: percent(row.underweight),
        overweight: percent(row.overweight)
      };
    });
    const timbangMonthlyByMonth = {};
    timbangMonthlyRows.forEach((row) => { timbangMonthlyByMonth[row.month] = Number(row.count || 0); });
    const timbangMonthly = chartMonths.map((month) => ({ month, count: timbangMonthlyByMonth[month] || 0 }));

    const [[noContactRow]] = await pool.query(`SELECT COUNT(*) AS count FROM residents WHERE contact_no IS NULL OR TRIM(contact_no)=''`);
    const under5 = Number(residentAudit.under5 || 0);
    const adultEligible = Math.max(0, Number(residentAudit.total || 0) - Number(residentAudit.under5 || 0) - Math.max(0, Number(residentAudit.age5_19 || 0)));
    const adolescentEligible = Math.max(0, Number(residentAudit.age5_19 || 0));
    const eligibleThisYear = Number(timbangEligibleRow.count || 0);
    const weighedThisYear = Number(timbangWeighedRow.count || 0);
    const unregisteredSenior = Number(residentAudit.unregistered_seniors || 0);
    const nutritionCases = Number(nutritionRiskRows[0]?.count || 0);

    const recordsCurrentPeriod = Object.values(trendMap).reduce((total, row) => total + Number(row.clinical || 0) + Number(row.child || 0) + Number(row.maternal || 0) + Number(row.immunization || 0), 0);

    const attention = [];
    if (unregisteredSenior > 0) attention.push({ severity:'high', count:unregisteredSenior, title:`${unregisteredSenior} senior ${unregisteredSenior===1?'resident is':'residents are'} not yet registered`, description:'Age 60+ without a Senior Registry record.', icon:'senior', filter:'/residents?classification=Senior%20Citizen' });
    if (Number(seniorEmergencyRow.count || 0) > 0) attention.push({ severity:'medium', count:Number(seniorEmergencyRow.count), title:'Senior records need an emergency contact', description:'Review Senior Registry emergency contact details.', icon:'contact', filter:'/senior-citizens' });
    if (Number(residentAudit.no_sitio || 0) > 0) attention.push({ severity:'medium', count:Number(residentAudit.no_sitio), title:'Residents have no sitio recorded', description:'Complete area classification to improve location reports.', icon:'location', filter:'/residents?sitio=no-sitio' });
    if (Number(noContactRow.count || 0) > 0) attention.push({ severity:'medium', count:Number(noContactRow.count), title:'Residents have no contact number', description:'Contact information is missing from the resident directory.', icon:'contact', filter:'/residents?no_contact=1' });
    if (nutritionCases > 0) attention.push({ severity:'high', count:nutritionCases, title:'Nutrition cases need follow-up', description:'Underweight, thinness, stunting, overweight, or obesity risk recorded.', icon:'nutrition', filter:'/nutrition' });

    const generatedAt = new Date().toISOString();
    const data = {
      barangayName: process.env.BARANGAY_NAME?.trim() || null,
      generatedAt,
      range: resolved,
      kpis: {
        totalResidents:Number(residentAudit.total || 0), addedCurrentMonth:Number(residentAudit.added_current_month || 0), addedPreviousMonth:Number(residentAudit.added_previous_month || 0),
        seniorCitizens:{ value:Number(seniorRow.registered || 0), eligible:Number(residentAudit.age60_plus || 0), unregistered:unregisteredSenior },
        childrenUnder5:{ value:under5, weighedThisYear:weighedThisYear, eligibleThisYear },
        recordsThisMonth:{ value:recordsCurrentPeriod, previousMonth:0 },
        nutritionCases, pendingSync:0
      },
      population:{ ageSex:(ageSexRows || []).map((row)=>({ ageGroup:row.age_group, sex:row.sex || 'unspecified', count:Number(row.count || 0) })), male:Number(residentAudit.male || 0), female:Number(residentAudit.female || 0), unspecified:Number(residentAudit.unspecified || 0) },
      groups:{ senior:Number(residentAudit.age60_plus || 0), pwd:Number(residentAudit.pwd || 0), fourPs:Number(residentAudit.fourps || 0), pregnant:Number(residentAudit.pregnant || 0), lactating:Number(residentAudit.lactating || 0), status:{ Active:Number(residentAudit.active || 0), Inactive:Number(residentAudit.inactive || 0), Transferred:Number(residentAudit.transferred || 0), Deceased:Number(residentAudit.deceased || 0) } },
      recordsTrend: months.map((month) => trendMap[month]),
      nutritionTrend,
      nutrition:{
        child:nutritionCounts(nutritionByType.child),
        adolescent:nutritionCounts(nutritionByType.adolescent),
        adult:nutritionCounts(nutritionByType.adult),
        assessed:{ child:timbangRows.length, adolescent:adolescentNutrition.reduce((sum,row)=>sum+Number(row.count || 0),0), adult:adultNutrition.reduce((sum,row)=>sum+Number(row.count || 0),0) },
        eligible:{ child:under5, adolescent:adolescentEligible, adult:adultEligible }
      },
      sitio,
      timbang:{ eligible:eligibleThisYear, weighed:weighedThisYear, coveragePercent:eligibleThisYear>0 ? Math.min(100,Math.round((weighedThisYear/eligibleThisYear)*100)) : 0, byResult:timbangRows.reduce((result,row)=>{ [row.wfa_status,row.hfa_status,row.wflh_status].forEach((value)=>{ if(value) result[value]=(result[value]||0)+1; }); return result; },{}) },
      timbangMonthly,
      attention:attention.sort((a,b)=>{ const severityRank={high:0,medium:1,low:2}; return severityRank[a.severity]-severityRank[b.severity]; }).slice(0,5),
      recentResidents:(recentResidentRows || []).map((row) => ({
        id: row.resident_id,
        name: [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' '),
        age: row.age === null ? null : Number(row.age),
        sex: row.sex || null,
        status: row.resident_status || 'Unknown',
        registeredOn: row.registered_on
      })),
      recentActivity,
      sync:{ pending:0, failed:0, lastSync:null }
    };
    dashboardSummaryCache.set(cacheKey, data);
    return res.json({ success:true, data });
  } catch (err) {
    logger.error('getSummary error', err);
    return res.status(500).json({ success:false, message:'Server error' });
  }
};
/**
 * Get nutrition statistics
 */
const getNutritionStats = async (req, res) => {
  try {
    const stats = {};

    // Operation Timbang nutrition status (0-59 months)
    const [otStats] = await pool.query(`
      SELECT 
        ota.wflh_status,
        COUNT(*) as count
      FROM operation_timbang_assessments ota
      WHERE ota.wflh_status IS NOT NULL
      GROUP BY ota.wflh_status
    `);

    stats.operationTimbangStatus = {};
    otStats.forEach(row => {
      if (row.wflh_status) {
        stats.operationTimbangStatus[row.wflh_status] = row.count;
      }
    });

    // Adolescent BMI distribution (5-19 years)
    const [adolBMI] = await pool.query(`
      SELECT 
        bmi_for_age_category,
        COUNT(*) as count
      FROM adolescent_bmi_records
      WHERE bmi_for_age_category IS NOT NULL
      AND record_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
      GROUP BY bmi_for_age_category
    `);

    stats.adolescentBMI = {};
    adolBMI.forEach(row => {
      if (row.bmi_for_age_category) {
        stats.adolescentBMI[row.bmi_for_age_category] = row.count;
      }
    });

    // Adult BMI distribution (20+)
    const [adultBMI] = await pool.query(`
      SELECT 
        bmi_category,
        COUNT(*) as count
      FROM adult_bmi_records
      WHERE bmi_category IS NOT NULL
      AND date_recorded >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
      GROUP BY bmi_category
    `);

    stats.adultBMI = {};
    adultBMI.forEach(row => {
      if (row.bmi_category) {
        stats.adultBMI[row.bmi_category] = row.count;
      }
    });

    return res.json({ success: true, data: stats });
  } catch (err) {
    logger.error('getNutritionStats error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * Get BMI statistics
 */
const getBMIStats = async (req, res) => {
  try {
    const stats = {};

    // Latest BMI records
    const [latestBMI] = await pool.query(`
      SELECT 
        r.first_name,
        r.last_name,
        abr.bmi,
        abr.bmi_for_age_zscore,
        abr.bmi_for_age_category,
        abr.record_date
      FROM adolescent_bmi_records abr
      LEFT JOIN residents r ON abr.resident_id = r.resident_id
      ORDER BY abr.record_date DESC
      LIMIT 10
    `);

    stats.latestAdolescentBMI = latestBMI;

    // Adult BMI latest
    const [latestAdult] = await pool.query(`
      SELECT 
        r.first_name,
        r.last_name,
        abr.bmi,
        abr.bmi_category,
        abr.date_recorded
      FROM adult_bmi_records abr
      LEFT JOIN residents r ON abr.resident_id = r.resident_id
      ORDER BY abr.date_recorded DESC
      LIMIT 10
    `);

    stats.latestAdultBMI = latestAdult;

    return res.json({ success: true, data: stats });
  } catch (err) {
    logger.error('getBMIStats error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getAdminSummary = async (req, res) => {
  try {
    const [userCounts] = await pool.query(
      'SELECT role, COUNT(*) AS count FROM users GROUP BY role ORDER BY role'
    );
    const [recentUsers] = await pool.query(
      'SELECT user_id, full_name, username, role, created_at FROM users ORDER BY created_at DESC LIMIT 8'
    );
    const [auditCount] = await pool.query(
      'SELECT COUNT(*) AS count FROM audit_logs WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)'
    );

    const normalizedRoleCounts = userCounts.reduce((counts, row) => {
      const label = row.role === 'barangay_official' ? 'official' : row.role;
      counts[label] = Number(row.count) + (counts[label] || 0);
      return counts;
    }, {});

    const normalizedRecentUsers = (recentUsers || []).map((user) => ({
      ...user,
      role: user.role === 'barangay_official' ? 'official' : user.role,
    }));

    return res.json({
      success: true,
      data: {
        totalUsers: userCounts.reduce((total, row) => total + Number(row.count), 0),
        usersByRole: normalizedRoleCounts,
        auditEventsThisMonth: Number(auditCount[0].count || 0),
        recentUsers: normalizedRecentUsers,
      }
    });
  } catch (err) {
    logger.error('getAdminSummary error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
  getSummary,
  getRecentActivity,
  getNutritionStats,
  getBMIStats,
  getAdminSummary
};
