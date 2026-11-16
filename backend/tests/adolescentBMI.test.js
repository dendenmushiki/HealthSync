const test = require('node:test');
const assert = require('node:assert/strict');
const referenceData = require('../src/services/nutrition/who2007-bmi-for-age.json');
const whoReferenceService = require('../src/services/nutrition/whoReferenceService');
const { calculateAssessment } = require('../src/services/nutrition/adolescentBmiAssessment');
const pool = require('../src/config/database');
const auditService = require('../src/services/auditService');
const originalWriteAudit = auditService.writeAudit;
auditService.writeAudit = async () => {};
const adolescentBMIController = require('../src/controllers/adolescentBMIController');
auditService.writeAudit = originalWriteAudit;

test('WHO sex-specific median BMI references calculate normal classification', () => {
  for (const sex of ['male', 'female']) {
    const row = referenceData[sex][120 - referenceData.minimumAgeMonths];
    const result = whoReferenceService.lookupZScore(sex, 120, row[2]);
    assert.equal(result.zscore, 0);
    assert.equal(whoReferenceService.classifyByZScore(result.zscore), 'Normal');
  }
});

test('WHO BMI-for-age Z-scores differ by sex and age', () => {
  const maleAtTen = whoReferenceService.lookupZScore('male', 120, 18);
  const femaleAtTen = whoReferenceService.lookupZScore('female', 120, 18);
  const maleAtFifteen = whoReferenceService.lookupZScore('male', 180, 18);
  assert.notEqual(maleAtTen.zscore, femaleAtTen.zscore);
  assert.notEqual(maleAtTen.zscore, maleAtFifteen.zscore);
});

test('different BMI measurements can result in different classifications', () => {
  const thin = whoReferenceService.lookupZScore('male', 120, 13);
  const obese = whoReferenceService.lookupZScore('male', 120, 30);
  assert.notEqual(whoReferenceService.classifyByZScore(thin.zscore), whoReferenceService.classifyByZScore(obese.zscore));
});

test('WHO classification uses adolescent BMI-for-age cutoffs', () => {
  assert.equal(whoReferenceService.classifyByZScore(-3.01), 'Severe Thinness');
  assert.equal(whoReferenceService.classifyByZScore(-2.01), 'Thinness');
  assert.equal(whoReferenceService.classifyByZScore(-2), 'Normal');
  assert.equal(whoReferenceService.classifyByZScore(1), 'Normal');
  assert.equal(whoReferenceService.classifyByZScore(1.01), 'Overweight');
  assert.equal(whoReferenceService.classifyByZScore(2.01), 'Obesity');
});

test('classification uses the unrounded WHO score at exact cutoff boundaries', () => {
  const [, l, m, s] = referenceData.male[120 - referenceData.minimumAgeMonths];
  const bmiAtZ = (z) => (l === 0
    ? m * Math.exp(s * z)
    : m * Math.pow(1 + l * s * z, 1 / l));
  const nearOverweightCutoff = whoReferenceService.lookupZScore('male', 120, bmiAtZ(1.004));
  assert.equal(nearOverweightCutoff.zscore, 1);
  assert.equal(whoReferenceService.classifyByZScore(nearOverweightCutoff.classificationZscore), 'Overweight');
});

test('assessment age is derived from the record date with calendar-month precision', () => {
  const beforeBirthday = calculateAssessment(
    { birthdate: '2010-01-15', sex: 'male' },
    '2020-01-14',
    40,
    150
  );
  const onBirthday = calculateAssessment(
    { birthdate: '2010-01-15', sex: 'male' },
    '2020-01-15',
    40,
    150
  );
  assert.equal(beforeBirthday.age_months, 119);
  assert.equal(onBirthday.age_months, 120);
  assert.equal(typeof onBirthday.bmi_for_age_category, 'string');
  assert.equal(Number.isFinite(onBirthday.bmi_for_age_zscore), true);
  const oldestSupported = calculateAssessment(
    { birthdate: '2000-01-15', sex: 'male' },
    '2019-01-15',
    70,
    180
  );
  assert.equal(oldestSupported.age_months, 228);
});

test('assessment rejects invalid demographics, dates, measurements, and unsupported ages', () => {
  const validResident = { birthdate: '2010-01-15', sex: 'female' };
  assert.throws(() => calculateAssessment({ ...validResident, birthdate: null }, '2020-01-15', 40, 150), /birthdate is required/);
  assert.throws(() => calculateAssessment({ birthdate: '2010-01-15', sex: '' }, '2020-01-15', 40, 150), /sex must be recorded/);
  assert.throws(() => calculateAssessment(validResident, '2020-02-30', 40, 150), /valid date/);
  assert.throws(() => calculateAssessment(validResident, '2009-01-15', 40, 150), /before the resident birthdate/);
  assert.throws(() => calculateAssessment(validResident, '2015-01-15', 40, 150), /61-228 months/);
  assert.throws(() => calculateAssessment(validResident, '2030-01-15', 40, 150), /future/);
  assert.throws(() => calculateAssessment(validResident, '2020-01-15', 0, 150), /Invalid BMI input/);
  assert.throws(() => whoReferenceService.lookupZScore('female', 120, 0), /positive number/);
  assert.throws(() => whoReferenceService.lookupZScore('female', 60, 18), /61-228 months/);
});

test('implausible BMI-for-age measurements are rejected rather than classified', () => {
  assert.throws(() => whoReferenceService.lookupZScore('male', 120, 100), /outside the plausible WHO reference range/);
});

test('controller persists calculated classifications on create and recalculates them on update', async () => {
  const originalQuery = pool.query;
  const resident = { resident_id: 8, birthdate: '2010-01-15', sex: 'female' };
  let savedRecord;

  pool.query = async (sql, values) => {
    if (sql.includes('SELECT resident_id, birthdate, sex FROM residents')) return [[resident], []];
    if (sql.includes('INSERT INTO adolescent_bmi_records')) {
      savedRecord = {
        record_id: 15,
        resident_id: values[0],
        record_date: values[1],
        age_years: values[2],
        age_months: values[3],
        height_cm: values[4],
        weight_kg: values[5],
        bmi: values[6],
        bmi_for_age_zscore: values[7],
        bmi_for_age_category: values[8]
      };
      return [{ insertId: savedRecord.record_id }, []];
    }
    if (sql.includes('UPDATE adolescent_bmi_records')) {
      savedRecord.weight_kg = values[0];
      savedRecord.age_years = values[1];
      savedRecord.age_months = values[2];
      savedRecord.bmi = values[3];
      savedRecord.bmi_for_age_zscore = values[4];
      savedRecord.bmi_for_age_category = values[5];
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('SELECT * FROM adolescent_bmi_records WHERE record_id = ?')) {
      return [[{ ...savedRecord }], []];
    }
    throw new Error(`Unexpected database query in test: ${sql}`);
  };

  const responseFor = () => ({
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  });

  try {
    const createResponse = responseFor();
    await adolescentBMIController.createAdolescentBMI({
      body: { resident_id: 8, record_date: '2020-01-15', height_cm: 150, weight_kg: 40 },
      user: { user_id: 4 }
    }, createResponse);
    assert.equal(createResponse.statusCode, 201);
    assert.equal(typeof savedRecord.bmi_for_age_zscore, 'number');
    assert.equal(savedRecord.bmi_for_age_category, 'Normal');

    const updateResponse = responseFor();
    await adolescentBMIController.updateAdolescentBMI({
      params: { id: '15' },
      body: { weight_kg: 46.1 },
      user: { user_id: 4 }
    }, updateResponse);
    assert.equal(updateResponse.statusCode, 200);
    assert.equal(savedRecord.bmi_for_age_category, 'Overweight');
    assert.equal(typeof savedRecord.bmi_for_age_zscore, 'number');
  } finally {
    pool.query = originalQuery;
  }
});
