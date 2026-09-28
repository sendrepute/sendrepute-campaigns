ALTER TABLE campaigns.paid_designs
  ADD COLUMN IF NOT EXISTS central_account_id text,
  ADD COLUMN IF NOT EXISTS central_credential_id text,
  ADD COLUMN IF NOT EXISTS settlement jsonb;
INSERT INTO campaigns.migrations(version) VALUES (30) ON CONFLICT DO NOTHING;