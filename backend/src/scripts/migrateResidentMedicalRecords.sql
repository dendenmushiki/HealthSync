CREATE TABLE IF NOT EXISTS patient_clinical_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  resident_id INT NOT NULL,
  record_data JSON NOT NULL,
  recorded_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_patient_clinical_resident (resident_id),
  CONSTRAINT fk_patient_clinical_resident FOREIGN KEY (resident_id) REFERENCES residents(resident_id) ON DELETE CASCADE,
  CONSTRAINT fk_patient_clinical_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS child_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  resident_id INT NOT NULL,
  record_data JSON NOT NULL,
  recorded_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_child_record_resident (resident_id),
  CONSTRAINT fk_child_record_resident FOREIGN KEY (resident_id) REFERENCES residents(resident_id) ON DELETE CASCADE,
  CONSTRAINT fk_child_record_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS maternal_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  resident_id INT NOT NULL,
  record_data JSON NOT NULL,
  edc DATE NULL,
  recorded_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_maternal_record_resident (resident_id),
  CONSTRAINT fk_maternal_record_resident FOREIGN KEY (resident_id) REFERENCES residents(resident_id) ON DELETE CASCADE,
  CONSTRAINT fk_maternal_record_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(user_id)
) ENGINE=InnoDB;

ALTER TABLE maternal_records
  ADD COLUMN IF NOT EXISTS edc DATE NULL AFTER record_data;

CREATE TABLE IF NOT EXISTS immunization_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  resident_id INT NOT NULL,
  record_data JSON NOT NULL,
  recorded_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_immunization_record_resident (resident_id),
  CONSTRAINT fk_immunization_record_resident FOREIGN KEY (resident_id) REFERENCES residents(resident_id) ON DELETE CASCADE,
  CONSTRAINT fk_immunization_record_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(user_id)
) ENGINE=InnoDB;
