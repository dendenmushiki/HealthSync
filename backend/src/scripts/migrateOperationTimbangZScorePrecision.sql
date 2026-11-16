-- Apply only after confirming the current schema and taking a database backup.
-- Existing nullable DECIMAL(5,2) values are preserved; previously discarded
-- fractional precision cannot be recovered by widening these columns.
ALTER TABLE operation_timbang_assessments
  MODIFY COLUMN wfa_zscore DECIMAL(8,5) NULL,
  MODIFY COLUMN hfa_zscore DECIMAL(8,5) NULL,
  MODIFY COLUMN wflh_zscore DECIMAL(8,5) NULL;
