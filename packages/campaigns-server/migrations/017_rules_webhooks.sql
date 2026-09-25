CREATE TABLE IF NOT EXISTS campaigns.event_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  enabled boolean NOT NULL DEFAULT true,
  trigger_type text NOT NULL CHECK (trigger_type IN (
    'campaign.scheduled','campaign.sending','campaign.sent','automation.sent','list.joined'
  )),
  trigger_list_id uuid,
  action_type text NOT NULL CHECK (action_type IN ('webhook','unsubscribe','email_notification')),
  action_config jsonb NOT NULL,
  encrypted_secret text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((action_type='webhook') = (encrypted_secret IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS event_rules_trigger
  ON campaigns.event_rules(trigger_type,trigger_list_id) WHERE enabled;

CREATE TABLE IF NOT EXISTS campaigns.rule_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL,
  source_event_id text NOT NULL CHECK (length(source_event_id) BETWEEN 1 AND 200),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('webhook','unsubscribe','email_notification')),
  action_config jsonb NOT NULL,
  encrypted_secret text,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','delivered','failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  delivered_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(rule_id,event_type,source_event_id)
);
CREATE INDEX IF NOT EXISTS rule_outbox_ready
  ON campaigns.rule_outbox(state,available_at,created_at)
  WHERE state IN ('pending','sending');

INSERT INTO campaigns.migrations(version) VALUES (17) ON CONFLICT DO NOTHING;