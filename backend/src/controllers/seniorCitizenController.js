/**
 * Senior Citizen Controller
 * Handles senior citizen records and registration
 */

const pool = require('../config/database');
const { writeAudit } = require('../services/auditService');
const logger = require('../services/logger');
const { getManilaToday } = require('../services/manilaDateService');

function dateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').slice(0, 10));
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return date.getUTCFullYear() === parts[0] && date.getUTCMonth() === parts[1] - 1 && date.getUTCDate() === parts[2] ? parts : null;
}

function ageOnDate(birthdate, referenceDate) {
  const birth = dateParts(birthdate);
  const reference = dateParts(referenceDate);
  if (!birth || !reference) return null;
  let age = reference[0] - birth[0];
  if (reference[1] < birth[1] || (reference[1] === birth[1] && reference[2] < birth[2])) age--;
  return age;
}

/**
 * List senior citizen records
 */
const listSeniorCitizens = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = [10, 25, 50].includes(Number(req.query.pageSize || req.query.limit)) ? Number(req.query.pageSize || req.query.limit) : 10;
    const offset = (page - 1) * pageSize;
    let where = 'WHERE r.resident_id IS NOT NULL';
    const params = [];

    if (req.query.resident_id) {
      where += ' AND scr.resident_id = ?'; params.push(Number(req.query.resident_id));
    }
    if (req.query.search) {
      where += ' AND (r.first_name LIKE ? OR r.middle_name LIKE ? OR r.last_name LIKE ? OR scr.senior_citizen_id LIKE ? OR scr.contact_number LIKE ? OR scr.emergency_contact_number LIKE ? OR scr.health_conditions LIKE ?)';
      const like = `%${String(req.query.search).trim()}%`; params.push(like, like, like, like, like, like, like);
    }
    if (req.query.condition) {
      where += ' AND scr.health_conditions LIKE ?'; params.push(`%${String(req.query.condition).trim()}%`);
    }
    if (req.query.ageGroup) {
      if (req.query.ageGroup === '60-69') { where += ' AND TIMESTAMPDIFF(YEAR,r.birthdate,?) BETWEEN 60 AND 69'; params.push(getManilaToday()); }
      else if (req.query.ageGroup === '70-79') { where += ' AND TIMESTAMPDIFF(YEAR,r.birthdate,?) BETWEEN 70 AND 79'; params.push(getManilaToday()); }
      else if (req.query.ageGroup === '80+') { where += ' AND TIMESTAMPDIFF(YEAR,r.birthdate,?) >= 80'; params.push(getManilaToday()); }
    }
    if (req.query.sitio) { where += ' AND r.sitio = ?'; params.push(req.query.sitio); }

    const countSql = `SELECT COUNT(DISTINCT scr.resident_id) AS total FROM senior_citizen_records scr JOIN residents r ON r.resident_id=scr.resident_id ${where}`;
    const [countRows] = await pool.query(countSql, params);
    const total = Number(countRows[0]?.total || 0);

    const sort = String(req.query.sort || 'newest').toLowerCase();
    const orderBy = {
      name_asc: 'r.last_name ASC, r.first_name ASC', name_desc: 'r.last_name DESC, r.first_name DESC',
      age_oldest: 'r.birthdate ASC', age_youngest: 'r.birthdate DESC',
      newest: 'scr.date_registered DESC, scr.senior_id DESC', senior_id: 'CAST(SUBSTRING_INDEX(scr.senior_citizen_id, \'-\', -1) AS UNSIGNED) ASC'
    }[sort] || 'scr.date_registered DESC, scr.senior_id DESC';

    const sql = `SELECT scr.*, u.full_name AS recorded_by_name, r.first_name,r.middle_name,r.last_name,r.suffix,r.birthdate,r.sex,r.sitio,r.address,r.contact_no,r.household_no,r.profile_photo,r.resident_status,
      TIMESTAMPDIFF(YEAR,r.birthdate,?) AS age
      FROM senior_citizen_records scr LEFT JOIN users u ON scr.recorded_by=u.user_id JOIN residents r ON scr.resident_id=r.resident_id
      ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
    const [rows] = await pool.query(sql, [getManilaToday(), ...params, pageSize, offset]);
    const [conditions] = await pool.query(`SELECT health_conditions FROM senior_citizen_records WHERE health_conditions IS NOT NULL AND TRIM(health_conditions)<>''`);

    return res.json({ success: true, data: { items: rows, total, page, pageSize, limit: pageSize, counts: { total } } });
  } catch (err) {
    logger.error('listSeniorCitizens error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * Get single senior citizen record
 */
const getSeniorCitizen = async (req, res) => {
  try {
    const { id } = req.params;

    const sql = `
      SELECT 
        scr.*,
        r.first_name,
        r.middle_name,
        r.last_name,
        r.suffix,
        r.birthdate,
        r.sex,
        r.sitio,
        r.address,
        r.contact_no,
        r.household_no,
        r.profile_photo,
        r.resident_status,
        u.full_name as recorded_by_name
      FROM senior_citizen_records scr
      LEFT JOIN residents r ON scr.resident_id = r.resident_id
      LEFT JOIN users u ON scr.recorded_by = u.user_id
      WHERE scr.senior_id = ?
    `;

    const [rows] = await pool.query(sql, [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Senior citizen record not found' });
    }

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    logger.error('getSeniorCitizen error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * Create senior citizen record
 */
const createSeniorCitizen = async (req, res) => {
  const ownsConnection = !req.idempotencyConnection;
  const connection = req.idempotencyConnection || await pool.getConnection();
  let lockAcquired = false;
  let transactionActive = !ownsConnection;
  try {
    const { resident_id, senior_citizen_id, contact_number, emergency_contact_name, emergency_contact_number, health_conditions, date_registered } = req.body;
    const userId = req.user.user_id;
    const errors = {};
    if (!resident_id) errors.resident_id = 'Please select a resident.';
    if (!date_registered) errors.date_registered = 'Date registered is required.';
    else if (!dateParts(date_registered)) errors.date_registered = 'Enter a valid registration date.';
    else if (date_registered > getManilaToday()) errors.date_registered = 'Date registered cannot be in the future.';
    if (!contact_number) errors.contact_number = 'Contact number is required.';
    if (Object.keys(errors).length) return res.status(400).json({ success:false,message:'Please correct the highlighted fields.',errors });

    if (ownsConnection) {
      await connection.beginTransaction();
      transactionActive = true;
    }
    const [[lockResult]] = await connection.query("SELECT GET_LOCK('healthsync-senior-id',5) AS acquired");
    lockAcquired = Number(lockResult?.acquired) === 1;
    if (!lockAcquired) {
      if (transactionActive && ownsConnection) {
        await connection.rollback();
        transactionActive = false;
      }
      return res.status(503).json({ success: false, message: 'Senior registration is busy. Please try again.' });
    }
    const rejectTransaction = async (status, body) => {
      await connection.query("SELECT RELEASE_LOCK('healthsync-senior-id')");
      lockAcquired = false;
      if (transactionActive && ownsConnection) {
        await connection.rollback();
        transactionActive = false;
      }
      return res.status(status).json(body);
    };
    const [residentCheck] = await connection.query('SELECT resident_id,birthdate FROM residents WHERE resident_id=?',[resident_id]);
    if (!residentCheck.length) return rejectTransaction(400,{success:false,message:'Resident not found',errors:{resident_id:'Resident not found.'}});
    const ageYears = ageOnDate(residentCheck[0].birthdate,date_registered);
    if (ageYears === null || ageYears < 60) return rejectTransaction(400,{success:false,message:'Resident is not eligible for senior registration.',errors:{resident_id:'Residents must be 60 years or older on the registration date.'}});
    const [existing] = await connection.query('SELECT senior_id FROM senior_citizen_records WHERE resident_id=?',[resident_id]);
    if (existing.length) return rejectTransaction(409,{success:false,message:'This resident is already registered.',errors:{resident_id:'This resident is already registered as a senior citizen.'}});

    let generatedId = String(senior_citizen_id || '').trim();
    if (!generatedId) {
      const [ids] = await connection.query("SELECT senior_citizen_id FROM senior_citizen_records WHERE senior_citizen_id REGEXP '^SC-[0-9]+$'");
      let max = 62; ids.forEach(row => { const n=Number(String(row.senior_citizen_id).replace(/[^0-9]/g,'')); if(Number.isFinite(n)) max=Math.max(max,n); });
      generatedId = `SC-${String(max+1).padStart(6,'0')}`;
    }
    const [duplicateId] = await connection.query('SELECT senior_id FROM senior_citizen_records WHERE senior_citizen_id=?',[generatedId]);
    if (duplicateId.length) return rejectTransaction(409,{success:false,message:'Senior citizen ID is already used.',errors:{senior_citizen_id:'This Senior citizen ID is already in use.'}});

    const [result] = await connection.query(`INSERT INTO senior_citizen_records (resident_id,senior_citizen_id,contact_number,emergency_contact_name,emergency_contact_number,health_conditions,date_registered,recorded_by) VALUES (?,?,?,?,?,?,?,?)`,[resident_id,generatedId,contact_number||null,emergency_contact_name||null,emergency_contact_number||null,health_conditions||null,date_registered,userId]);
    await writeAudit({
      user_id: userId,
      action: 'CREATE',
      module: 'senior_citizens',
      table_name: 'senior_citizen_records',
      record_id: result.insertId,
      new_data: { resident_id, senior_citizen_id: generatedId, date_registered },
      connection: req.idempotencyConnection,
    });
    if (transactionActive && ownsConnection) {
      await connection.commit();
      transactionActive = false;
    }
    await connection.query("SELECT RELEASE_LOCK('healthsync-senior-id')");
    lockAcquired = false;
    const [rows] = await connection.query('SELECT * FROM senior_citizen_records WHERE senior_id=?', [result.insertId]);
    return res.status(201).json({success:true,data:rows[0]});
  } catch (err) {
    if (transactionActive && ownsConnection) {
      try {
        await connection.rollback();
        transactionActive = false;
      } catch (rollbackError) {
        logger.error('createSeniorCitizen rollback error', rollbackError);
      }
    }
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK('healthsync-senior-id')");
        lockAcquired = false;
      } catch (releaseError) {
        logger.error('createSeniorCitizen lock release error', releaseError);
      }
    }
    if (err?.code === 'ER_DUP_ENTRY') return res.status(409).json({success:false,message:'Senior citizen ID is already used.',errors:{senior_citizen_id:'This Senior citizen ID is already in use.'}});
    logger.error('createSeniorCitizen error',err); return res.status(500).json({success:false,message:'Server error'});
  } finally {
    if (ownsConnection) connection.release();
  }
};

/**
 * Update senior citizen record
 */
const updateSeniorCitizen = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      senior_citizen_id,
      contact_number,
      emergency_contact_name,
      emergency_contact_number,
      health_conditions,
      date_registered
    } = req.body;

    const userId = req.user.user_id;

    // Get current record
    const [oldRecords] = await pool.query(
      'SELECT * FROM senior_citizen_records WHERE senior_id = ?',
      [id]
    );

    if (!oldRecords || oldRecords.length === 0) {
      return res.status(404).json({ success: false, message: 'Senior citizen record not found' });
    }

    const oldData = oldRecords[0];

    // Build update
    const updates = [];
    const values = [];

    if (senior_citizen_id !== undefined) {
      const [duplicate] = await pool.query('SELECT senior_id FROM senior_citizen_records WHERE senior_citizen_id=? AND senior_id<>?',[senior_citizen_id,id]);
      if (duplicate.length) return res.status(409).json({success:false,message:'Senior citizen ID is already used.',errors:{senior_citizen_id:'This Senior citizen ID is already in use.'}});
      updates.push('senior_citizen_id = ?'); values.push(senior_citizen_id);
    }
    if (date_registered !== undefined) { updates.push('date_registered = ?'); values.push(date_registered); }
    if (contact_number !== undefined) {
      updates.push('contact_number = ?');
      values.push(contact_number);
    }
    if (emergency_contact_name !== undefined) {
      updates.push('emergency_contact_name = ?');
      values.push(emergency_contact_name);
    }
    if (emergency_contact_number !== undefined) {
      updates.push('emergency_contact_number = ?');
      values.push(emergency_contact_number);
    }
    if (health_conditions !== undefined) {
      updates.push('health_conditions = ?');
      values.push(health_conditions);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    values.push(id);

    const sql = `UPDATE senior_citizen_records SET ${updates.join(', ')} WHERE senior_id = ?`;
    await pool.query(sql, values);

    // Get updated record
    const [rows] = await pool.query(
      'SELECT * FROM senior_citizen_records WHERE senior_id = ?',
      [id]
    );

    // Audit
    await writeAudit({
      user_id: userId,
      action: 'UPDATE',
      module: 'senior_citizens',
      table_name: 'senior_citizen_records',
      record_id: id,
      old_data: oldData,
      new_data: rows[0]
    });

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    logger.error('updateSeniorCitizen error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const searchEligibleResidents = async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    if (search.length < 2) return res.json({ success: true, data: [] });
    const like = `%${search}%`;
    const today = getManilaToday();
    const [rows] = await pool.query(`SELECT r.resident_id,r.first_name,r.middle_name,r.last_name,r.suffix,r.birthdate,r.sex,r.sitio,r.household_no,r.contact_no,r.profile_photo,
      TIMESTAMPDIFF(YEAR,r.birthdate,?) AS age
      FROM residents r WHERE r.birthdate IS NOT NULL AND TIMESTAMPDIFF(YEAR,r.birthdate,?)>=60
      AND NOT EXISTS (SELECT 1 FROM senior_citizen_records s WHERE s.resident_id=r.resident_id)
      AND (r.first_name LIKE ? OR r.middle_name LIKE ? OR r.last_name LIKE ? OR r.household_no LIKE ? OR r.contact_no LIKE ?)
      ORDER BY r.last_name,r.first_name LIMIT 20`, [today, today, like,like,like,like,like]);
    return res.json({ success: true, data: rows });
  } catch (err) { logger.error('searchEligibleResidents error', err); return res.status(500).json({ success:false,message:'Server error' }); }
};

const getNextSeniorId = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT senior_citizen_id FROM senior_citizen_records WHERE senior_citizen_id REGEXP '^SC-[0-9]+$'");
    let max = 62;
    for (const row of rows) { const value = Number(String(row.senior_citizen_id).replace(/[^0-9]/g,'')); if (Number.isFinite(value)) max=Math.max(max,value); }
    return res.json({ success:true, data:{ senior_citizen_id:`SC-${String(max+1).padStart(6,'0')}` } });
  } catch (err) { logger.error('getNextSeniorId error', err); return res.status(500).json({ success:false,message:'Server error' }); }
};

const removeSeniorCitizen = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query('SELECT * FROM senior_citizen_records WHERE senior_id=?',[req.params.id]);
    if (!rows.length) { await connection.rollback(); return res.status(404).json({success:false,message:'Senior citizen record not found'}); }
    await connection.query('DELETE FROM senior_citizen_records WHERE senior_id=?',[req.params.id]);
    await writeAudit({ user_id:req.user.user_id,action:'DELETE',module:'senior_citizens',table_name:'senior_citizen_records',record_id:req.params.id,old_data:rows[0],new_data:null });
    await connection.commit(); return res.json({success:true,message:'Removed from registry'});
  } catch (err) { await connection.rollback().catch(()=>{}); logger.error('removeSeniorCitizen error',err); return res.status(500).json({success:false,message:'Server error'}); } finally { connection.release(); }
};

module.exports = {
  listSeniorCitizens,
  getSeniorCitizen,
  createSeniorCitizen,
  updateSeniorCitizen,
  searchEligibleResidents,
  getNextSeniorId,
  removeSeniorCitizen
};
