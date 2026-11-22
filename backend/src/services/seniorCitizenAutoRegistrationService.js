const { getManilaToday } = require('./manilaDateService');

function calculateAge(birthdate, referenceDate) {
  if (!birthdate) return null;
  const birth = String(birthdate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) return null;
  const reference = String(referenceDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reference)) return null;
  const [birthYear, birthMonth, birthDay] = birth.split('-').map(Number);
  const [year, month, day] = reference.split('-').map(Number);
  let age = year - birthYear;
  if (month < birthMonth || (month === birthMonth && day < birthDay)) age--;
  return age >= 0 ? age : null;
}

function parseCategoryFlags(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
}

async function ensureSeniorCitizenRecord(connection, resident, options = {}) {
  const residentId = resident?.resident_id;
  const birthdate = resident?.birthdate;
  const dateRegistered = options.dateRegistered || getManilaToday();
  const age = calculateAge(birthdate, dateRegistered);
  if (!residentId || age === null || age < 60) return null;
  if (!options.userId) return null;

  const [existing] = await connection.query(
    'SELECT senior_id FROM senior_citizen_records WHERE resident_id = ? LIMIT 1',
    [residentId]
  );
  if (existing.length) return null;

  const [[lockResult]] = await connection.query(
    "SELECT GET_LOCK('healthsync-auto-senior-id', 5) AS acquired"
  );
  if (Number(lockResult?.acquired) !== 1) {
    throw new Error('Senior registration is busy. Please try again.');
  }

  try {
    const [existingAfterLock] = await connection.query(
      'SELECT senior_id FROM senior_citizen_records WHERE resident_id = ? LIMIT 1',
      [residentId]
    );
    if (existingAfterLock.length) return null;

    const [ids] = await connection.query(
      "SELECT senior_citizen_id FROM senior_citizen_records WHERE senior_citizen_id REGEXP '^SC-[0-9]+$'"
    );
    let max = 62;
    ids.forEach((row) => {
      const value = Number(String(row.senior_citizen_id || '').replace(/[^0-9]/g, ''));
      if (Number.isFinite(value)) max = Math.max(max, value);
    });
    const seniorCitizenId = `SC-${String(max + 1).padStart(6, '0')}`;

    const [result] = await connection.query(
      `INSERT INTO senior_citizen_records
       (resident_id, senior_citizen_id, contact_number, emergency_contact_name,
        emergency_contact_number, health_conditions, date_registered, recorded_by)
       VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)`,
      [
        residentId,
        seniorCitizenId,
        resident.contact_no || null,
        dateRegistered,
        options.userId || null
      ]
    );

    const flags = parseCategoryFlags(resident.category_flags);
    if (!flags.includes('Senior')) flags.push('Senior');
    if (options.persistCategoryFlag !== false) {
      await connection.query(
        'UPDATE residents SET category_flags = ? WHERE resident_id = ?',
        [JSON.stringify(flags), residentId]
      );
    }

    return { senior_id: result.insertId, senior_citizen_id: seniorCitizenId };
  } finally {
    await connection.query("SELECT RELEASE_LOCK('healthsync-auto-senior-id')");
  }
}

async function reconcileSeniorCitizenRegistry(connection, options = {}) {
  const dateRegistered = options.dateRegistered || getManilaToday();
  const [eligible] = await connection.query(
    `SELECT r.resident_id, r.birthdate, r.contact_no, r.category_flags
     FROM residents r
     WHERE r.birthdate IS NOT NULL
       AND TIMESTAMPDIFF(YEAR, r.birthdate, ?) >= 60
       AND NOT EXISTS (
         SELECT 1 FROM senior_citizen_records scr
         WHERE scr.resident_id = r.resident_id
       )`,
    [dateRegistered]
  );

  let created = 0;
  for (const resident of eligible) {
    const record = await ensureSeniorCitizenRecord(connection, resident, {
      dateRegistered,
      userId: options.userId,
    });
    if (record) created++;
  }
  return created;
}

module.exports = {
  calculateAge,
  ensureSeniorCitizenRecord,
  reconcileSeniorCitizenRegistry,
};
