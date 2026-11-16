const formatDateParts = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

export function toDateInputValue(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return formatDateParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  const text = String(value).trim();
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return formatDateParts(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
}

export function getLocalDateInputValue(date = new Date()) {
  return formatDateParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export function getLocalTimeInputValue(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function getDateInputValueInTimeZone(timeZone = 'Asia/Manila', date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map(({ type, value }) => [type, value]));
  return formatDateParts(values.year, values.month, values.day);
}

export function formatDateTimeInTimeZone(value, timeZone = 'Asia/Manila') {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-PH', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!value || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatRelativeTime(value, now = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!value || Number.isNaN(date.getTime())) return null;
  const deltaSeconds = Math.round((date.getTime() - (now instanceof Date ? now.getTime() : now)) / 1000);
  const units = [
    { limit: 60, seconds: 1 },
    { limit: 3600, seconds: 60 },
    { limit: 86400, seconds: 3600 },
    { limit: Infinity, seconds: 86400 },
  ];
  const unit = units.find(({ limit }) => Math.abs(deltaSeconds) < limit);
  const amount = Math.round(deltaSeconds / unit.seconds);
  const unitName = unit.seconds === 1 ? 'second'
    : unit.seconds === 60 ? 'minute'
      : unit.seconds === 3600 ? 'hour' : 'day';
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(amount, unitName);
}

export function formatDateOnly(value, options = {}) {
  const dateValue = toDateInputValue(value);
  if (!dateValue) return null;
  const [year, month, day] = dateValue.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', ...options });
}

export function formatDateLabel(value) {
  return formatDateOnly(value, { month: 'short' });
}

export function formatBirthdate(value, asOf = new Date()) {
  const date = formatDateLabel(value);
  if (!date) return null;
  const dateValue = toDateInputValue(value);
  const [year, month, day] = dateValue.split('-').map(Number);
  let age = asOf.getFullYear() - year;
  if (asOf.getMonth() + 1 < month || (asOf.getMonth() + 1 === month && asOf.getDate() < day)) age -= 1;
  return `${date} (${age} yrs)`;
}
