ALTER TABLE campaigns.paid_designs
  ADD COLUMN IF NOT EXISTS recovery_checks integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_recovery_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS recovery_reason text;
INSERT INTO campaigns.migrations(version) VALUES (29) ON CONFLICT DO NOTHING;