export const REPORT_SECTIONS = [
  {
    id: 'overview',
    title: 'Overview',
    description: 'Registry snapshots and period-based activity.',
  },
  {
    id: 'nutrition',
    title: 'Nutritional monitoring',
    description: 'Recorded assessments classified by the existing HealthSync nutrition services.',
  },
  {
    id: 'child-care',
    title: 'Child care & immunization',
    description: 'Child health and immunization fields recorded during the selected period.',
  },
  {
    id: 'maternal-care',
    title: 'Maternal care',
    description: 'Maternal indicators available from current structured records.',
  },
  {
    id: 'senior-registry',
    title: 'Senior citizens',
    description: 'Residents with a Senior Registry entry; this is not the age-eligible population.',
  },
];

export const CHILD_INDICATORS = [
  { key: 'cpab', label: 'Child protected at birth (CPAB)', tracked: false, definition: 'There is no structured CPAB field in the current record model.' },
  { key: 'bcg', label: 'BCG', path: ['immunization', 'bcg'], definition: 'Distinct residents with a non-empty BCG date in immunization records during the period.' },
  { key: 'hepaBWithin24Hours', label: 'Hepatitis B within 24 hours', path: ['immunization', 'hepaBWithin24Hours'], definition: 'Distinct residents with a non-empty Hepatitis B within-24-hours date in immunization records during the period.' },
  { key: 'penta1', label: 'Penta dose 1', group: 'Penta', path: ['immunization', 'penta1'] },
  { key: 'penta2', label: 'Penta dose 2', group: 'Penta', path: ['immunization', 'penta2'] },
  { key: 'penta3', label: 'Penta dose 3', group: 'Penta', path: ['immunization', 'penta3'] },
  { key: 'opv1', label: 'OPV/IPV dose 1', group: 'OPV/IPV', path: ['immunization', 'opv1'], definition: 'The current form stores this field as OPV/IPV.' },
  { key: 'opv2', label: 'OPV/IPV dose 2', group: 'OPV/IPV', path: ['immunization', 'opv2'], definition: 'The current form stores this field as OPV/IPV.' },
  { key: 'opv3', label: 'OPV/IPV dose 3', group: 'OPV/IPV', path: ['immunization', 'opv3'], definition: 'The current form stores this field as OPV/IPV.' },
  { key: 'pcv1', label: 'PCV dose 1', group: 'PCV', path: ['immunization', 'pcv1'] },
  { key: 'pcv2', label: 'PCV dose 2', group: 'PCV', path: ['immunization', 'pcv2'] },
  { key: 'pcv3', label: 'PCV dose 3', group: 'PCV', path: ['immunization', 'pcv3'] },
  { key: 'mmr1', label: 'MMR dose 1', group: 'MMR', tracked: false },
  { key: 'mmr2', label: 'MMR dose 2', group: 'MMR', tracked: false },
  { key: 'mmrRecorded', label: 'MMR recorded (dose unspecified)', group: 'MMR', path: ['immunization', 'mmrRecorded'], definition: 'The current form records an MMR date without a dose number.' },
  { key: 'vitaminA6To11Months', label: 'Vitamin A (6–11 months)', group: 'Vitamin A', path: ['immunization', 'vitaminA6To11Months'] },
  { key: 'vitaminA12To59Months', label: 'Vitamin A (12–59 months)', group: 'Vitamin A', tracked: false },
  { key: 'vitaminA12To15Months', label: 'Vitamin A (12–15 months)', group: 'Vitamin A', path: ['immunization', 'vitaminA12To15Months'], definition: 'Currently mapped to the second-dose date field. The model does not capture an age at administration.' },
  { key: 'deworming', label: 'Deworming', tracked: false },
];

export const MATERNAL_INDICATORS = [
  { key: 'womenSeen', label: 'Women with a maternal record', path: ['maternal', 'womenSeen'], definition: 'Distinct residents with a maternal record during the selected period.' },
  { key: 'firstTrimester', label: 'First-trimester visits', tracked: false },
  { key: 'tt2Plus', label: 'Tetanus toxoid status TT2+', tracked: false },
  { key: 'ttStatusDocumented', label: 'Tetanus toxoid status documented', path: ['maternal', 'ttStatusDocumented'], definition: 'Distinct residents with a non-empty TT status value; the current model does not classify TT2+.' },
  { key: 'deliveries', label: 'Total deliveries', tracked: false },
  { key: 'facilityDeliveries', label: 'Facility-based deliveries', tracked: false },
  { key: 'nonFacilityDeliveries', label: 'Non-facility deliveries', tracked: false },
  { key: 'sbaDoctor', label: 'Skilled birth attendant – doctor', group: 'Skilled birth attendants', tracked: false },
  { key: 'sbaNurse', label: 'Skilled birth attendant – nurse', group: 'Skilled birth attendants', tracked: false },
  { key: 'sbaMidwife', label: 'Skilled birth attendant – midwife', group: 'Skilled birth attendants', tracked: false },
  { key: 'postnatalVisits', label: 'Women with at least 2 postnatal visits', tracked: false },
];

export const SENIOR_INDICATORS = [
  { key: 'seniorRegistered', label: 'Senior citizens registered', path: ['seniorCitizens'], definition: 'Distinct residents with a Senior Registry record and a matching resident record.' },
  { key: 'ppv', label: 'Pneumococcal vaccination (PPV)', tracked: false },
  { key: 'influenza', label: 'Influenza vaccination', tracked: false },
];

export const NUTRITION_CATEGORIES = {
  operationTimbang: [
    { key: 'normal', label: 'Normal', definition: 'Recorded WFLH classification is Normal.' },
    { key: 'underweight-thin', label: 'Underweight / Thin', definition: 'Combined WFLH undernutrition classifications retained from the current FHSIS mapping.' },
    { key: 'overweight', label: 'Overweight', definition: 'Recorded WFLH classification contains Overweight.' },
    { key: 'obese', label: 'Obese', definition: 'Recorded WFLH classification contains Obese or Obesity.' },
  ],
  adolescent: [
    { key: 'severe-thinness', label: 'Severe Thinness' },
    { key: 'thinness', label: 'Thinness' },
    { key: 'normal', label: 'Normal' },
    { key: 'overweight', label: 'Overweight' },
    { key: 'obesity', label: 'Obesity' },
  ],
  adult: [
    { key: 'underweight', label: 'Underweight' },
    { key: 'normal', label: 'Normal' },
    { key: 'overweight', label: 'Overweight' },
    { key: 'obese', label: 'Obese' },
  ],
};

export const NUTRITION_TOTALS = {
  operationTimbang: { key: 'operation-timbang:total-assessments', label: 'Total assessment records', definition: 'Sum of classified Operation Timbang assessments in the selected period.' },
  adolescent: { key: 'adolescent-bmi:total-assessments', label: 'Total classified assessments', definition: 'Sum of adolescent BMI records with a stored classification in the selected period.' },
  adult: { key: 'adult-bmi:total-assessments', label: 'Total classified assessments', definition: 'Sum of adult BMI records with a stored classification in the selected period.' },
};

export const INDICATOR_DEFINITIONS = [
  ...NUTRITION_CATEGORIES.operationTimbang.map((item) => ({ ...item, section: 'nutrition', group: 'Operation Timbang', tracked: true })),
  ...NUTRITION_CATEGORIES.adolescent.map((item) => ({ ...item, section: 'nutrition', group: 'Adolescent BMI', tracked: true })),
  ...NUTRITION_CATEGORIES.adult.map((item) => ({ ...item, section: 'nutrition', group: 'Adult BMI', tracked: true })),
  ...Object.values(NUTRITION_TOTALS).map((item) => ({ ...item, section: 'nutrition', tracked: true })),
  ...CHILD_INDICATORS.map((item) => ({ ...item, section: 'child-care', tracked: item.tracked !== false })),
  ...MATERNAL_INDICATORS.map((item) => ({ ...item, section: 'maternal-care', tracked: item.tracked !== false })),
  ...SENIOR_INDICATORS.map((item) => ({ ...item, section: 'senior-registry', tracked: item.tracked !== false })),
];
