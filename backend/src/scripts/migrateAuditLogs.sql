-- Add explicit actor/target and safe event metadata while preserving history.
DROP PROCEDURE IF EXISTS migrate_healthsync_audit_logs;
DELIMITER $$
CREATE PROCEDURE migrate_healthsync_audit_logs()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'audit_logs' AND column_name = 'ip_address') THEN
    ALTER TABLE audit_logs ADD COLUMN ip_address VARCHAR(45) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'audit_logs' AND column_name = 'user_agent') THEN
    ALTER TABLE audit_logs ADD COLUMN user_agent VARCHAR(255) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'audit_logs' AND column_name = 'actor_id') THEN
    ALTER TABLE audit_logs ADD COLUMN actor_id INT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'audit_logs' AND column_name = 'target_type') THEN
    ALTER TABLE audit_logs ADD COLUMN target_type VARCHAR(50) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'audit_logs' AND column_name = 'target_id') THEN
    ALTER TABLE audit_logs ADD COLUMN target_id VARCHAR(64) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'audit_logs' AND column_name = 'target_label') THEN
    ALTER TABLE audit_logs ADD COLUMN target_label VARCHAR(150) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'audit_logs' AND column_name = 'result') THEN
    ALTER TABLE audit_logs ADD COLUMN result ENUM('success','failure') NULL DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'audit_logs' AND column_name = 'severity') THEN
    ALTER TABLE audit_logs ADD COLUMN severity ENUM('info','warning','critical') NULL DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'audit_logs' AND column_name = 'metadata') THEN
    ALTER TABLE audit_logs ADD COLUMN metadata JSON NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'audit_logs'
      AND column_name = 'user_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE audit_logs MODIFY COLUMN user_id INT NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'audit_logs' AND index_name = 'idx_audit_created_at') THEN
    CREATE INDEX idx_audit_created_at ON audit_logs (created_at);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'audit_logs' AND index_name = 'idx_audit_user_created') THEN
    CREATE INDEX idx_audit_user_created ON audit_logs (user_id, created_at);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'audit_logs' AND index_name = 'idx_audit_actor_created') THEN
    CREATE INDEX idx_audit_actor_created ON audit_logs (actor_id, created_at);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'audit_logs' AND index_name = 'idx_audit_action_created') THEN
    CREATE INDEX idx_audit_action_created ON audit_logs (action, created_at);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'audit_logs' AND index_name = 'idx_audit_module_created') THEN
    CREATE INDEX idx_audit_module_created ON audit_logs (module, created_at);
  END IF;
END$$
DELIMITER ;

CALL migrate_healthsync_audit_logs();
DROP PROCEDURE migrate_healthsync_audit_logs;
