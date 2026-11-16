const assert = require('node:assert/strict');
const test = require('node:test');
const pool = require('../src/config/database');
const auditService = require('../src/services/auditService');
const growthStandards = require('../src/services/nutrition/who2006-growth-standards.json');
const optPlusService = require('../src/services/nutrition/optPlusService');

const birthdate = '2019-01-01';

function addDays(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function measurement(ageDays, overrides = {}) {
  return {
    birthdate,
    date_recorded: addDays(birthdate, ageDays),
    sex: 'male',
    weight_kg: 8.5,
    measurement_cm: 73,
    measurement_type: 'length',
    ...overrides,
  };
}

test('calculates median WAZ and WHZ from the bundled WHO LMS references', () => {
  const ageDays = 365;
  const lengthCm = 75;
  const lengthIndex = Math.round((lengthCm - 45) * 10);
  const result = optPlusService.calculateOperationTimbang(measurement(ageDays, {
    weight_kg: growthStandards.wfl.male[lengthIndex][1],
    measurement_cm: lengthCm,
  }));
  const medianWeightResult = optPlusService.calculateOperationTimbang(measurement(ageDays, {
    weight_kg: growthStandards.wfa.male[ageDays][1],
  }));

  assert.equal(result.age_in_days, ageDays);
  assert.equal(result.age_in_months, 12);
  assert.equal(result.wflh_zscore, 0);
  assert.equal(result.wflh_status, 'Normal');
  assert.equal(medianWeightResult.wfa_zscore, 0);
  assert.ok(Number.isFinite(result.wfa_zscore));
  assert.ok(Number.isFinite(result.hfa_zscore));
});

test('matches pinned WHO Anthro numeric regression cases', () => {
  const whoWeightCase = optPlusService.calculateOperationTimbang(measurement(1522, {
    sex: 'female',
    weight_kg: 17,
    measurement_cm: growthStandards.hfa.female[1522][1],
    measurement_type: 'height',
  }));
  const whoLengthCase = optPlusService.calculateOperationTimbang(measurement(44, {
    sex: 'male',
    weight_kg: growthStandards.wfa.male[44][1],
    measurement_cm: 50,
    measurement_type: 'length',
  }));

  assert.equal(whoWeightCase.wfa_zscore.toFixed(2), '0.24');
  assert.equal(whoLengthCase.hfa_zscore.toFixed(2), '-3.29');
});

test('uses sex-specific and age-specific reference rows', () => {
  const male = optPlusService.calculateOperationTimbang(measurement(365));
  const female = optPlusService.calculateOperationTimbang(measurement(365, { sex: 'female' }));
  const older = optPlusService.calculateOperationTimbang(measurement(730));

  assert.notEqual(male.wfa_zscore, female.wfa_zscore);
  assert.notEqual(male.hfa_zscore, older.hfa_zscore);
});

test('keeps full precision for classification and rounds only in display formatting', () => {
  const scoreForWeight = (zScore) => {
    const [l, median, s] = growthStandards.wfa.male[365];
    const weight = l === 0
      ? median * Math.exp(s * zScore)
      : median * Math.pow(1 + l * s * zScore, 1 / l);
    return optPlusService.calculateOperationTimbang(measurement(365, { weight_kg: weight }));
  };

  const belowMinusTwo = scoreForWeight(-2.004);
  const aboveMinusTwo = scoreForWeight(-1.996);
  assert.equal(belowMinusTwo.wfa_zscore.toFixed(2), '-2.00');
  assert.equal(aboveMinusTwo.wfa_zscore.toFixed(2), '-2.00');
  assert.ok(belowMinusTwo.wfa_zscore < -2);
  assert.ok(aboveMinusTwo.wfa_zscore > -2);
  assert.equal(belowMinusTwo.wfa_status, 'Moderately underweight');
  assert.equal(aboveMinusTwo.wfa_status, 'Normal');
  assert.ok(Math.abs(optPlusService.lmsZScore(Math.exp(0.0123456), [0, 1, 0.1]) - 0.123456) < 1e-12);
});

test('classifies immediately below, at, and above each indicator boundary', () => {
  const delta = 1e-10;
  const checks = [
    [optPlusService.classifyWeightForAge, -3, 'Severely underweight', 'Moderately underweight', 'Moderately underweight'],
    [optPlusService.classifyWeightForAge, -2, 'Moderately underweight', 'Normal', 'Normal'],
    [optPlusService.classifyWeightForAge, 2, 'Normal', 'Normal', 'Overweight'],
    [optPlusService.classifyWeightForAge, 3, 'Overweight', 'Overweight', 'Obese'],
    [optPlusService.classifyHeightForAge, -3, 'Severely stunted', 'Moderately stunted', 'Moderately stunted'],
    [optPlusService.classifyHeightForAge, -2, 'Moderately stunted', 'Normal', 'Normal'],
    [optPlusService.classifyHeightForAge, 2, 'Normal', 'Normal', 'Tall'],
    [optPlusService.classifyWeightForHeight, -3, 'Severely wasted/SAM', 'Moderately wasted/MAM', 'Moderately wasted/MAM'],
    [optPlusService.classifyWeightForHeight, -2, 'Moderately wasted/MAM', 'Normal', 'Normal'],
    [optPlusService.classifyWeightForHeight, 2, 'Normal', 'Normal', 'Overweight'],
    [optPlusService.classifyWeightForHeight, 3, 'Overweight', 'Overweight', 'Obese'],
  ];

  for (const [classify, boundary, below, at, above] of checks) {
    assert.equal(classify(boundary - delta), below);
    assert.equal(classify(boundary), at);
    assert.equal(classify(boundary + delta), above);
  }
});

test('calculates calendar age from valid dates across leap years and month ends', () => {
  const assessDates = (birthdate, date_recorded) => {
    const ageDays = (Date.parse(`${date_recorded}T00:00:00Z`) - Date.parse(`${birthdate}T00:00:00Z`)) / 86400000;
    return optPlusService.calculateOperationTimbang({
      ...measurement(1),
      birthdate,
      date_recorded,
      weight_kg: growthStandards.wfa.male[ageDays][1],
      measurement_cm: growthStandards.hfa.male[ageDays][1],
    });
  };
  const leapDayBeforeBirthday = assessDates('2020-02-29', '2024-02-28');
  const leapDayBirthday = assessDates('2020-02-29', '2024-02-29');
  const beforeMonthEnd = assessDates('2020-01-31', '2020-02-29');
  const afterMonthEnd = assessDates('2020-01-31', '2020-03-01');

  assert.equal(leapDayBeforeBirthday.age_in_months, 47);
  assert.equal(leapDayBirthday.age_in_months, 48);
  assert.equal(beforeMonthEnd.age_in_months, 0);
  assert.equal(afterMonthEnd.age_in_months, 1);
});

test('uses WHO Anthro day boundaries at the second birthday', () => {
  const age730 = optPlusService.calculateOperationTimbang(measurement(730, {
    birthdate: '2022-01-01',
    date_recorded: '2024-01-01',
    measurement_cm: 86.5,
    measurement_type: 'length',
  }));
  const age731 = optPlusService.calculateOperationTimbang(measurement(731, {
    birthdate: '2022-01-01',
    date_recorded: '2024-01-02',
    measurement_cm: 86.5,
    measurement_type: 'height',
  }));

  assert.equal(age730.age_in_days, 730);
  assert.equal(age730.age_in_months, 24);
  assert.equal(age731.age_in_days, 731);
  assert.equal(age731.age_in_months, 24);
});

test('different weights and heights change their own nutritional classifications', () => {
  const baseline = optPlusService.calculateOperationTimbang(measurement(365));
  const lowerWeight = optPlusService.calculateOperationTimbang(measurement(365, { weight_kg: 6.2 }));
  const shorterHeight = optPlusService.calculateOperationTimbang(measurement(365, { measurement_cm: 70 }));

  assert.equal(baseline.wfa_status, 'Normal');
  assert.equal(lowerWeight.wfa_status, 'Severely underweight');
  assert.equal(lowerWeight.wflh_status, 'Severely wasted/SAM');
  assert.equal(shorterHeight.hfa_status, 'Moderately stunted');
  assert.equal(shorterHeight.wflh_status, 'Normal');
});

test('adjusts length and height by 0.7 cm at the 24-month boundary', () => {
  const beforeTwo = optPlusService.calculateOperationTimbang(measurement(730, {
    measurement_cm: 86.5,
    measurement_type: 'length',
  }));
  const beforeTwoStanding = optPlusService.calculateOperationTimbang(measurement(730, {
    measurement_cm: 85.8,
    measurement_type: 'height',
  }));
  const afterTwo = optPlusService.calculateOperationTimbang(measurement(731, {
    measurement_cm: 86.5,
    measurement_type: 'height',
  }));
  const afterTwoRecumbent = optPlusService.calculateOperationTimbang(measurement(731, {
    measurement_cm: 87.2,
    measurement_type: 'length',
  }));

  assert.equal(beforeTwo.hfa_zscore, beforeTwoStanding.hfa_zscore);
  assert.equal(beforeTwo.wflh_zscore, beforeTwoStanding.wflh_zscore);
  assert.equal(afterTwo.hfa_zscore, afterTwoRecumbent.hfa_zscore);
  assert.equal(afterTwo.wflh_zscore, afterTwoRecumbent.wflh_zscore);
});

test('classifies WHO indicator cutoffs independently', () => {
  assert.equal(optPlusService.classifyWeightForAge(-3.01), 'Severely underweight');
  assert.equal(optPlusService.classifyWeightForAge(-3), 'Moderately underweight');
  assert.equal(optPlusService.classifyWeightForAge(-2), 'Normal');
  assert.equal(optPlusService.classifyWeightForAge(2.01), 'Overweight');
  assert.equal(optPlusService.classifyWeightForAge(3.01), 'Obese');
  assert.equal(optPlusService.classifyHeightForAge(-3.01), 'Severely stunted');
  assert.equal(optPlusService.classifyHeightForAge(-2.01), 'Moderately stunted');
  assert.equal(optPlusService.classifyHeightForAge(2), 'Normal');
  assert.equal(optPlusService.classifyHeightForAge(2.01), 'Tall');
  assert.equal(optPlusService.classifyWeightForHeight(-3.01), 'Severely wasted/SAM');
  assert.equal(optPlusService.classifyWeightForHeight(-2.01), 'Moderately wasted/MAM');
  assert.equal(optPlusService.classifyWeightForHeight(2), 'Normal');
  assert.equal(optPlusService.classifyWeightForHeight(2.01), 'Overweight');
  assert.equal(optPlusService.classifyWeightForHeight(3.01), 'Obese');
});

test('rejects missing, invalid, implausible, and unsupported inputs', () => {
  const cases = [
    [{ ...measurement(365), sex: '' }, /sex must be recorded/i],
    [{ ...measurement(365), birthdate: '' }, /birthdate/i],
    [{ ...measurement(365), date_recorded: '2023-02-30' }, /valid date/i],
    [{ ...measurement(365), birthdate: '2023-02-29' }, /valid date/i],
    [{ ...measurement(365), birthdate: '2999-01-01' }, /birthdate cannot be in the future/i],
    [{ ...measurement(365), date_recorded: '' }, /valid date/i],
    [{ ...measurement(365), birthdate: '2024-01-01', date_recorded: '2023-12-31' }, /before the child/i],
    [{ ...measurement(365), weight_kg: 0 }, /positive number/i],
    [{ ...measurement(365), measurement_cm: -1 }, /positive number/i],
    [{ ...measurement(365), measurement_type: '' }, /measurement type/i],
    [measurement(100, { measurement_type: 'height' }), /before 9 months/i],
    [measurement(365, { measurement_cm: 44 }), /between 45 and 110 cm/i],
    [measurement(1826), /younger than 60 months/i],
    [measurement(1827), /younger than 60 months/i],
    [measurement(365, { weight_kg: 100 }), /plausible WHO range/i],
  ];

  for (const [input, expectedError] of cases) {
    assert.throws(() => optPlusService.calculateOperationTimbang(input), expectedError);
  }
});

test('uses extreme-score adjustment before applying plausibility checks', () => {
  const score = optPlusService.lmsZScore(18, [-0.03, 9.7, 0.14], true);
  const zeroPowerScore = optPlusService.lmsZScore(Math.exp(0.4), [0, 1, 0.1], true);
  assert.ok(score > 3);
  assert.ok(Number.isFinite(score));
  assert.ok(zeroPowerScore > 3);
});

test('persists calculated results on save and recalculates them when measurements are edited', async () => {
  const oldQuery = pool.query;
  const oldGetConnection = pool.getConnection;
  const oldWriteAudit = auditService.writeAudit;
  const originalRecord = {
    timbang_id: 31,
    resident_id: 42,
    weight_kg: 8.5,
    measurement_cm: 73,
    measurement_type: 'length',
    date_recorded: '2024-01-01',
    recorded_by: 9,
  };
  let record = { ...originalRecord };
  let assessmentValues;
  let assessmentId;
  let insertParams;

  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, params = []) {
      if (sql.includes('INSERT INTO operation_timbang\n')) {
        insertParams = params;
        record = { ...originalRecord, resident_id: params[0], weight_kg: params[1], measurement_cm: params[2], measurement_type: params[3], date_recorded: params[4] };
        return [{ insertId: record.timbang_id }];
      }
      if (sql.includes('INSERT INTO operation_timbang_assessments')) {
        assessmentId = 51;
        assessmentValues = params.slice(1);
        return [{ insertId: assessmentId }];
      }
      if (sql.includes('SELECT ot.*')) {
        return [[{
          ...record,
          assessment_id: assessmentId,
          age_in_months: assessmentValues[0],
          wfa_zscore: assessmentValues[1],
          wfa_status: assessmentValues[2],
          hfa_zscore: assessmentValues[3],
          hfa_status: assessmentValues[4],
          wflh_zscore: assessmentValues[5],
          wflh_status: assessmentValues[6],
        }]];
      }
      if (sql.includes('SELECT * FROM operation_timbang')) return [[{ ...record }]];
      if (sql.includes('UPDATE operation_timbang SET')) {
        [record.weight_kg, record.measurement_cm, record.measurement_type, record.date_recorded] = params.slice(0, 4);
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('SELECT assessment_id FROM operation_timbang_assessments')) {
        return assessmentId ? [[{ assessment_id: assessmentId }]] : [[]];
      }
      if (sql.includes('UPDATE operation_timbang_assessments')) {
        assessmentValues = params.slice(0, 7);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
  };
  let connectionRequests = 0;
  pool.query = async (sql) => {
    if (sql.includes('SELECT resident_id, DATE_FORMAT(birthdate')) {
      return [[{ resident_id: 42, birthdate: '2023-01-01', sex: 'male' }]];
    }
    if (sql.includes('FROM operation_timbang ot')) {
      return [[{
        ...record,
        assessment_id: assessmentId,
        age_in_months: assessmentValues[0],
        wfa_zscore: assessmentValues[1],
        wfa_status: assessmentValues[2],
        hfa_zscore: assessmentValues[3],
        hfa_status: assessmentValues[4],
        wflh_zscore: assessmentValues[5],
        wflh_status: assessmentValues[6],
      }]];
    }
    throw new Error(`Unexpected pool SQL in test: ${sql}`);
  };
  pool.getConnection = async () => {
    connectionRequests += 1;
    return connection;
  };
  auditService.writeAudit = async () => {};
  delete require.cache[require.resolve('../src/controllers/operationTimbangController')];
  const controller = require('../src/controllers/operationTimbangController');

  const invoke = async (handler, req) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await handler(req, res);
    return res;
  };

  try {
    const preview = await invoke(controller.calculateOperationTimbang, {
      body: {
        resident_id: 42,
        date_recorded: '2024-01-01',
        weight_kg: 8.5,
        measurement_cm: 73,
        measurement_type: 'length',
        wfa_zscore: -99,
      },
    });
    assert.equal(preview.statusCode, 200);
    assert.ok(preview.body.data.wfa_status);
    assert.notEqual(preview.body.data.wfa_zscore, -99);

    const invalid = await invoke(controller.createOperationTimbang, {
      body: {
        resident_id: 42,
        date_recorded: '2024-01-01',
        weight_kg: 0,
        measurement_cm: 73,
        measurement_type: 'length',
      },
      user: { user_id: 9 },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(connectionRequests, 0);

    const saved = await invoke(controller.createOperationTimbang, {
      body: {
        ...measurement(365),
        resident_id: 42,
        date_recorded: '2024-01-01',
        weight_kg: 8.5,
        measurement_cm: 73,
        wfa_zscore: 999,
        wfa_status: 'Normal',
      },
      user: { user_id: 9 },
    });
    assert.equal(saved.statusCode, 201);
    assert.ok(insertParams);
    assert.ok(assessmentValues[1] !== null);
    assert.ok(assessmentValues[2]);
    assert.notEqual(assessmentValues[1], 999);
    assert.equal(saved.body.data.wfa_zscore, assessmentValues[1]);
    assert.equal(Number.isInteger(assessmentValues[1]), false);
    assert.notEqual(assessmentValues[1], Number(assessmentValues[1].toFixed(2)));
    assert.equal(saved.body.data.wfa_status, assessmentValues[2]);
    const retrieved = await invoke(controller.getOperationTimbang, { params: { id: '31' } });
    assert.equal(retrieved.statusCode, 200);
    assert.equal(retrieved.body.data.wfa_zscore, assessmentValues[1]);
    assert.equal(retrieved.body.data.wflh_status, assessmentValues[6]);

    const previousWeightZ = assessmentValues[1];
    const edited = await invoke(controller.updateOperationTimbang, {
      params: { id: '31' },
      body: { weight_kg: 7.2, date_recorded: '2024-02-01' },
      user: { user_id: 9 },
    });
    assert.equal(edited.statusCode, 200);
    assert.notEqual(assessmentValues[1], previousWeightZ);
    assert.equal(assessmentValues[0], 13);
    assert.equal(edited.body.data.wfa_zscore, assessmentValues[1]);
  } finally {
    pool.query = oldQuery;
    pool.getConnection = oldGetConnection;
    auditService.writeAudit = oldWriteAudit;
    delete require.cache[require.resolve('../src/controllers/operationTimbangController')];
  }
});
