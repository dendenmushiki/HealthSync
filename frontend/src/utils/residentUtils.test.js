import { calculateAgeInMonths } from './residentUtils';

test('calculates completed months accurately around the adult BMI eligibility boundary', () => {
  expect(calculateAgeInMonths('2006-01-01', '2025-01-01')).toBe(228);
  expect(calculateAgeInMonths('2006-01-01', '2025-02-01')).toBe(229);
  expect(calculateAgeInMonths('2006-01-01', '2025-02-02')).toBe(229);
  expect(calculateAgeInMonths('2006-01-01', '2025-01-31')).toBe(228);
});

test('returns null when the reference date is invalid or precedes birth', () => {
  expect(calculateAgeInMonths('2006-01-01', 'not-a-date')).toBeNull();
  expect(calculateAgeInMonths('2006-01-01', '2005-12-31')).toBeNull();
});
