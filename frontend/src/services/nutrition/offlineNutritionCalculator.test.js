import growthStandards from '../../data/nutrition/who2006-growth-standards.json';
import adolescentReferences from '../../data/nutrition/who2007-bmi-for-age.json';
import {
  calculateAdolescentBMIOffline,
  calculateAdultBMIOffline,
  calculateOperationTimbangOffline,
} from './offlineNutritionCalculator';

test('bundled WHO reference data covers the required sexes, ages, and indicators', () => {
  expect(growthStandards.wfa.male).toHaveLength(1827);
  expect(growthStandards.wfa.female).toHaveLength(1827);
  expect(growthStandards.hfa.male).toHaveLength(1827);
  expect(growthStandards.hfa.female).toHaveLength(1827);
  expect(growthStandards.wfl.male).toHaveLength(651);
  expect(growthStandards.wfh.female).toHaveLength(551);
  expect(adolescentReferences.minimumAgeMonths).toBe(61);
  expect(adolescentReferences.maximumAgeMonths).toBe(228);
  expect(adolescentReferences.male).toHaveLength(168);
  expect(adolescentReferences.female).toHaveLength(168);
});

test('Operation Timbang offline matches the backend WHO Anthro regression result', () => {
  const result = calculateOperationTimbangOffline({
    birthdate: '2019-01-01',
    date_recorded: '2020-01-01',
    sex: 'male',
    weight_kg: 8.5,
    measurement_cm: 73,
    measurement_type: 'length',
  });

  expect(result).toEqual({
    age_in_days: 365,
    age_in_months: 12,
    wfa_zscore: -1.1529764019713948,
    wfa_status: 'Normal',
    hfa_zscore: -1.1528511286434184,
    hfa_status: 'Normal',
    wflh_zscore: -0.8164661790588028,
    wflh_status: 'Normal',
  });
  expect(result).not.toHaveProperty('bmi');
});

test('adult BMI offline matches backend rounding and 240-month eligibility', () => {
  const resident = { birthdate: '2006-01-01' };
  const result = calculateAdultBMIOffline(resident, {
    resident_id: 8,
    date_recorded: '2026-01-01',
    weight_kg: 40.7,
    height_cm: 147,
  });
  expect(result).toEqual({
    resident_id: 8,
    date_recorded: '2026-01-01',
    age_years: 20,
    height_cm: 147,
    weight_kg: 40.7,
    bmi: 18.83,
    bmi_category: 'Normal',
  });
  expect(() => calculateAdultBMIOffline(resident, {
    date_recorded: '2025-12-01',
    weight_kg: 70,
    height_cm: 170,
  })).toThrow('Adult BMI is for ages 20+');
});

test('adolescent BMI offline matches backend WHO 2007 LMS regression results', () => {
  const result = calculateAdolescentBMIOffline(
    { birthdate: '2010-01-15', sex: 'female' },
    { resident_id: 8, record_date: '2020-01-15', weight_kg: 40, height_cm: 150 }
  );
  expect(result).toEqual({
    record_date: '2020-01-15',
    age_years: 10,
    age_months: 120,
    height_cm: 150,
    weight_kg: 40,
    bmi: 17.78,
    bmi_for_age_zscore: 0.52,
    bmi_for_age_category: 'Normal',
  });
});

test('offline nutrition calculators enforce exact age boundaries and reject invalid reference inputs', () => {
  const adolescent = { birthdate: '2020-01-01', sex: 'male' };
  expect(() => calculateAdolescentBMIOffline(adolescent, {
    record_date: '2025-01-01',
    weight_kg: 18,
    height_cm: 110,
  })).toThrow('61-228 months');
  expect(calculateAdolescentBMIOffline(adolescent, {
    record_date: '2025-02-01',
    weight_kg: 18,
    height_cm: 110,
  }).age_months).toBe(61);
  const oldestAdolescent = { birthdate: '2000-01-01', sex: 'female' };
  expect(calculateAdolescentBMIOffline(oldestAdolescent, {
    record_date: '2019-01-01',
    weight_kg: 70,
    height_cm: 180,
  }).age_months).toBe(228);
  expect(() => calculateAdolescentBMIOffline(oldestAdolescent, {
    record_date: '2019-02-01',
    weight_kg: 18,
    height_cm: 110,
  })).toThrow('61-228 months');

  expect(() => calculateOperationTimbangOffline({
    birthdate: '2020-01-01',
    date_recorded: '2025-01-01',
    sex: 'male',
    weight_kg: 10,
    measurement_cm: 80,
    measurement_type: 'length',
  })).toThrow('younger than 60 months');
  expect(() => calculateOperationTimbangOffline({
    birthdate: '2020-01-01',
    date_recorded: '2021-01-01',
    sex: 'male',
    weight_kg: 100,
    measurement_cm: 80,
    measurement_type: 'length',
  })).toThrow('plausible WHO range');
});
