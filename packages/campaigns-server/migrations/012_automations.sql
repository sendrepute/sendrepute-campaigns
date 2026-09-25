CREATE TABLE IF NOT EXISTS campaigns.automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS campaigns.automation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  type text NOT NULL,
  subscriber_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS campaigns.automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL REFERENCES campaigns.automations(id),
  event_id uuid NOT NULL REFERENCES campaigns.automation_events(id),
  subscriber_id uuid NOT NULL,
  definition jsonb NOT NULL,
  state text NOT NULL DEFAULT 'running' CHECK(state IN ('running','completed','skipped','cancelled','failed','unknown')),
  step integer NOT NULL DEFAULT 0,
  due_at timestamptz NOT NULL DEFAULT now(),
  job_id uuid REFERENCES campaigns.jobs(id),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(automation_id,event_id)
);
CREATE INDEX IF NOT EXISTS automation_runs_due ON campaigns.automation_runs(due_at) WHERE state='running';
ALTER TABLE campaigns.jobs ADD COLUMN IF NOT EXISTS automation_run_id uuid REFERENCES campaigns.automation_runs(id);
ALTER TABLE campaigns.jobs ADD COLUMN IF NOT EXISTS automation_step integer;
CREATE UNIQUE INDEX IF NOT EXISTS automation_job_step ON campaigns.jobs(automation_run_id,automation_step) WHERE automation_run_id IS NOT NULL;

CREATE OR REPLACE FUNCTION campaigns.automation_cancellation_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.automation_run_id IS NOT NULL AND OLD.state='queued' AND NEW.state='cancelled' THEN
    INSERT INTO campaigns.delivery_events(id,job_id,recipient_id,event_type,source,metadata,occurred_at)
    VALUES(gen_random_uuid(),NEW.id,NEW.recipient_id,'cancelled','system',
      jsonb_build_object('automationRunId',NEW.automation_run_id,'step',NEW.automation_step),now());
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER automation_cancellation_event AFTER UPDATE ON campaigns.jobs
FOR EACH ROW EXECUTE FUNCTION campaigns.automation_cancellation_event();

CREATE OR REPLACE FUNCTION campaigns.enroll_automation_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO campaigns.automation_runs(automation_id,event_id,subscriber_id,definition)
  SELECT a.id,NEW.id,NEW.subscriber_id,a.body
  FROM campaigns.automations a JOIN campaigns.entities s ON s.kind='subscribers' AND s.id=NEW.subscriber_id
  WHERE a.status='active' AND a.body->'trigger'->>'type'=NEW.type
    AND s.body->>'status'='subscribed'
    AND jsonb_array_length(s.body->'listIds')>0
    AND (s.body->'listIds') <@ (a.body->'listIds')
    AND (a.body->'trigger'->>'tag' IS NULL OR a.body->'trigger'->>'tag'=NEW.payload->>'tag')
    AND (a.body->'trigger'->>'listId' IS NULL OR a.body->'trigger'->>'listId'=NEW.payload->>'listId')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER automation_event_enroll AFTER INSERT ON campaigns.automation_events
FOR EACH ROW EXECUTE FUNCTION campaigns.enroll_automation_event();

CREATE OR REPLACE FUNCTION campaigns.subscriber_automation_events() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous jsonb := '{}'; item text; event_prefix text;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.kind <> 'subscribers' OR current_setting('campaigns.restoring',true)='true' THEN RETURN OLD; END IF;
    PERFORM pg_advisory_xact_lock(731946215);
    UPDATE campaigns.jobs SET state='cancelled',revision=revision+1,updated_at=now()
      WHERE recipient_id=OLD.id AND automation_run_id IS NOT NULL AND state='queued';
    UPDATE campaigns.automation_runs SET state='cancelled',error='recipient_deleted',updated_at=now()
      WHERE subscriber_id=OLD.id AND state='running';
    RETURN OLD;
  END IF;
  IF NEW.kind <> 'subscribers' OR current_setting('campaigns.restoring',true)='true' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(731946215);
  IF TG_OP='UPDATE' THEN previous := OLD.body; END IF;
  event_prefix := 'native:'||gen_random_uuid()::text;
  IF TG_OP='INSERT' THEN
    INSERT INTO campaigns.automation_events(key,type,subscriber_id) VALUES(event_prefix||':created','subscriber.created',NEW.id);
  END IF;
  IF NEW.body->>'status'='subscribed' AND previous->>'status' IS DISTINCT FROM 'subscribed' THEN
    INSERT INTO campaigns.automation_events(key,type,subscriber_id) VALUES(event_prefix||':subscribed','subscriber.subscribed',NEW.id);
  END IF;
  FOR item IN SELECT jsonb_array_elements_text(coalesce(NEW.body->'tags','[]')) EXCEPT SELECT jsonb_array_elements_text(coalesce(previous->'tags','[]')) LOOP
    INSERT INTO campaigns.automation_events(key,type,subscriber_id,payload) VALUES(event_prefix||':tag:'||item,'tag.added',NEW.id,jsonb_build_object('tag',item));
  END LOOP;
  FOR item IN SELECT jsonb_array_elements_text(coalesce(NEW.body->'listIds','[]')) EXCEPT SELECT jsonb_array_elements_text(coalesce(previous->'listIds','[]')) LOOP
    INSERT INTO campaigns.automation_events(key,type,subscriber_id,payload) VALUES(event_prefix||':list:'||item,'list.joined',NEW.id,jsonb_build_object('listId',item));
  END LOOP;
  IF NEW.body->>'status' IS DISTINCT FROM 'subscribed' THEN
    UPDATE campaigns.jobs SET state='cancelled',revision=revision+1,updated_at=now()
      WHERE recipient_id=NEW.id AND automation_run_id IS NOT NULL AND state='queued';
    UPDATE campaigns.automation_runs SET state='cancelled',error='recipient_suppressed',updated_at=now()
      WHERE subscriber_id=NEW.id AND state='running';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER subscriber_automation_events AFTER INSERT OR UPDATE OR DELETE ON campaigns.entities
FOR EACH ROW EXECUTE FUNCTION campaigns.subscriber_automation_events();
INSERT INTO campaigns.migrations(version) VALUES(12) ON CONFLICT DO NOTHING;