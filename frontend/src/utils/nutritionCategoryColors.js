const CATEGORY_TONES = [
  { tone: 'normal', match: (value) => value === 'normal' },
  { tone: 'severe', match: (value) => /severely underweight|severe thinness|severely wasted|severe wasting|severe stunted/.test(value) },
  { tone: 'underweight', match: (value) => /underweight|thinness|thin|wasted|stunted/.test(value) },
  { tone: 'overweight', match: (value) => value.includes('overweight') },
  { tone: 'obese', match: (value) => /obes/.test(value) },
];

export function getNutritionCategoryTone(label) {
  const normalized = String(label || '').trim().toLowerCase();
  return CATEGORY_TONES.find(({ match }) => match(normalized))?.tone
    || 'other';
}

export function getNutritionCategoryColorVariable(label) {
  const tone = getNutritionCategoryTone(label);
  if (tone !== 'other') return `--fhsis-series-${tone}`;
  const hash = String(label || '').split('').reduce((value, character) => value + character.charCodeAt(0), 0);
  return `--fhsis-series-other-${hash % 4}`;
}
