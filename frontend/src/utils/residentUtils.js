import { toDateInputValue } from './dateUtils';

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
