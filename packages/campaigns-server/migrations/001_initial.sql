CREATE SCHEMA IF NOT EXISTS campaigns;
CREATE TABLE IF NOT EXISTS campaigns.migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS campaigns.installation (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  settings jsonb NOT NULL,
  connection_secret text NOT NULL,
  connection jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS campaigns.roles (
  id uuid PRIMARY KEY,
  body jsonb NOT NULL,
  system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS campaigns.users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS campaigns.sessions (
  id_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES campaigns.users(id) ON DELETE CASCADE,
  csrf_hash text NOT NULL,
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE campaigns.sessions ADD COLUMN IF NOT EXISTS csrf_token text;
CREATE TABLE IF NOT EXISTS campaigns.entities (
  kind text NOT NULL CHECK (kind IN ('lists','subscribers','campaigns','providers','templates')),
  id uuid NOT NULL,
  body jsonb NOT NULL,
  secret text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(kind,id)
);
CREATE INDEX IF NOT EXISTS entities_kind_updated ON campaigns.entities(kind,updated_at DESC);
CREATE TABLE IF NOT EXISTS campaigns.audit (
  id uuid PRIMARY KEY,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  actor_id uuid,
  actor jsonb,
  ip_address text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS campaigns.tokens (
  token_hash text PRIMARY KEY,
  purpose text NOT NULL CHECK (purpose IN ('unsubscribe','subscribe')),
  subscriber_id uuid,
  list_id uuid,
  email text,
  payload jsonb NOT NULL DEFAULT '{}',
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS campaigns.jobs (
  id uuid PRIMARY KEY,
  campaign_id uuid,
  recipient_id uuid,
  kind text NOT NULL,
  state text NOT NULL CHECK (state IN ('queued','sending','sent','rejected','unknown','cancelled')),
  run_at timestamptz NOT NULL,
  snapshot jsonb NOT NULL,
  provider_message_id text,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id,recipient_id,kind)
);
CREATE TABLE IF NOT EXISTS campaigns.rate_limits (
  provider_id uuid NOT NULL,
  bucket timestamptz NOT NULL,
  used integer NOT NULL DEFAULT 0,
  PRIMARY KEY(provider_id,bucket)
);
CREATE TABLE IF NOT EXISTS campaigns.login_attempts (
  fingerprint text PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  reset_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS campaigns.webhook_events (
  provider_id uuid NOT NULL,
  event_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider_id,event_key)
);
INSERT INTO campaigns.migrations(version) VALUES (1) ON CONFLICT DO NOTHING;

-- Add export capability only to the installation-created system roles. The
-- system flag prevents a custom role that happens to share one of these names
-- from being modified.
UPDATE campaigns.roles
SET body = jsonb_set(
      body,
      '{permissions}',
      coalesce(body->'permissions', '[]'::jsonb) || '["subscribers:export"]'::jsonb
    ),
    updated_at = now()
WHERE system = true
  AND lower(body->>'name') IN ('owner', 'admin', 'manager')
  AND NOT coalesce(body->'permissions', '[]'::jsonb) ? 'subscribers:export';

INSERT INTO campaigns.migrations(version) VALUES (2) ON CONFLICT DO NOTHING;