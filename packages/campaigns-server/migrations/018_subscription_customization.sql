CREATE TABLE IF NOT EXISTS campaigns.subscription_customizations (
  list_id uuid PRIMARY KEY,
  brand_scope text NOT NULL,
  page_content jsonb NOT NULL DEFAULT '{}',
  form_config jsonb NOT NULL DEFAULT '{}',
  opt_in_mode text CHECK (opt_in_mode IS NULL OR opt_in_mode IN ('single','double')),
  welcome_enabled boolean NOT NULL DEFAULT false,
  welcome_template_id uuid,
  welcome_provider_id uuid,
  goodbye_enabled boolean NOT NULL DEFAULT false,
  goodbye_template_id uuid,
  goodbye_provider_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT welcome_enabled OR (welcome_template_id IS NOT NULL AND welcome_provider_id IS NOT NULL)),
  CHECK (NOT goodbye_enabled OR (goodbye_template_id IS NOT NULL AND goodbye_provider_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS campaigns.subscription_mail_events (
  id uuid PRIMARY KEY,
  list_id uuid NOT NULL,
  subscriber_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('welcome','goodbye')),
  consent_epoch text NOT NULL CHECK (length(consent_epoch) BETWEEN 1 AND 200),
  state text NOT NULL CHECK (state IN ('pending','queued','failed')),
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  queued_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(list_id,subscriber_id,event_type,consent_epoch)
);

CREATE INDEX IF NOT EXISTS subscription_mail_events_subscriber
  ON campaigns.subscription_mail_events(subscriber_id,created_at DESC);

INSERT INTO campaigns.migrations(version) VALUES (18) ON CONFLICT DO NOTHING;