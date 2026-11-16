import { calculateAgeInMonths, formatNutritionRecordAge } from './nutritionRecordAge';

test('calculates age in complete calendar months on the record date', () => {
  expect(calculateAgeInMonths('2025-01-20', '2025-02-19')).toBe(0);
  expect(calculateAgeInMonths('2025-01-20', '2025-02-20')).toBe(1);
  expect(calculateAgeInMonths('2024-02-29', '2025-02-28')).toBe(11);
  expect(calculateAgeInMonths('2024-02-29', '2025-03-01')).toBe(12);
});

test('formats infant ages in months and older ages in years', () => {
  expect(formatNutritionRecordAge({ age_in_months: 8 })).toBe('8 months');
  expect(formatNutritionRecordAge({ age_in_months: 1 })).toBe('1 month');
  expect(formatNutritionRecordAge({ age_in_months: 53 })).toBe('4 years');
  expect(formatNutritionRecordAge({ age_years: 17 })).toBe('17 years');
  expect(formatNutritionRecordAge({ age_in_months: 0 })).toBe('Under 1 month');
});
