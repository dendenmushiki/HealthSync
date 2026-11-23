ALTER TABLE maternal_records
  ADD COLUMN IF NOT EXISTS edc DATE NULL AFTER record_data;
