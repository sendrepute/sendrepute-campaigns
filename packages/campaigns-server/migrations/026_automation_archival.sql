ALTER TABLE campaigns.automations ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS automations_visible_created ON campaigns.automations(created_at DESC, id DESC) WHERE archived_at IS NULL;
INSERT INTO campaigns.migrations(version) VALUES (26) ON CONFLICT DO NOTHING;