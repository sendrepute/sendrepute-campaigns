CREATE TABLE IF NOT EXISTS campaigns.provider_analytics_state (
  provider_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  track_opens boolean NOT NULL DEFAULT false,
  track_clicks boolean NOT NULL DEFAULT false,
  webhook_configured boolean NOT NULL DEFAULT false,
  cursor text,
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_error_kind text CHECK (last_error_kind IS NULL OR last_error_kind IN (
    'authentication','permission','rate_limited','unavailable','provider'
  )),
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(coalesce(cursor,'')) <= 8192),
  CHECK (length(coalesce(last_error,'')) <= 1000)
);

CREATE TABLE IF NOT EXISTS campaigns.provider_analytics_events (
  id uuid PRIMARY KEY,
  provider_id uuid NOT NULL,
  job_id uuid REFERENCES campaigns.jobs(id) ON DELETE SET NULL,
  campaign_id uuid,
  provider_message_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'delivered','opened','clicked','hard_bounce','soft_bounce','complained','unsubscribed'
  )),
  occurred_at timestamptz NOT NULL,
  recipient text,
  link text,
  canonical_fingerprint text NOT NULL CHECK (canonical_fingerprint ~ '^[0-9a-f]{64}$'),
  provider_event_key text NOT NULL,
  source text NOT NULL CHECK (source IN ('poll','webhook')),
  metadata jsonb NOT NULL DEFAULT '{}',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_id,provider_event_key)
);
CREATE INDEX IF NOT EXISTS provider_analytics_events_provider_time
  ON campaigns.provider_analytics_events(provider_id,occurred_at DESC,id);
CREATE INDEX IF NOT EXISTS provider_analytics_events_campaign_type
  ON campaigns.provider_analytics_events(campaign_id,event_type,occurred_at DESC);
CREATE INDEX IF NOT EXISTS provider_analytics_events_message
  ON campaigns.provider_analytics_events(provider_id,provider_message_id);

UPDATE campaigns.roles
SET body=jsonb_set(
      body,'{permissions}',
      coalesce(body->'permissions','[]'::jsonb) || '["provider-analytics:manage"]'::jsonb
    ),
    updated_at=now()
WHERE system=true
  AND lower(body->>'name') IN ('owner','admin')
  AND NOT coalesce(body->'permissions','[]'::jsonb) ? 'provider-analytics:manage';

INSERT INTO campaigns.migrations(version) VALUES (21) ON CONFLICT DO NOTHING;