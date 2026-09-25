CREATE TABLE IF NOT EXISTS campaigns.experiments (
 id uuid PRIMARY KEY,
 campaign_id uuid NOT NULL UNIQUE,
 body jsonb NOT NULL,
 frozen jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS campaigns.experiment_audience (
 experiment_id uuid NOT NULL REFERENCES campaigns.experiments(id),
 recipient_id uuid NOT NULL,
 arm text NOT NULL CHECK(arm IN ('A','B','remainder')),
 snapshot jsonb NOT NULL,
 PRIMARY KEY(experiment_id,recipient_id)
);
CREATE OR REPLACE FUNCTION campaigns.experiment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='experiment_audience' THEN
   RAISE EXCEPTION 'Experiment audience is immutable';
 ELSIF TG_TABLE_NAME='experiments' THEN
   IF TG_OP='DELETE' OR NEW.frozen IS DISTINCT FROM OLD.frozen OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id THEN
     RAISE EXCEPTION 'Experiment snapshot is immutable';
   END IF;
 ELSIF TG_TABLE_NAME='entities' AND OLD.kind='campaigns' THEN
   IF EXISTS(SELECT 1 FROM campaigns.experiments WHERE campaign_id=OLD.id) THEN
     IF TG_OP='DELETE' OR
       (NEW.body - ARRAY['status','statistics','updatedAt']) IS DISTINCT FROM
       (OLD.body - ARRAY['status','statistics','updatedAt']) THEN
       RAISE EXCEPTION 'Experiment campaign is reserved';
     END IF;
   END IF;
 ELSIF TG_TABLE_NAME='jobs' THEN
   PERFORM 1 FROM campaigns.entities WHERE kind='campaigns' AND id=NEW.campaign_id FOR UPDATE;
   IF EXISTS(SELECT 1 FROM campaigns.experiments WHERE campaign_id=NEW.campaign_id) AND NOT EXISTS(
     SELECT 1 FROM campaigns.experiments e JOIN campaigns.experiment_audience a ON a.experiment_id=e.id
     WHERE e.campaign_id=NEW.campaign_id AND a.recipient_id=NEW.recipient_id
       AND NEW.kind='campaign' AND NEW.snapshot->>'experimentId'=e.id::text
       AND NEW.snapshot->>'experimentArm'=a.arm
       AND (a.arm IN ('A','B') OR e.body->>'status'='remainder_queued')
   ) THEN RAISE EXCEPTION 'Experiment campaign requires assigned delivery'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS experiment_frozen ON campaigns.experiments;
CREATE TRIGGER experiment_frozen BEFORE UPDATE OR DELETE ON campaigns.experiments FOR EACH ROW EXECUTE FUNCTION campaigns.experiment_guard();
DROP TRIGGER IF EXISTS experiment_audience_frozen ON campaigns.experiment_audience;
CREATE TRIGGER experiment_audience_frozen BEFORE UPDATE OR DELETE ON campaigns.experiment_audience FOR EACH ROW EXECUTE FUNCTION campaigns.experiment_guard();
DROP TRIGGER IF EXISTS experiment_campaign_guard ON campaigns.entities;
CREATE TRIGGER experiment_campaign_guard BEFORE UPDATE OR DELETE ON campaigns.entities FOR EACH ROW EXECUTE FUNCTION campaigns.experiment_guard();
DROP TRIGGER IF EXISTS experiment_job_guard ON campaigns.jobs;
CREATE TRIGGER experiment_job_guard BEFORE INSERT ON campaigns.jobs FOR EACH ROW EXECUTE FUNCTION campaigns.experiment_guard();
CREATE OR REPLACE FUNCTION campaigns.experiment_job_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.snapshot ? 'experimentId' AND (
   NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
   OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id OR NEW.kind IS DISTINCT FROM OLD.kind
 ) THEN RAISE EXCEPTION 'Experiment delivery attribution is immutable'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS experiment_job_frozen ON campaigns.jobs;
CREATE TRIGGER experiment_job_frozen BEFORE UPDATE ON campaigns.jobs FOR EACH ROW EXECUTE FUNCTION campaigns.experiment_job_immutable();
INSERT INTO campaigns.migrations(version) VALUES(12) ON CONFLICT DO NOTHING;