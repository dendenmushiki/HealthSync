const isValidDate = (value) => {
  if (!value) return true;
  const date = String(value).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
};

function validateMaternalRecord(recordData) {
  const errors = {};
  const lmp = recordData?.lmp;
  const edc = recordData?.edc;
  if (lmp && !isValidDate(lmp)) errors.lmp = 'Enter a valid LMP date.';
  if (edc && !isValidDate(edc)) errors.edc = 'Enter a valid EDC date.';
  if (!errors.lmp && !errors.edc && lmp && edc &&
      String(edc).slice(0, 10) < String(lmp).slice(0, 10)) {
    errors.edc = 'EDC cannot be before LMP.';
  }
  return errors;
}

module.exports = { validateMaternalRecord };
