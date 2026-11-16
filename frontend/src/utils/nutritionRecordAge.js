function parseDateParts(value) {
  if (!value) return null;
  const match = String(value).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { year, month, day };
}

export function calculateAgeInMonths(birthdate, asOfDate) {
  const birth = parseDateParts(birthdate);
  const asOf = parseDateParts(asOfDate);
  if (!birth || !asOf) return null;

  let months = ((asOf.year - birth.year) * 12) + asOf.month - birth.month;
  if (asOf.day < birth.day) months -= 1;
  return months >= 0 ? months : null;
}

export function formatNutritionRecordAge(record) {
  const recordDate = record.recordDate || record.date_recorded || record.record_date || record.created_at;
  const calculatedMonths = calculateAgeInMonths(record.birthdate, recordDate);
  const savedMonths = record.age_in_months ?? record.age_months;
  const months = calculatedMonths ?? (savedMonths !== undefined && savedMonths !== null
    ? Number(savedMonths)
    : record.age_years !== undefined && record.age_years !== null
      ? Number(record.age_years) * 12
      : null);

  if (!Number.isFinite(months) || months < 0) return '-';
  if (months < 12) return months === 0 ? 'Under 1 month' : `${months} ${months === 1 ? 'month' : 'months'}`;

  const years = Math.floor(months / 12);
  return `${years} ${years === 1 ? 'year' : 'years'}`;
}
