CREATE TABLE IF NOT EXISTS campaigns.insight_requests (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  campaign_id uuid NOT NULL,
  credential_hash text NOT NULL,
  metrics jsonb NOT NULL,
  locale text NOT NULL DEFAULT 'en',
  result jsonb,
  price integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO campaigns.migrations(version) VALUES (22) ON CONFLICT DO NOTHING;