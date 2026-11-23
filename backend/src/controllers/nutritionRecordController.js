const pool = require('../config/database');
const logger = require('../services/logger');
const { classifyOperationTimbang, normalizeNutritionStatus } = require('../services/nutritionClassificationService');

const dateOnly = (value) => value ? String(value).slice(0, 10) : null;
const normalStatus = (status) => /^normal$/i.test(String(status || '').trim());
const needsAttention = (status) => Boolean(status) && !normalStatus(status);

async function fetchRows() {
  const [children] = await pool.query(`SELECT ot.timbang_id id, ot.resident_id, 'Operation Timbang' record_type, ot.date_recorded record_date, ot.created_at,
    ot.weight_kg, ot.measurement_cm height_cm, ot.measurement_type, ota.wfa_status, ota.hfa_status, ota.wflh_status, ota.wfa_zscore, ota.hfa_zscore, ota.wflh_zscore,
    ot.recorded_by, u.full_name recorded_by_name, r.first_name, r.middle_name, r.last_name, r.suffix, r.birthdate, r.sex, r.civil_status, r.address, r.household_no, r.sitio, r.contact_no, r.philhealth_id_no, r.occupation, r.profile_photo
    FROM operation_timbang ot LEFT JOIN users u ON ot.recorded_by=u.user_id LEFT JOIN residents r ON ot.resident_id=r.resident_id LEFT JOIN operation_timbang_assessments ota ON ota.timbang_id=ot.timbang_id`);
  const [adolescent] = await pool.query(`SELECT abr.record_id id, abr.resident_id, 'Adolescent BMI' record_type, abr.record_date, abr.created_at,
    abr.weight_kg, abr.height_cm, NULL measurement_type, NULL wfa_status, NULL hfa_status, NULL wflh_status, NULL wfa_zscore, NULL hfa_zscore, NULL wflh_zscore,
    abr.bmi, abr.bmi_for_age_zscore, abr.bmi_for_age_category status, abr.recorded_by, u.full_name recorded_by_name,
    r.first_name, r.middle_name, r.last_name, r.suffix, r.birthdate, r.sex, r.civil_status, r.address, r.household_no, r.sitio, r.contact_no, r.philhealth_id_no, r.occupation, r.profile_photo
    FROM adolescent_bmi_records abr LEFT JOIN users u ON abr.recorded_by=u.user_id LEFT JOIN residents r ON abr.resident_id=r.resident_id`);
  const [adult] = await pool.query(`SELECT abr.bmi_id id, abr.resident_id, 'Adult BMI' record_type, abr.date_recorded record_date, abr.created_at,
    abr.weight_kg, abr.height_cm, NULL measurement_type, NULL wfa_status, NULL hfa_status, NULL wflh_status, NULL wfa_zscore, NULL hfa_zscore, NULL wflh_zscore,
    abr.bmi, NULL bmi_for_age_zscore, abr.bmi_category status, abr.recorded_by, u.full_name recorded_by_name,
    r.first_name, r.middle_name, r.last_name, r.suffix, r.birthdate, r.sex, r.civil_status, r.address, r.household_no, r.sitio, r.contact_no, r.philhealth_id_no, r.occupation, r.profile_photo
    FROM adult_bmi_records abr LEFT JOIN users u ON abr.recorded_by=u.user_id LEFT JOIN residents r ON abr.resident_id=r.resident_id`);
  return children.map((row) => { const child = classifyOperationTimbang(row); return { ...row, status: child.status, indicators: child.indicators, record_date: dateOnly(row.record_date) }; })
    .concat(adolescent.map((row) => ({ ...row, status: normalizeNutritionStatus(row.status), record_date: dateOnly(row.record_date), indicators: [] })))
    .concat(adult.map((row) => ({ ...row, status: normalizeNutritionStatus(row.status), record_date: dateOnly(row.record_date), indicators: [] })));
}

function matchesFilters(row, query) {
  const search = String(query.search || '').trim().toLowerCase();
  const name = [row.first_name, row.middle_name, row.last_name, row.suffix].filter(Boolean).join(' ').toLowerCase();
  if (query.resident_id && String(row.resident_id) !== String(query.resident_id)) return false;
  if (search && !`${name} ${row.record_type} ${row.status}`.toLowerCase().includes(search)) return false;
  if (query.type && query.type !== 'All' && row.record_type !== query.type) return false;
  if (query.status === 'normal' && !normalStatus(row.status)) return false;
  if (query.status === 'attention' && (!row.status || !needsAttention(row.status))) return false;
  if (query.from && row.record_date < query.from) return false;
  if (query.to && row.record_date > query.to) return false;
  if (query.sitio && String(row.sitio || '') !== query.sitio) return false;
  return true;
}

function matchesBaseFilters(row, query) {
  const search = String(query.search || '').trim().toLowerCase();
  const name = [row.first_name, row.middle_name, row.last_name, row.suffix].filter(Boolean).join(' ').toLowerCase();
  if (search && !`${name} ${row.record_type} ${row.status}`.toLowerCase().includes(search)) return false;
  if (query.status === 'normal' && !normalStatus(row.status)) return false;
  if (query.status === 'attention' && (!row.status || !needsAttention(row.status))) return false;
  if (query.from && row.record_date < query.from) return false;
  if (query.to && row.record_date > query.to) return false;
  return true;
}

async function listNutritionRecords(req, res) {
  try {
    let rows = await fetchRows();
    const counts = {
      total: rows.length,
      attention: rows.filter((row) => needsAttention(row.status)).length,
      type: {
        operation: rows.filter((row) => row.record_type === 'Operation Timbang').length,
        adolescent: rows.filter((row) => row.record_type === 'Adolescent BMI').length,
        adult: rows.filter((row) => row.record_type === 'Adult BMI').length,
      },
    };
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().toISOString().slice(0, 7);
    counts.month = rows.filter((row) => String(row.record_date || '').startsWith(currentMonth)).length;
    counts.childrenThisYear = new Set(rows.filter((row) => row.record_type === 'Operation Timbang' && String(row.record_date || '').startsWith(String(currentYear))).map((row) => row.resident_id)).size;
    const tabCountRows = rows.filter((row) => matchesBaseFilters(row, req.query));
    counts.type = {
      operation: tabCountRows.filter((row) => row.record_type === 'Operation Timbang').length,
      adolescent: tabCountRows.filter((row) => row.record_type === 'Adolescent BMI').length,
      adult: tabCountRows.filter((row) => row.record_type === 'Adult BMI').length,
    };
    rows = rows.filter((row) => matchesFilters(row, req.query));
    if (req.query.latestOnly === 'true') {
      const latest = new Map();
      rows.forEach((row) => { const key = row.resident_id; if (!latest.has(key) || row.record_date > latest.get(key).record_date || (row.record_date === latest.get(key).record_date && String(row.created_at) > String(latest.get(key).created_at))) latest.set(key, row); });
      rows = [...latest.values()];
    }
    const sort = String(req.query.sort || 'date');
    const sortOrder = req.query.order === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      let comparison = 0;
      if (sort === 'name') comparison = [a.first_name, a.last_name].join(' ').localeCompare([b.first_name, b.last_name].join(' '));
      else if (sort === 'status') comparison = Number(needsAttention(a.status)) - Number(needsAttention(b.status));
      else comparison = String(a.record_date || '').localeCompare(String(b.record_date || ''));
      if (comparison === 0 && sort !== 'date') comparison = String(a.record_date || '').localeCompare(String(b.record_date || ''));
      if (comparison === 0) comparison = String(a.created_at || '').localeCompare(String(b.created_at || ''));
      return comparison === 0 ? 0 : comparison * sortOrder;
    });
    const pageSize = [10, 25, 50].includes(Number(req.query.pageSize)) ? Number(req.query.pageSize) : 10;
    const page = Math.max(1, Number(req.query.page) || 1);
    const total = rows.length;
    const items = rows.slice((page - 1) * pageSize, page * pageSize);
    const sitos = [...new Set(items.map((row) => row.sitio).filter(Boolean))];
    return res.json({ success: true, data: { items, total, page, pageSize, counts, sitos } });
  } catch (error) { logger.error('listNutritionRecords error', error); return res.status(500).json({ success: false, message: 'Unable to load nutrition records.' }); }
}

async function getNutritionRecord(req, res) {
  try {
    const rows = await fetchRows();
    const typeMap = { operation: 'Operation Timbang', adolescent: 'Adolescent BMI', adult: 'Adult BMI' };
    const type = typeMap[String(req.params.type)] || String(req.params.type);
    const id = Number(req.params.id);
    const record = rows.find((row) => row.record_type === type && Number(row.id) === id);
    if (!record) return res.status(404).json({ success: false, message: 'Nutrition record not found.' });
    const history = rows.filter((row) => row.resident_id === record.resident_id).sort((a, b) => String(a.record_date).localeCompare(String(b.record_date)));
    const index = history.findIndex((row) => row.record_type === record.record_type && Number(row.id) === record.id);
    return res.json({ success: true, data: { ...record, history, previousId: index > 0 ? { type: history[index - 1].record_type, id: history[index - 1].id } : null, nextId: index >= 0 && index < history.length - 1 ? { type: history[index + 1].record_type, id: history[index + 1].id } : null } });
  } catch (error) { return res.status(500).json({ success: false, message: 'Unable to load nutrition record.' }); }
}

async function exportNutritionRecords(req, res) {
  try {
    let rows = (await fetchRows()).filter((row) => matchesFilters(row, req.query));
    if (req.query.latestOnly === 'true') {
      const latest = new Map();
      rows.forEach((row) => {
        const key = row.resident_id;
        if (!latest.has(key) || row.record_date > latest.get(key).record_date || (row.record_date === latest.get(key).record_date && String(row.created_at) > String(latest.get(key).created_at))) latest.set(key, row);
      });
      rows = [...latest.values()];
    }
    const sort = String(req.query.sort || 'date');
    const sortOrder = req.query.order === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      let comparison = 0;
      if (sort === 'name') comparison = [a.first_name, a.last_name].join(' ').localeCompare([b.first_name, b.last_name].join(' '));
      else if (sort === 'status') comparison = Number(needsAttention(a.status)) - Number(needsAttention(b.status));
      else comparison = String(a.record_date || '').localeCompare(String(b.record_date || ''));
      if (comparison === 0 && sort !== 'date') comparison = String(a.record_date || '').localeCompare(String(b.record_date || ''));
      if (comparison === 0) comparison = String(a.created_at || '').localeCompare(String(b.created_at || ''));
      return comparison === 0 ? 0 : comparison * sortOrder;
    });
    const header = ['Record Type','Resident','Age','Sex','Household No.','Measurement','Result / Status','Record Date','Recorded By'];
    const csvRows = rows.map((row) => {
      const birth = new Date(`${String(row.birthdate || '').slice(0,10)}T00:00:00`);
      const record = new Date(`${row.record_date}T00:00:00`);
      let months = birth && !Number.isNaN(record) ? (record.getFullYear()-birth.getFullYear())*12+record.getMonth()-birth.getMonth()-(record.getDate()<birth.getDate()?1:0) : 0;
      const age = months < 12 ? `${months} mos` : `${Math.floor(months/12)} yr${Math.floor(months/12)===1?'':'s'}${months%12?` ${months%12} mos`:''}`;
      const measurement = `${row.weight_kg || '-'} kg / ${row.height_cm || '-'} cm${row.bmi ? ` / BMI ${Number(row.bmi).toFixed(2)}` : ''}`;
      return [row.record_type,[row.first_name,row.middle_name,row.last_name,row.suffix].filter(Boolean).join(' '),age,row.sex,row.household_no,measurement,row.status,row.record_date,row.recorded_by_name||'Unknown user'];
    });
    const escape = (value) => `"${String(value ?? '').replace(/"/g,'""')}"`;
    res.setHeader('Content-Type','text/csv; charset=utf-8'); res.setHeader('Content-Disposition','attachment; filename="nutrition-records.csv"'); return res.send([header,...csvRows].map((line) => line.map(escape).join(',')).join('\n'));
  } catch (error) { return res.status(500).json({ success:false, message:'Unable to export nutrition records.' }); }
}

module.exports = { listNutritionRecords, getNutritionRecord, exportNutritionRecords };
