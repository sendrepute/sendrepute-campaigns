CREATE TABLE IF NOT EXISTS campaigns.telegram_notification_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  encrypted_bot_token text,
  encrypted_chat_id text,
  event_types text[] NOT NULL DEFAULT ARRAY['started','completed','failed']::text[],
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (event_types <@ ARRAY['started','completed','failed','opened','clicked']::text[])
);

CREATE TABLE IF NOT EXISTS campaigns.notification_outbox (
  id uuid PRIMARY KEY,
  channel text NOT NULL CHECK (channel='telegram'),
  dedupe_key text NOT NULL,
  campaign_id uuid,
  event_type text NOT NULL CHECK (event_type IN ('started','completed','failed','opened','clicked','engagement_summary','test')),
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','delivered','failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  delivered_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(channel,dedupe_key)
);
CREATE INDEX IF NOT EXISTS notification_outbox_ready
  ON campaigns.notification_outbox(state,available_at)
  WHERE state IN ('pending','sending');

INSERT INTO campaigns.migrations(version) VALUES (13) ON CONFLICT DO NOTHING;