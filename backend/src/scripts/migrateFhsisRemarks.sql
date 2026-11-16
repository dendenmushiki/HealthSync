CREATE TABLE IF NOT EXISTS report_remarks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  report_period VARCHAR(64) NOT NULL,
  indicator_key VARCHAR(120) NOT NULL,
  remark VARCHAR(1000) NOT NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_report_remarks_period_indicator (report_period, indicator_key),
  KEY idx_report_remarks_updated_by (updated_by),
  CONSTRAINT fk_report_remarks_updated_by
    FOREIGN KEY (updated_by) REFERENCES users (user_id)
    ON DELETE SET NULL
);
