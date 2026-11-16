const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const SITIOS = require('../config/sitios');
const growthStandards = require('../services/nutrition/who2006-growth-standards.json');
const { optPlusService } = require('../services/nutrition');

dotenv.config();

const SEED_PREFIX = 'SEED-DEMO-';
const TOTAL_RESIDENTS = 120;
const RESET = process.argv.includes('--reset');

const firstNames = ['Juan', 'Maria', 'Jose', 'Ana', 'Pedro', 'Rosa', 'Carlo', 'Liza', 'Miguel', 'Sofia', 'Daniel', 'Elena', 'Ramon', 'Grace', 'Paolo', 'Leah', 'Andres', 'Mila', 'Noel', 'Clara'];
const femaleNames = new Set(['Maria', 'Ana', 'Rosa', 'Liza', 'Sofia', 'Elena', 'Grace', 'Leah', 'Mila', 'Clara']);
const lastNames = ['Santos', 'Reyes', 'Garcia', 'Cruz', 'Mendoza', 'Flores', 'Navarro', 'Castillo', 'Dela Cruz', 'Villanueva', 'Ramos', 'Aquino'];
const occupations = ['Farmer', 'Vendor', 'Driver', 'Teacher', 'Carpenter', 'Homemaker', 'Student', 'Fisher', 'Office worker'];
const civilStatuses = ['Single', 'Married', 'Widowed', 'Separated'];
const conditions = ['No known conditions', 'Hypertension', 'Asthma', 'Diabetes', 'Allergic rhinitis'];

function createRandom(seed) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

function pick(random, values) {
  return values[Math.floor(random() * values.length)];
}

function integer(random, min, max) {
  return Math.floor(random() * (max - min + 1)) + min;
}

function dateForAge(age, random) {
  const today = new Date();
  const year = today.getFullYear() - age;
  const month = integer(random, 0, 11);
  const day = integer(random, 1, 28);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function todayInManila() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function bmi(weight, heightCm) {
  return Number((weight / ((heightCm / 100) ** 2)).toFixed(2));
}

function adultBmiCategory(value) {
  if (value < 18.5) return 'Underweight';
  if (value < 25) return 'Normal';
  if (value < 30) return 'Overweight';
  return 'Obese';
}

async function findSeedUser(connection) {
  const [rows] = await connection.query("SELECT user_id FROM users WHERE is_active = 1 AND role IN ('bhw', 'admin') ORDER BY role = 'bhw' DESC, user_id LIMIT 1");
  if (!rows.length) throw new Error('Create an active BHW or admin user before seeding demo data.');
  return rows[0].user_id;
}

async function resetSeedData(connection) {
  const [residents] = await connection.query('SELECT resident_id FROM residents WHERE household_no LIKE ?', [`${SEED_PREFIX}%`]);
  const ids = residents.map((row) => row.resident_id);
  if (!ids.length) return 0;

  const placeholders = ids.map(() => '?').join(', ');
  await connection.query(`DELETE ota FROM operation_timbang_assessments ota JOIN operation_timbang ot ON ot.timbang_id = ota.timbang_id WHERE ot.resident_id IN (${placeholders})`, ids);
  for (const table of ['health_records', 'child_health_records', 'operation_timbang', 'adolescent_bmi_records', 'adult_bmi_records', 'senior_citizen_records']) {
    await connection.query(`DELETE FROM ${table} WHERE resident_id IN (${placeholders})`, ids);
  }
  await connection.query(`DELETE FROM residents WHERE resident_id IN (${placeholders})`, ids);
  return ids.length;
}

async function seed() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'healthsync_db'
  });

  try {
    await connection.beginTransaction();
    const [existing] = await connection.query('SELECT COUNT(*) AS count FROM residents WHERE household_no LIKE ?', [`${SEED_PREFIX}%`]);
    const existingCount = Number(existing[0]?.count || 0);
    if (existingCount && !RESET) {
      throw new Error(`${existingCount} demo residents already exist. Run with --reset to replace them.`);
    }

    const removed = RESET ? await resetSeedData(connection) : 0;
    const recordedBy = await findSeedUser(connection);
    const random = createRandom(20260911);
    const residentIds = [];
    const counts = { residents: 0, clinical: 0, childHealth: 0, operationTimbang: 0, adolescentBmi: 0, adultBmi: 0, senior: 0 };

    for (let index = 1; index <= TOTAL_RESIDENTS; index += 1) {
      const age = integer(random, 0, 85);
      const firstName = pick(random, firstNames);
      const sex = femaleNames.has(firstName) ? 'female' : 'male';
      const isChild = age < 18;
      const isAdult = age >= 20;
      const isSenior = age >= 60;
      const pregnant = sex === 'female' && age >= 18 && age <= 45 && random() < 0.08;
      const lactating = sex === 'female' && age >= 18 && age <= 45 && !pregnant && random() < 0.12;
      const birthdate = dateForAge(age, random);
      const flags = [];
      if (random() < (isChild ? 0.55 : 0.12)) flags.push('4Ps');
      if (random() < 0.1) flags.push('PWD');
      const [residentResult] = await connection.query(`
        INSERT INTO residents
          (first_name, middle_name, last_name, birthdate, sex, suffix, household_no, contact_no,
           philhealth_id_no, is_4ps, category_flags, sitio, created_by, civil_status, occupation,
           resident_status, pregnant, lactating)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        `DEMO ${firstName}`, random() < 0.35 ? pick(random, ['A.', 'B.', 'C.', 'D.']) : null,
        pick(random, lastNames), birthdate, sex, null, `${SEED_PREFIX}${String(index).padStart(3, '0')}`,
        `09${integer(random, 100000000, 999999999)}`, `PH-SEED-${String(index).padStart(6, '0')}`,
        flags.includes('4Ps') ? 1 : 0, flags.length ? JSON.stringify(flags) : null, pick(random, SITIOS), recordedBy,
        age < 18 ? 'Single' : pick(random, civilStatuses), age < 18 ? 'Student' : pick(random, occupations),
        random() < 0.92 ? 'Active' : pick(random, ['Inactive', 'Transferred', 'Deceased']), pregnant ? 1 : 0, lactating ? 1 : 0
      ]);
      const residentId = residentResult.insertId;
      residentIds.push(residentId);
      counts.residents += 1;

      const height = isChild ? Number((70 + age * 6 + random() * 15).toFixed(1)) : Number((145 + random() * 40).toFixed(1));
      const weight = isChild ? Number((8 + age * 2.2 + random() * 5).toFixed(1)) : Number((height - 100 + random() * 30).toFixed(1));
      const recordDate = dateDaysAgo(integer(random, 1, 700));

      await connection.query(`
        INSERT INTO health_records
          (resident_id, record_date, record_type, medical_history, notes, recorded_by,
           chief_complaint, history_of_present_illness, blood_pressure, heart_rate, respiratory_rate,
           temperature, weight_kg, height_cm, findings, assessment, plan, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [residentId, recordDate, 'Routine checkup', pick(random, conditions), 'Demo seed record for feature testing', recordedBy,
        random() < 0.35 ? pick(random, ['Cough', 'Fever', 'Headache', 'Follow-up']) : null,
        'Routine community health visit', isAdult ? `${integer(random, 105, 145)}/${integer(random, 65, 95)}` : null,
        String(integer(random, 60, 105)), String(integer(random, 16, 24)), Number((36.3 + random() * 1.3).toFixed(1)), weight, height,
        'Stable findings', 'Continue routine monitoring', 'Hydration, nutrition, and follow-up as needed', 'Generated demo data']);
      counts.clinical += 1;

      if (isChild) {
        await connection.query(`
          INSERT INTO child_health_records
            (resident_id, family_serial_number, nhts_number, philhealth_number, philhealth_category,
             religion, birthplace, birth_weight_kg, school_name, grade_level, parent_guardian_name,
             parent_guardian_relationship, record_date, history_of_present_illness, past_medical_history,
             immunization_history, blood_pressure, heart_rate, respiratory_rate, temperature, weight_kg,
             height_cm, findings, assessment, plan, remarks, recorded_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [residentId, `FSN-${residentId}`, `NHTS-${residentId}`, `PHC-${residentId}`, 'Indigent', 'Christian', 'Barangay Health Center', Number((2.5 + random() * 1.5).toFixed(2)),
          age >= 5 ? 'Local Elementary School' : null, age >= 5 ? `Grade ${Math.min(6, age - 4)}` : null, 'Demo Parent/Guardian', 'Parent', recordDate,
          'No acute symptoms', 'No significant history', 'Up to date', age >= 5 ? `${integer(random, 90, 120)}/${integer(random, 55, 80)}` : null,
          String(integer(random, 75, 125)), String(integer(random, 18, 28)), Number((36.4 + random() * 1.0).toFixed(1)), weight, height,
          'Growth monitoring completed', 'Within expected range', 'Continue routine child health visits', 'Generated demo data', recordedBy]);
        counts.childHealth += 1;
      }

      if (age <= 5) {
        const measurementDate = todayInManila();
        const birthDate = new Date(`${birthdate}T00:00:00.000Z`);
        const measuredDate = new Date(`${measurementDate}T00:00:00.000Z`);
        const ageInDays = Math.round((measuredDate.getTime() - birthDate.getTime()) / 86400000);
        if (ageInDays >= 0 && ageInDays < 1826) {
          const sexKey = sex === 'female' ? 'female' : 'male';
          const measurementType = ageInDays < 731 ? 'length' : 'height';
          const measurementCm = growthStandards.hfa[sexKey][ageInDays][1];
          const weightKg = growthStandards.wfa[sexKey][ageInDays][1];
          const assessment = optPlusService.calculateOperationTimbang({
            birthdate,
            sex,
            date_recorded: measurementDate,
            weight_kg: weightKg,
            measurement_cm: measurementCm,
            measurement_type: measurementType,
          });
          const timbangResult = await connection.query(`
            INSERT INTO operation_timbang
              (resident_id, weight_kg, measurement_cm, measurement_type, date_recorded, recorded_by)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [residentId, weightKg, measurementCm, measurementType, measurementDate, recordedBy]);
          const timbangId = timbangResult[0].insertId;
          await connection.query(`
            INSERT INTO operation_timbang_assessments
              (timbang_id, age_in_months, wfa_zscore, wfa_status, hfa_zscore, hfa_status, wflh_zscore, wflh_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `, [timbangId, assessment.age_in_months, assessment.wfa_zscore, assessment.wfa_status, assessment.hfa_zscore, assessment.hfa_status, assessment.wflh_zscore, assessment.wflh_status]);
          counts.operationTimbang += 1;
        }
      }

      if (age >= 10 && age < 20) {
        const adolescentBmi = bmi(weight, height);
        await connection.query(`
          INSERT INTO adolescent_bmi_records
            (resident_id, record_date, recorded_by, age_years, age_months, height_cm, weight_kg, bmi,
             bmi_for_age_zscore, bmi_for_age_category)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [residentId, recordDate, recordedBy, age, age * 12 + integer(random, 0, 11), height, weight, adolescentBmi, Number((-1 + random() * 2).toFixed(2)), adolescentBmi < 18.5 ? 'Thin' : adolescentBmi < 25 ? 'Normal' : 'Overweight']);
        counts.adolescentBmi += 1;
      }

      if (isAdult) {
        const adultBmi = bmi(weight, height);
        await connection.query(`
          INSERT INTO adult_bmi_records
            (resident_id, weight_kg, height_cm, bmi, bmi_category, date_recorded, recorded_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [residentId, weight, height, adultBmi, adultBmiCategory(adultBmi), recordDate, recordedBy]);
        counts.adultBmi += 1;
      }

      if (isSenior) {
        await connection.query(`
          INSERT INTO senior_citizen_records
            (resident_id, senior_citizen_id, contact_number, emergency_contact_name,
             emergency_contact_number, health_conditions, date_registered, recorded_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [residentId, `SC-${String(residentId).padStart(6, '0')}`, `09${integer(random, 100000000, 999999999)}`,
          'Demo Emergency Contact', `09${integer(random, 100000000, 999999999)}`, pick(random, conditions), recordDate, recordedBy]);
        counts.senior += 1;
      }
    }

    await connection.commit();
    console.log(JSON.stringify({ message: 'Demo data seeded successfully', removed, recordedBy, counts }, null, 2));
  } catch (error) {
    await connection.rollback();
    console.error(`Demo seed failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

seed();
