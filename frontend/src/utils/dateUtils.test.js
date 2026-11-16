import { formatBirthdate, formatDateLabel, formatDateOnly, formatDateTime, formatRelativeTime, getDateInputValueInTimeZone, toDateInputValue } from './dateUtils';

test('date-only strings keep their calendar day for inputs and display', () => {
  expect(toDateInputValue('1981-01-05')).toBe('1981-01-05');
  expect(toDateInputValue('1981-01-05T00:00:00.000Z')).toBe('1981-01-05');
  expect(formatDateOnly('1981-01-05')).toBe('January 5, 1981');
  expect(formatDateLabel('2026-09-07T00:00:00.000Z')).toBe('Sep 7, 2026');
});

test('birthdate formatting preserves calendar date and includes age', () => {
  expect(formatBirthdate('1978-02-25', new Date(2026, 1, 25))).toBe('Feb 25, 1978 (48 yrs)');
});

test('report date boundaries use the selected timezone rather than UTC', () => {
  expect(getDateInputValueInTimeZone('Asia/Manila', new Date('2026-10-31T16:30:00.000Z'))).toBe('2026-11-01');
});

test('activity timestamps have exact and relative display labels', () => {
  const now = new Date('2026-11-08T11:26:00.000Z');
  const then = new Date('2026-11-06T11:26:00.000Z');
  expect(formatDateTime(now)).toContain('Nov 8, 2026');
  expect(formatDateTime(now)).toContain(new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(now));
  expect(formatRelativeTime(then, now)).toBe('2 days ago');
  expect(formatDateTime('invalid')).toBeNull();
});

test('invalid and empty date values return empty display values', () => {
  expect(toDateInputValue('not-a-date')).toBe('');
  expect(formatDateOnly('')).toBeNull();
});
