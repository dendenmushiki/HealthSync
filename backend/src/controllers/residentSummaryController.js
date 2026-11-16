const pool = require('../config/database');
const logger = require('../services/logger');
const { ensureResidentSchema } = require('../services/residentSchemaService');

const RECORD_TYPES = {
  clinical: 'Clinical Record',
  child: 'Child Record',
  maternal: 'Maternal Record',
  immunization: 'Immunization Record',
  operation_timbang: 'Operation Timbang',
  adolescent_bmi: 'Adolescent BMI',
  adult_bmi: 'Adult BMI',
  resident: 'Resident profile'
};

const parseJson = (value) => {
  if (!value || typeof value !== 'string') return value || {};
  return JSON.parse(value);
};

const parseCategoryFlags = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return value.split(',').map((flag) => flag.trim()).filter(Boolean);
  }
};

const asNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const displayRecordType = (type) => RECORD_TYPES[type] || type;

const isUpdated = (createdAt, updatedAt) => {
  const created = asDate(createdAt);
  const updated = asDate(updatedAt);
  return Boolean(created && updated && updated.getTime() - created.getTime() > 1000);
};

const getResidentSummary = async (req, res) => {
  const residentId = Number(req.params.id);
  if (!Number.isSafeInteger(residentId) || residentId <= 0) {
    return res.status(400).json({ success: false, message: 'A valid resident ID is required.' });
  }

  try {
    await ensureResidentSchema();
    const profileQuery = `
      SELECT r.resident_id, r.first_name, r.middle_name, r.last_name, r.suffix,
        r.household_no, r.address, r.contact_no, r.philhealth_id_no, r.is_4ps,
        r.category_flags, r.sitio, r.created_by, u.full_name AS created_by_name,
        r.birthdate, r.sex, r.civil_status, r.occupation, r.resident_status,
        r.pregnant, r.lactating, r.profile_photo, r.created_at
      FROM residents r
      LEFT JOIN users u ON u.user_id = r.created_by
      WHERE r.resident_id = ?
    `;
    const formRecordsQuery = `
      SELECT record_type, id, record_data, created_at, updated_at
      FROM (
        SELECT 'clinical' AS record_type, id, record_data, created_at, updated_at
        FROM patient_clinical_records WHERE resident_id = ?
        UNION ALL
        SELECT 'child' AS record_type, id, record_data, created_at, updated_at
        FROM child_records WHERE resident_id = ?
        UNION ALL
        SELECT 'maternal' AS record_type, id, record_data, created_at, updated_at
        FROM maternal_records WHERE resident_id = ?
        UNION ALL
        SELECT 'immunization' AS record_type, id, record_data, created_at, updated_at
        FROM immunization_records WHERE resident_id = ?
      ) AS form_records
      ORDER BY updated_at DESC, id DESC
      LIMIT 100
    `;
    const formStatusQuery = `
      SELECT 'clinical' AS record_type, COUNT(*) AS record_count, MAX(updated_at) AS last_updated
      FROM patient_clinical_records WHERE resident_id = ?
      UNION ALL
      SELECT 'clinical' AS record_type, COUNT(*) AS record_count, MAX(updated_at) AS last_updated
      FROM health_records WHERE resident_id = ?
      UNION ALL
      SELECT 'child' AS record_type, COUNT(*) AS record_count, MAX(updated_at) AS last_updated
      FROM child_records WHERE resident_id = ?
      UNION ALL
      SELECT 'child' AS record_type, COUNT(*) AS record_count, MAX(updated_at) AS last_updated
      FROM child_health_records WHERE resident_id = ?
      UNION ALL
      SELECT 'maternal' AS record_type, COUNT(*) AS record_count, MAX(updated_at) AS last_updated
      FROM maternal_records WHERE resident_id = ?
      UNION ALL
      SELECT 'immunization' AS record_type, COUNT(*) AS record_count, MAX(updated_at) AS last_updated
      FROM immunization_records WHERE resident_id = ?
    `;
    const measurementsQuery = `
      SELECT record_type, record_id, record_date, weight_kg, height_cm, bmi,
        nutrition_status, created_at, updated_at
      FROM (
        SELECT 'clinical' AS record_type, health_record_id AS record_id, record_date,
          weight_kg, height_cm, NULL AS bmi, NULL AS nutrition_status, created_at, updated_at
        FROM health_records WHERE resident_id = ?
        UNION ALL
        SELECT 'child' AS record_type, id AS record_id, record_date,
          weight_kg, height_cm, NULL AS bmi, assessment AS nutrition_status, created_at, updated_at
        FROM child_health_records WHERE resident_id = ?
        UNION ALL
        SELECT 'operation_timbang' AS record_type, ot.timbang_id AS record_id,
          ot.date_recorded AS record_date, ot.weight_kg, ot.measurement_cm AS height_cm,
          NULL AS bmi, CONCAT_WS(', ', ota.wfa_status, ota.hfa_status, ota.wflh_status) AS nutrition_status,
          ot.created_at, ot.created_at AS updated_at
        FROM operation_timbang ot
        LEFT JOIN operation_timbang_assessments ota ON ota.timbang_id = ot.timbang_id
        WHERE ot.resident_id = ?
        UNION ALL
        SELECT 'adolescent_bmi' AS record_type, record_id, record_date,
          weight_kg, height_cm, bmi, bmi_for_age_category AS nutrition_status, created_at, created_at AS updated_at
        FROM adolescent_bmi_records WHERE resident_id = ?
        UNION ALL
        SELECT 'adult_bmi' AS record_type, bmi_id AS record_id, date_recorded AS record_date,
          weight_kg, height_cm, bmi, bmi_category AS nutrition_status, created_at, created_at AS updated_at
        FROM adult_bmi_records WHERE resident_id = ?
      ) AS health_records
      ORDER BY record_date DESC, record_id DESC
      LIMIT 100
    `;
    const profileActivityQuery = `
      SELECT audit_id, action, created_at
      FROM audit_logs
      WHERE module = 'residents' AND table_name = 'residents' AND record_id = ?
      ORDER BY created_at DESC, audit_id DESC
      LIMIT 25
    `;

    const [[residentRows], [formRows], [formStatusRows], [measurementRows], [profileActivityRows]] = await Promise.all([
      pool.query(profileQuery, [residentId]),
      pool.query(formRecordsQuery, [residentId, residentId, residentId, residentId]),
      pool.query(formStatusQuery, [residentId, residentId, residentId, residentId, residentId, residentId]),
      pool.query(measurementsQuery, [residentId, residentId, residentId, residentId, residentId]),
      pool.query(profileActivityQuery, [residentId])
    ]);

    if (!residentRows.length) {
      return res.status(404).json({ success: false, message: 'Resident not found.' });
    }

    const resident = residentRows[0];
    resident.category_flags = parseCategoryFlags(resident.category_flags);
    const forms = formRows.map((row) => ({ ...row, record_data: parseJson(row.record_data) }));
    const formStatus = Object.fromEntries(Object.keys(RECORD_TYPES).map((type) => {
      const sourceRows = formStatusRows.filter((row) => row.record_type === type);
      return [type, {
        exists: sourceRows.some((row) => Number(row.record_count) > 0),
        lastUpdated: sourceRows.map((row) => row.last_updated).filter(Boolean).sort((left, right) => (asDate(right)?.getTime() || 0) - (asDate(left)?.getTime() || 0))[0] || null,
        count: sourceRows.reduce((total, row) => total + Number(row.record_count || 0), 0)
      }];
    }));

    const metricRows = measurementRows.map((row) => ({
      ...row,
      weight_kg: asNumber(row.weight_kg),
      height_cm: asNumber(row.height_cm),
      bmi: asNumber(row.bmi),
      nutrition_status: row.nutrition_status || null
    }));
    const metricCandidates = metricRows.map((row) => ({
      date: row.record_date,
      weightKg: row.weight_kg,
      heightCm: row.height_cm,
      bmi: row.bmi,
      nutritionStatus: row.nutrition_status,
      recordType: row.record_type,
      recordId: row.record_id
    }));
    const visitCandidates = metricRows.map((row) => ({
      id: `${row.record_type}-${row.record_id}`,
      recordType: row.record_type,
      title: displayRecordType(row.record_type),
      date: row.record_date,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      action: isUpdated(row.created_at, row.updated_at) ? 'Updated' : 'Added',
      weightKg: row.weight_kg,
      heightCm: row.height_cm,
      bmi: row.bmi,
      nutritionStatus: row.nutrition_status
    }));

    forms.forEach((record) => {
      const data = record.record_data || {};
      const visitDate = data.visit_date || null;
      metricCandidates.push({
        date: visitDate || record.updated_at || record.created_at,
        weightKg: asNumber(data.weight_kg),
        heightCm: asNumber(data.height_cm),
        bmi: asNumber(data.bmi),
        nutritionStatus: null,
        recordType: record.record_type,
        recordId: record.id
      });

      if (Array.isArray(data.growth_rows)) {
        data.growth_rows.forEach((growth, index) => {
          metricCandidates.push({
            date: growth.date || visitDate || record.updated_at || record.created_at,
            weightKg: asNumber(growth.weight),
            heightCm: asNumber(growth.height),
            bmi: null,
            nutritionStatus: null,
            recordType: record.record_type,
            recordId: `${record.id}-growth-${index}`
          });
        });
      }

      visitCandidates.push({
        id: `${record.record_type}-${record.id}`,
        recordType: record.record_type,
        title: displayRecordType(record.record_type),
        date: visitDate,
        createdAt: record.created_at,
        updatedAt: record.updated_at,
        action: isUpdated(record.created_at, record.updated_at) ? 'Updated' : 'Added',
        weightKg: asNumber(data.weight_kg),
        heightCm: asNumber(data.height_cm),
        bmi: asNumber(data.bmi),
        nutritionStatus: null
      });
    });

    const profileActivity = profileActivityRows.map((event) => ({
      id: `resident-profile-${event.audit_id}`,
      recordType: 'resident',
      title: 'Resident profile',
      date: event.created_at,
      createdAt: event.created_at,
      updatedAt: event.created_at,
      action: event.action === 'CREATE' ? 'Added' : 'Updated'
    }));

    const latestValue = (key) => metricCandidates
      .filter((candidate) => candidate[key] !== null && candidate[key] !== undefined)
      .sort((left, right) => (asDate(right.date)?.getTime() || 0) - (asDate(left.date)?.getTime() || 0))[0]?.[key] ?? null;
    const latestStatus = metricCandidates
      .filter((candidate) => candidate.nutritionStatus)
      .sort((left, right) => (asDate(right.date)?.getTime() || 0) - (asDate(left.date)?.getTime() || 0))[0]?.nutritionStatus || null;
    const activeAlerts = [];
    if (latestStatus && /(underweight|wast(ed|ing)|stunt(ed|ing)|severe|malnutrition)/i.test(latestStatus)) {
      activeAlerts.push({
        type: /severe/i.test(latestStatus) ? 'danger' : 'warning',
        title: 'Nutrition follow-up recommended',
        description: `Latest recorded nutrition assessment: ${latestStatus}.`
      });
    }

    const sortedVisits = visitCandidates
      .filter((event) => asDate(event.date))
      .sort((left, right) => asDate(right.date).getTime() - asDate(left.date).getTime());
    const activityLog = [...visitCandidates, ...profileActivity]
      .filter((event) => asDate(event.updatedAt || event.createdAt))
      .sort((left, right) => asDate(right.updatedAt || right.createdAt).getTime() - asDate(left.updatedAt || left.createdAt).getTime())
      .slice(0, 100);
    const latestRecordUpdate = activityLog[0]?.updatedAt || activityLog[0]?.createdAt || null;

    return res.json({
      success: true,
      data: {
        resident,
        records: formStatus,
        healthSnapshot: {
          weightKg: latestValue('weightKg'),
          heightCm: latestValue('heightCm'),
          bmi: latestValue('bmi'),
          nutritionStatus: latestStatus,
          lastVisitDate: sortedVisits[0]?.date || null,
          nextCheckupDue: null,
          nextImmunizationDue: null,
          alerts: activeAlerts
        },
        visitHistory: sortedVisits.slice(0, 100),
        activityLog,
        recentActivity: activityLog.slice(0, 5),
        lastUpdated: latestRecordUpdate
      }
    });
  } catch (error) {
    logger.error('getResidentSummary error', error);
    return res.status(500).json({ success: false, message: 'Unable to load resident details.' });
  }
};

module.exports = { getResidentSummary };
