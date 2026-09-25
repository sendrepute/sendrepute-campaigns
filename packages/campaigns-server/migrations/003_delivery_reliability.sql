CREATE TABLE IF NOT EXISTS campaigns.delivery_events (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES campaigns.jobs(id) ON DELETE RESTRICT,
  campaign_id uuid,
  recipient_id uuid,
  event_type text NOT NULL CHECK (event_type IN (
    'worker_attempt','accepted','rejected','unknown','retry_scheduled',
    'cancelled','provider_delivered','provider_opened','provider_clicked',
    'provider_bounced','provider_complained','provider_unsubscribed',
    'reconciled_accepted','reconciled_rejected','explicit_retry'
  )),
  source text NOT NULL CHECK (source IN ('worker','provider','operator','system')),
  attempt integer,
  provider_message_id text,
  provider_event_key text,
  error_code text,
  metadata jsonb NOT NULL DEFAULT '{}',
  actor_id uuid,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (attempt IS NULL OR attempt > 0)
);
CREATE INDEX IF NOT EXISTS delivery_events_job_time
  ON campaigns.delivery_events(job_id,occurred_at,id);
CREATE INDEX IF NOT EXISTS delivery_events_campaign_type
  ON campaigns.delivery_events(campaign_id,event_type,occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_events_provider_dedupe
  ON campaigns.delivery_events(source,provider_event_key)
  WHERE source='provider' AND provider_event_key IS NOT NULL;

ALTER TABLE campaigns.jobs ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE campaigns.jobs ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3;
ALTER TABLE campaigns.jobs ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
ALTER TABLE campaigns.jobs ADD COLUMN IF NOT EXISTS last_error_code text;
ALTER TABLE campaigns.jobs ADD COLUMN IF NOT EXISTS last_error_message text;
ALTER TABLE campaigns.jobs ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE campaigns.jobs ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE campaigns.jobs ADD CONSTRAINT jobs_attempt_bounds
    CHECK (attempt_count >= 0 AND max_attempts BETWEEN 1 AND 10);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS jobs_delivery_ready
  ON campaigns.jobs(state,run_at) WHERE state='queued';

CREATE OR REPLACE FUNCTION campaigns.delivery_events_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'delivery events are immutable';
END $$;
DROP TRIGGER IF EXISTS delivery_events_no_update ON campaigns.delivery_events;
CREATE TRIGGER delivery_events_no_update
  BEFORE UPDATE OR DELETE ON campaigns.delivery_events
  FOR EACH ROW EXECUTE FUNCTION campaigns.delivery_events_immutable();

UPDATE campaigns.roles
SET body=jsonb_set(
      body,'{permissions}',
      coalesce(body->'permissions','[]'::jsonb) || '["delivery:reconcile","delivery:retry"]'::jsonb
    ),
    updated_at=now()
WHERE system=true
  AND lower(body->>'name') IN ('admin','manager')
  AND NOT coalesce(body->'permissions','[]'::jsonb) ?& ARRAY['delivery:reconcile','delivery:retry'];

INSERT INTO campaigns.migrations(version) VALUES (3) ON CONFLICT DO NOTHING;