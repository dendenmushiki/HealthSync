const yesNo = [{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }];
const familyHealthOptions = ['DM', 'BA', 'HPN', 'CA'].map((value) => ({ value, label: value }));
const maternalHistoryOptions = [
  { value: 'DM', label: 'Diabetes mellitus (DM)' },
  { value: 'BA', label: 'Bronchial asthma (BA)' },
  { value: 'HPN', label: 'Hypertension (HPN)' },
  { value: 'CA', label: 'Cancer (CA)' }
];
const field = (name, label, type = 'text', options) => ({ name, label, type, ...(options ? { options } : {}) });

export const medicalRecordForms = {
  clinical: {
    key: 'clinical',
    title: 'Clinical Record',
    tableName: 'PatientClinicalRecord',
    demographics: [
      field('last_name', 'Last Name', 'resident', 'last_name'),
      field('first_name', 'First Name', 'resident', 'first_name'),
      field('middle_name', 'Middle Name', 'resident', 'middle_name'),
      field('suffix', 'Ext Name', 'resident', 'suffix'),
      field('age', 'Age', 'resident', 'age'),
      field('birthdate', 'Date of Birth', 'resident', 'birthdate'),
      field('civil_status', 'Civil Status', 'resident', 'civil_status'),
      field('sex', 'Gender', 'resident', 'sex'),
      field('client_type', 'Client Type', 'select', [{ value: 'New', label: 'New' }, { value: 'Follow-up', label: 'Follow-up' }, { value: 'Referral', label: 'Referral' }]),
      field('address', 'Address', 'resident', 'address'),
      field('family_serial_number', 'Family Serial #', 'resident', 'household_no'),
      field('religion', 'Religion'),
      field('birthplace', 'Birthplace'),
      field('philhealth_number', 'PhilHealth #', 'resident', 'philhealth_id_no'),
      field('authorization_transaction_code', 'Authorization Transaction Code'),
      field('educational_attainment', 'Educational Attainment'),
      field('occupation', 'Occupation', 'resident', 'occupation'),
      field('spouse_name', 'Spouse Name'),
      field('contact_number', 'Contact #', 'resident', 'contact_no')
    ],
    sections: [
      { title: 'Clinical Notes', column: 'left', fields: [
        field('visit_date', 'Date', 'date'), field('visit_time', 'Time', 'time'),
        field('history_of_present_illness', 'S: History of Present Illness', 'textarea'),
        field('blood_pressure', 'BP (mmHg)'), field('heart_rate', 'HR (bpm)'), field('respiratory_rate', 'RR (bpm)'),
        field('height_cm', 'Ht (cm)', 'number'), field('weight_kg', 'Wt (kg)', 'number'), field('temperature', 'Temp (°C)', 'number'),
        field('findings', 'Findings', 'textarea'), field('assessment', 'A: Assessment', 'textarea'), field('plan', 'P: Plan', 'textarea')
      ] },
      { title: 'PMH', column: 'right', fields: [
        field('pmh_allergy', 'Allergy'), field('pmh_allergy_specify', 'Specify Allergy'),
        field('pmh_history_of_illness', 'History of Illness'), field('pmh_history_of_illness_specify', 'Specify Illness'),
        field('maintenance_medications', 'Maintenance Meds'), field('pmh_cancer_organ', 'Specify organ with Cancer')
      ] },
      { title: 'Past Surgical History', column: 'right', fields: [
        field('psh_history', 'Past surgical history', 'radio', yesNo),
        field('past_surgical_history', 'Operations', 'table', { columns: [{ name: 'operation', label: 'Operation' }, { name: 'date', label: 'Date', type: 'date' }], addLabel: 'Add Operation' })
      ] },
      { title: 'FMH', column: 'right', fields: [
        field('fmh_allergy', 'Allergy'), field('fmh_allergy_specify', 'Specify Allergy'),
        field('fmh_history_of_illness', 'History of Illness'), field('fmh_history_of_illness_specify', 'Specify Illness'),
        field('fmh_cancer_organ', 'Specify organ with cancer')
      ] },
      { title: 'Personal Social History', column: 'right', fields: [
        field('smoking', 'Smoking', 'radio', yesNo), field('smoking_packs_per_year', 'No. of packs/year', 'number'),
        field('alcohol', 'Alcohol', 'radio', yesNo), field('alcohol_bottles_per_day', 'No. of bottles/day', 'number'),
        field('illicit_drugs', 'Illicit Drugs', 'radio', yesNo), field('sexually_active', 'Sexually Active', 'radio', yesNo),
        field('sexually_active_details', 'More+/More')
      ] },
      { title: 'Immunization & Family Planning', column: 'right', fields: [
        field('immunization', 'Immunization'), field('family_planning_method', 'Family Planning Method')
      ] },
      { title: 'Menstrual History', column: 'right', fields: [
        field('menarche', 'Menarche', 'number'), field('lmp', 'LMP', 'date'), field('menstrual_duration', 'Duration'),
        field('menstrual_pads_per_day', 'No. of pads/day', 'number'), field('interval_cycle', 'Interval Cycle'),
        field('menopause', 'Menopause', 'radio', yesNo)
      ] },
      { title: 'Pregnancy History', column: 'right', fields: [
        field('gravida', 'Gravida', 'number'), field('parity', 'Parity', 'number'),
        field('type_of_delivery', 'Type of Delivery'), field('full_term', 'No. of Full Term', 'number'),
        field('premature', 'No. of Premature', 'number'), field('abortion', 'No. of Abortion', 'number'),
        field('living_children', 'Living Children', 'number'), field('pre_eclampsia', 'Pre-eclampsia', 'radio', yesNo)
      ] }
    ]
  },
  child: {
    key: 'child',
    title: 'Child Record',
    tableName: 'ChildRecord',
    demographics: [
      field('name', 'Name', 'resident', 'full_name'), field('age', 'Age', 'resident', 'age'),
      field('sex', 'Gender', 'resident', 'sex'), field('family_serial_number', 'Family Serial Number', 'resident', 'household_no'),
      field('address', 'Address', 'resident', 'address'), field('birthdate', 'Date of Birth', 'resident', 'birthdate'),
      field('nhts_number', 'NHTS#'), field('religion', 'Religion'), field('birthplace', 'Birthplace'),
      field('philhealth_number', 'PhilHealth #', 'resident', 'philhealth_id_no'), field('philhealth_category', 'PhilHealth Category'),
      field('birth_weight_kg', 'Birth Weight (kg)', 'number'), field('school_name', 'School'), field('grade_level', 'Grade Level'),
      field('parent_first_name', "Parent/Guardian's First Name"), field('parent_middle_name', "Parent/Guardian's Middle Name"),
      field('parent_last_name', "Parent/Guardian's Last Name"), field('parent_guardian_relationship', 'Relationship')
    ],
    sections: [
      { title: 'Visit Details', column: 'left', fields: [
        field('visit_date', 'Date', 'date'), field('visit_time', 'Time', 'time'),
        field('history_of_present_illness', 'S: History of Present Illness', 'textarea'),
        field('blood_pressure', 'Blood pressure (BP)'), field('pulse_rate', 'Pulse rate (PR/CR)'), field('temperature', 'Temperature', 'number'),
        field('weight_kg', 'Weight', 'number'), field('respiratory_rate', 'Respiratory rate (RR)'), field('height_cm', 'Height', 'number'),
        field('findings', 'Findings', 'textarea'), field('assessment', 'A: Assessment', 'textarea'), field('plan', 'P: Plan', 'textarea')
      ] },
      { title: 'Medical History', column: 'right', fields: [
        field('hospitalization_history', 'History of hospitalization', 'textarea'),
        field('medication_allergies', 'Allergy to meds', 'textarea'), field('food_allergies', 'Allergy to food', 'textarea'),
        field('family_medical_history', 'FMH (DM, BA, HPN, CA, etc.)', 'checkboxes', familyHealthOptions),
        field('birth_and_immunization_history', 'Birth and Immunization History', 'textarea')
      ] }
    ]
  },
  maternal: {
    key: 'maternal',
    title: 'Maternal Record',
    tableName: 'MaternalRecord',
    demographics: [
      field('family_serial_number', 'Family Serial Number', 'resident', 'household_no'), field('age', 'Age', 'resident', 'age'),
      field('sex', 'Gender', 'resident', 'sex'), field('first_name', 'First Name', 'resident', 'first_name'),
      field('middle_name', 'Middle Name', 'resident', 'middle_name'), field('last_name', 'Last Name', 'resident', 'last_name'),
      field('address', 'Address', 'resident', 'address'), field('birthdate', 'Date of Birth', 'resident', 'birthdate'),
      field('nhts_number', 'NHTS#'), field('civil_status', 'Civil Status', 'resident', 'civil_status'),
      field('birthplace', 'Birthplace'), field('philhealth_number', 'PhilHealth #', 'resident', 'philhealth_id_no'),
      field('religion', 'Religion'), field('educational_attainment', 'Educational Attainment'),
      field('philhealth_category', 'PhilHealth Category'), field('philhealth_type', 'Type', 'checkboxes', [{ value: 'Member', label: 'Member' }, { value: 'Dependent', label: 'Dependent' }]),
      field('spouse_name', 'Spouse Name'), field('occupation', 'Occupation', 'resident', 'occupation'),
      field('contact_number', 'Contact #', 'resident', 'contact_no')
    ],
    sections: [
      { title: 'Visit Details', column: 'left', fields: [
        field('visit_date', 'Date', 'date'), field('visit_time', 'Time', 'time'),
        field('gravida', 'Gravida (G)', 'number'), field('para', 'Parity (P)', 'number'), field('abortion', 'Abortion (A)', 'number'),
        field('lmp', 'Last menstrual period (LMP)', 'date'), field('edc', 'EDC', 'date'), field('aog', 'Age of gestation (AOG)'),
        field('blood_pressure', 'BP (mmHg)'), field('temperature', 'Temp (°C)', 'number'), field('weight_kg', 'Wt (kg)', 'number'),
        field('pulse_rate', 'PR (bpm)'), field('respiratory_rate', 'RR (bpm)'), field('height_cm', 'Ht (cm)', 'number'),
        field('fht_cm', 'Fundal height (FHT)', 'number'), field('fhb_bpm', 'Fetal heart beat (FHB)', 'number'),
        field('presentation', 'Presentation (PRES)', 'select', ['Cephalic', 'Breech', 'Transverse'].map((value) => ({ value, label: value }))),
        field('muac_cm', 'Mid-upper arm circumference (MUAC)', 'number'), field('tt_status', 'Tetanus toxoid status (TT)', 'textarea')
      ] },
      { title: 'Medical and Past History', column: 'right', fields: [
        field('pmh_history', 'Past Medical History', 'checkboxes', maternalHistoryOptions),
        field('maintenance_medications', 'Maintenance Meds', 'textarea'),
        field('hospitalization_history', 'History of hospitalization', 'textarea'),
        field('medication_allergies', 'Allergy to meds', 'textarea'), field('food_allergies', 'Allergy to foods', 'textarea'),
        field('fmh_history', 'Family Medical History', 'checkboxes', maternalHistoryOptions)
      ] }
    ]
  },
  immunization: {
    key: 'immunization',
    title: 'Immunization Record',
    tableName: 'ImmunizationRecord',
    demographics: [
      field('name', 'Name', 'resident', 'full_name'), field('age', 'Age', 'resident', 'age'),
      field('sex', 'Gender', 'resident', 'sex'), field('family_serial_number', 'Family Serial Number', 'resident', 'household_no'),
      field('birthdate', 'Date of Birth', 'resident', 'birthdate'), field('time_of_birth', 'Time of Birth', 'time'),
      field('address', 'Address', 'resident', 'address'), field('religion', 'Religion'), field('birthplace', 'Birthplace'),
      field('nhts_number', 'NHTS#'), field('philhealth_category', 'PhilHealth Category'),
      field('birth_weight_kg', 'Birth Weight', 'number'), field('philhealth_number', 'PhilHealth #', 'resident', 'philhealth_id_no')
    ],
    sections: [
      { title: 'Parent Information', fields: [
        field('mother_name', "Mother's Name"), field('mother_birthdate', "Mother's Birth date", 'date'),
        field('mother_educational_attainment', "Mother's Educational Attainment"),
        field('father_name', "Father's Name"), field('father_birthdate', "Father's Birth date", 'date'),
        field('father_educational_attainment', "Father's Educational Attainment")
      ] },
      { title: 'Growth and Vital Signs', fields: [
        field('growth_rows', 'Growth records', 'table', { columns: [
          { name: 'date', label: 'Date', type: 'date' }, { name: 'age', label: 'Age', type: 'number' },
          { name: 'weight', label: 'Weight (kg)', type: 'number' }, { name: 'height', label: 'Height (cm)', type: 'number' },
          { name: 'muac', label: 'MUAC (cm)', type: 'number' }, { name: 'temperature', label: 'Temperature (°C)', type: 'number' }, { name: 'remarks', label: 'Remarks' }
        ], addLabel: 'Add Row' })
      ] },
      { title: 'Immunization Details', fields: [
        field('newborn_screening_date', 'Date of Newborn Screening', 'date'),
        field('hearing_screening_date', 'Date of Hearing Screening', 'date'),
        field('vitamin_k_date', 'Vit. K', 'date'), field('bcg_date', 'BCG', 'date'),
        field('hepa_b1_within_24_hours_date', 'Hepatitis B dose 1 (within 24 hours)', 'date'),
        field('hepa_b1_after_24_hours_date', 'Hepatitis B dose 1 (after 24 hours)', 'date'),
        field('mcvo_date', 'MCVO', 'date'), field('measles_date', 'Measles', 'date'),
        field('mmr_date', 'MMR', 'date'), field('vitamin_a_first_dose_date', 'Vitamin A first dose (6-11 months)', 'date'),
        field('vitamin_a_second_dose_date', 'Vitamin A second dose (12-15 months)', 'date'),
        field('vaccine_rows', 'Vaccine doses', 'table', { columns: [
          { name: 'dose', label: 'Dose', type: 'readonly' },
          { name: 'penta_hib', label: 'PENTA Hib', type: 'date' },
          { name: 'opv_ipv', label: 'OPV/IPV', type: 'date' },
          { name: 'pcv_1_3', label: 'PCV 1-3', type: 'date' }
        ], fixedRows: [1, 2, 3] })
      ] }
    ]
  }
};
