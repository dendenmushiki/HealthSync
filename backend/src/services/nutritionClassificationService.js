const CANONICAL_STATUSES = new Map([
  ['normal', 'Normal'],
  ['overweight', 'Overweight'],
  ['obese', 'Obese'],
  ['obesity', 'Obese'],
  ['underweight', 'Underweight'],
  ['severely underweight', 'Severely underweight'],
  ['moderately underweight', 'Moderately underweight'],
  ['severely wasted/sam', 'Severely wasted/SAM'],
  ['severely wasted', 'Severely wasted/SAM'],
  ['moderately wasted/mam', 'Moderately wasted/MAM'],
  ['moderately wasted', 'Moderately wasted/MAM'],
  ['wasted', 'Wasted'],
  ['severely stunted', 'Severely stunted'],
  ['moderately stunted', 'Moderately stunted'],
  ['stunted', 'Stunted'],
  ['tall', 'Tall'],
  ['severe thinness', 'Severe Thinness'],
  ['thinness', 'Thinness']
]);

const SEVERITY = new Map([
  ['severely underweight', 7],
  ['severely wasted/sam', 7],
  ['severely stunted', 7],
  ['moderately underweight', 6],
  ['moderately wasted/mam', 6],
  ['moderately stunted', 6],
  ['underweight', 5],
  ['wasted', 5],
  ['stunted', 5],
  ['severe thinness', 5],
  ['thinness', 4],
  ['overweight', 3],
  ['obese', 3],
  ['tall', 1],
  ['normal', 0]
]);

function normalizeNutritionStatus(status) {
  const text = String(status || '').trim();
  if (!text) return null;
  return CANONICAL_STATUSES.get(text.toLowerCase()) || text;
}

function getSeverity(status) {
  const normalized = normalizeNutritionStatus(status);
  return normalized ? (SEVERITY.get(normalized.toLowerCase()) ?? 1) : -1;
}

function classifyOperationTimbang(row = {}) {
  const indicators = [
    ['WAZ', row.wfa_status],
    ['HAZ', row.hfa_status],
    ['WHZ', row.wflh_status]
  ].map(([code, value]) => ({ code, status: normalizeNutritionStatus(value) }));
  const classified = indicators
    .map((indicator, index) => ({ ...indicator, index, severity: getSeverity(indicator.status) }))
    .filter((indicator) => indicator.status)
    .sort((a, b) => b.severity - a.severity || a.index - b.index);
  return { status: classified[0]?.status || null, indicators };
}

function escapeSql(value) {
  return value.replace(/'/g, "''");
}

function normalizedStatusSql(expression) {
  const cases = [...CANONICAL_STATUSES.entries()]
    .map(([source, target]) => `WHEN '${escapeSql(source)}' THEN '${escapeSql(target)}'`)
    .join('\n      ');
  return `CASE LOWER(TRIM(${expression}))
      ${cases}
      ELSE NULLIF(TRIM(${expression}), '')
    END`;
}

function statusSeveritySql(expression) {
  const grouped = new Map();
  SEVERITY.forEach((severity, status) => {
    const sources = [...CANONICAL_STATUSES.entries()]
      .filter(([, canonical]) => canonical.toLowerCase() === status)
      .map(([source]) => `'${escapeSql(source)}'`);
    sources.push(`'${escapeSql(status)}'`);
    grouped.set(severity, [...new Set([...(grouped.get(severity) || []), ...sources])]);
  });
  const cases = [...grouped.entries()]
    .sort(([a], [b]) => b - a)
    .map(([severity, statuses]) => `WHEN LOWER(TRIM(${expression})) IN (${statuses.join(', ')}) THEN ${severity}`)
    .join('\n      ');
  return `CASE
      WHEN NULLIF(TRIM(${expression}), '') IS NULL THEN -1
      ${cases}
      ELSE 1
    END`;
}

function operationTimbangStatusSql(alias = 'ota') {
  const fields = ['wfa_status', 'hfa_status', 'wflh_status'].map((field) => `${alias}.${field}`);
  const normalized = fields.map(normalizedStatusSql);
  const severity = fields.map(statusSeveritySql);
  return `(CASE
    WHEN ${normalized[0]} IS NOT NULL AND ${severity[0]} >= ${severity[1]} AND ${severity[0]} >= ${severity[2]} THEN ${normalized[0]}
    WHEN ${normalized[1]} IS NOT NULL AND ${severity[1]} >= ${severity[2]} THEN ${normalized[1]}
    ELSE ${normalized[2]}
  END)`;
}

function latestNutritionStatusSql(residentAlias = 'r') {
  const ageYears = `TIMESTAMPDIFF(YEAR, ${residentAlias}.birthdate, CURDATE())`;
  return `CASE
    WHEN ${residentAlias}.birthdate IS NOT NULL AND ${ageYears} <= 5 THEN (
      SELECT ${operationTimbangStatusSql('ota')}
      FROM operation_timbang ot
      LEFT JOIN operation_timbang_assessments ota ON ota.timbang_id = ot.timbang_id
      WHERE ot.resident_id = ${residentAlias}.resident_id
      ORDER BY ot.date_recorded DESC, ot.timbang_id DESC LIMIT 1
    )
    WHEN ${residentAlias}.birthdate IS NOT NULL AND ${ageYears} <= 19 THEN (
      SELECT ${normalizedStatusSql('abr.bmi_for_age_category')}
      FROM adolescent_bmi_records abr
      WHERE abr.resident_id = ${residentAlias}.resident_id
      ORDER BY abr.record_date DESC, abr.record_id DESC LIMIT 1
    )
    ELSE (
      SELECT ${normalizedStatusSql('adult.bmi_category')}
      FROM adult_bmi_records adult
      WHERE adult.resident_id = ${residentAlias}.resident_id
      ORDER BY adult.date_recorded DESC, adult.bmi_id DESC LIMIT 1
    )
  END`;
}

module.exports = {
  classifyOperationTimbang,
  latestNutritionStatusSql,
  normalizeNutritionStatus,
  operationTimbangStatusSql
};
