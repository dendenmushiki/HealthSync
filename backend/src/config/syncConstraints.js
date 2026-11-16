module.exports = {
  // Domain-specific constraints to merge with DB-derived defaults
  residents: {
    birthdate: { minDate: '1900-01-01' },
    civil_status: { allowed: ['Single', 'Married', 'Widowed', 'Separated', 'Divorced', 'Annulled', 'Unknown'] },
    resident_status: { allowed: ['Active', 'Inactive', 'Transferred', 'Deceased'] },
    sex: { allowed: ['male', 'female'] }
  },
  operation_timbang: {
    weight: { min: 0.5, max: 500 },
    height: { min: 20, max: 300 }
  },
  adolescent_bmi_records: {
    age_months: { min: 0, max: 240 },
    bmi: { min: 5, max: 60 },
    zscore: { min: -10, max: 10 }
  },
  adult_bmi_records: {
    bmi: { min: 5, max: 80 }
  },
  health_records: {
    record_date: { minDate: '1900-01-01' }
  }
};
