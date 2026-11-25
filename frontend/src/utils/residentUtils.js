import { getLocalDateInputValue, toDateInputValue } from './dateUtils';

export function calculateAge(birthdate, asOf = new Date()) {
  if (!birthdate) return null;
  const dateValue = toDateInputValue(birthdate);
  if (!dateValue) return null;
  const birth = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  let age = asOf.getFullYear() - birth.getFullYear();
  if (asOf.getMonth() < birth.getMonth() || (asOf.getMonth() === birth.getMonth() && asOf.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

export function calculateAgeInMonths(birthdate, asOf = new Date()) {
  const birthText = toDateInputValue(birthdate);
  const referenceText = asOf instanceof Date ? getLocalDateInputValue(asOf) : toDateInputValue(asOf);
  const parseDate = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const [, year, month, day] = match.map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
    return { year, month, day };
  };
  const birth = parseDate(birthText);
  const reference = parseDate(referenceText);
  if (!birth || !reference) return null;

  let months = (reference.year - birth.year) * 12 + reference.month - birth.month;
  if (reference.day < birth.day) months -= 1;
  return months >= 0 ? months : null;
}

export function isSeniorCitizen(birthdate, asOf = new Date()) {
  const age = calculateAge(birthdate, asOf);
  return age !== null && age >= 60;
}

export function normalizeResidentId(value) {
  const text = String(value ?? '').trim();
  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    if (Number.isSafeInteger(numeric)) return numeric;
  }
  return value;
}

export function formatResidentName(resident) {
  const first = [resident.first_name, resident.middle_name].filter(Boolean).join(' ');
  return [resident.last_name, first, resident.suffix].filter(Boolean).join(', ').replace(', ' + resident.suffix, ` ${resident.suffix}`);
}
