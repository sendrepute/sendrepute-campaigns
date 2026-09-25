CREATE TABLE IF NOT EXISTS campaigns.automation_date_schedules (
  automation_id uuid PRIMARY KEY REFERENCES campaigns.automations(id) ON DELETE CASCADE,
  trigger jsonb NOT NULL,
  last_scanned_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns.automation_date_occurrences (
  automation_id uuid NOT NULL REFERENCES campaigns.automations(id) ON DELETE CASCADE,
  subscriber_id uuid NOT NULL,
  occurrence_key text NOT NULL,
  event_id uuid NOT NULL REFERENCES campaigns.automation_events(id),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (automation_id, subscriber_id, occurrence_key)
);
CREATE INDEX IF NOT EXISTS automation_date_occurrences_event
  ON campaigns.automation_date_occurrences(event_id);

-- Date events are targeted at the automation that materialized them. Without
-- this predicate, two automations of the same date trigger type would enroll
-- each other's subscribers.
CREATE OR REPLACE FUNCTION campaigns.enroll_automation_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO campaigns.automation_runs(automation_id,event_id,subscriber_id,definition)
  SELECT a.id,NEW.id,NEW.subscriber_id,a.body
  FROM campaigns.automations a JOIN campaigns.entities s ON s.kind='subscribers' AND s.id=NEW.subscriber_id
  WHERE a.status='active' AND a.body->'trigger'->>'type'=NEW.type
    AND (NEW.type NOT IN ('date.once','date.annual') OR a.id::text=NEW.payload->>'automationId')
    AND s.body->>'status'='subscribed'
    AND jsonb_array_length(s.body->'listIds')>0
    AND (s.body->'listIds') <@ (a.body->'listIds')
    AND (a.body->'trigger'->>'tag' IS NULL OR a.body->'trigger'->>'tag'=NEW.payload->>'tag')
    AND (a.body->'trigger'->>'listId' IS NULL OR a.body->'trigger'->>'listId'=NEW.payload->>'listId')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

INSERT INTO campaigns.migrations(version) VALUES (20) ON CONFLICT DO NOTHING;