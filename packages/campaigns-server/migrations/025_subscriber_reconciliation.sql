-- Also installed by the offline reconciliation utility BEFORE migration 024.
-- Keep 024's live identity constraint and index unchanged.
ALTER TABLE campaigns.entities DROP CONSTRAINT IF EXISTS entities_kind_check;
ALTER TABLE campaigns.entities ADD CONSTRAINT entities_kind_check
  CHECK (kind IN ('lists','subscribers','campaigns','providers','templates','subscriber_aliases'));

CREATE TABLE IF NOT EXISTS campaigns.subscriber_reconciliations (
  subscriber_id uuid PRIMARY KEY,
  canonical_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  original_entity jsonb NOT NULL,
  operator_ref text NOT NULL CHECK (length(btrim(operator_ref)) > 0),
  decision_ref text NOT NULL CHECK (length(btrim(decision_ref)) > 0),
  full_backup_ref text NOT NULL CHECK (length(btrim(full_backup_ref)) > 0),
  reconciled_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION campaigns.reconciled_subscriber_id(value uuid)
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT canonical_id FROM campaigns.subscriber_reconciliations
                    WHERE subscriber_id=value), value)
$$;

CREATE OR REPLACE FUNCTION campaigns.guard_subscriber_reconciliation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE member campaigns.subscriber_reconciliations;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (SELECT 1 FROM campaigns.subscriber_reconciliations) THEN
      RAISE EXCEPTION 'Reconciled identities require full database recovery; truncate is forbidden';
    END IF;
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME = 'subscriber_reconciliations' THEN
    RAISE EXCEPTION 'Subscriber reconciliation evidence is immutable';
  END IF;
  SELECT * INTO member FROM campaigns.subscriber_reconciliations
    WHERE subscriber_id=CASE WHEN TG_OP IN ('DELETE','UPDATE') THEN OLD.id ELSE NEW.id END;
  IF NOT FOUND THEN
    IF TG_OP <> 'DELETE' AND NEW.kind='subscriber_aliases' THEN
      RAISE EXCEPTION 'Subscriber alias requires reconciliation evidence';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Reconciled subscriber IDs cannot be deleted or restored over';
  END IF;
  IF TG_OP='UPDATE' AND NEW.id <> OLD.id THEN
    RAISE EXCEPTION 'Reconciled subscriber ID is immutable';
  END IF;
  IF member.subscriber_id <> member.canonical_id THEN
    IF NEW.kind <> 'subscriber_aliases' OR NEW.body IS DISTINCT FROM member.original_entity->'body' THEN
      RAISE EXCEPTION 'Archived subscriber identity and evidence are immutable';
    END IF;
  ELSE
    IF NEW.kind <> 'subscribers'
       OR NEW.body->>'scope' IS DISTINCT FROM member.original_entity->'body'->>'scope'
       OR NEW.body->>'email' IS DISTINCT FROM member.original_entity->'body'->>'email'
       OR coalesce(NEW.body->>'status','') NOT IN ('unsubscribed','bounced','complained')
       OR NEW.body->'confirmedAt' IS DISTINCT FROM member.original_entity->'body'->'confirmedAt'
    THEN RAISE EXCEPTION 'Reconciled identity is held non-sendable; consent and identity cannot change';
    END IF;
    IF EXISTS (
      SELECT 1 FROM campaigns.subscriber_reconciliations r,
        LATERAL jsonb_array_elements(coalesce(r.original_entity->'body'->'listIds','[]')) l
      WHERE r.canonical_id=member.canonical_id AND NOT coalesce(NEW.body->'listIds' @> jsonb_build_array(l.value),false)
    ) THEN RAISE EXCEPTION 'Reconciled memberships cannot be lost'; END IF;
    -- Never weaken a stronger suppression in a later unsubscribe callback.
    IF TG_OP='UPDATE' AND (OLD.body->>'status'='complained'
       OR (OLD.body->>'status'='bounced' AND NEW.body->>'status'<>'complained')) THEN
      NEW.body=jsonb_set(NEW.body,'{status}',OLD.body->'status');
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS subscriber_reconciliation_entity_guard ON campaigns.entities;
CREATE TRIGGER subscriber_reconciliation_entity_guard
BEFORE INSERT OR UPDATE OR DELETE ON campaigns.entities
FOR EACH ROW EXECUTE FUNCTION campaigns.guard_subscriber_reconciliation();
DROP TRIGGER IF EXISTS subscriber_reconciliation_truncate_guard ON campaigns.entities;
CREATE TRIGGER subscriber_reconciliation_truncate_guard BEFORE TRUNCATE ON campaigns.entities
FOR EACH STATEMENT EXECUTE FUNCTION campaigns.guard_subscriber_reconciliation();
DROP TRIGGER IF EXISTS subscriber_reconciliation_evidence_guard ON campaigns.subscriber_reconciliations;
CREATE TRIGGER subscriber_reconciliation_evidence_guard BEFORE UPDATE OR DELETE OR TRUNCATE
ON campaigns.subscriber_reconciliations FOR EACH STATEMENT EXECUTE FUNCTION campaigns.guard_subscriber_reconciliation();

-- Deferred: evidence and kind transitions are made in one transaction. Also
-- prevents direct SQL from committing dangling evidence or live duplicates.
CREATE OR REPLACE FUNCTION campaigns.validate_subscriber_reconciliation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM campaigns.subscriber_reconciliations r
    LEFT JOIN campaigns.entities e ON e.id=r.subscriber_id
      AND e.kind=CASE WHEN r.subscriber_id=r.canonical_id THEN 'subscribers' ELSE 'subscriber_aliases' END
    LEFT JOIN campaigns.subscriber_reconciliations c ON c.subscriber_id=r.canonical_id AND c.canonical_id=r.canonical_id
    WHERE e.id IS NULL OR c.subscriber_id IS NULL
      OR r.original_entity->'body'->>'scope' IS DISTINCT FROM c.original_entity->'body'->>'scope'
      OR lower(btrim(r.original_entity->'body'->>'email')) IS DISTINCT FROM lower(btrim(c.original_entity->'body'->>'email'))
      OR EXISTS (SELECT 1 FROM campaigns.entities s WHERE s.kind='subscribers'
        AND s.id<>r.canonical_id
        AND s.body->>'scope'=r.original_entity->'body'->>'scope'
        AND lower(btrim(s.body->>'email'))=lower(btrim(r.original_entity->'body'->>'email')))
  ) THEN RAISE EXCEPTION 'Incomplete or inconsistent subscriber reconciliation'; END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS subscriber_reconciliation_consistency ON campaigns.subscriber_reconciliations;
CREATE CONSTRAINT TRIGGER subscriber_reconciliation_consistency
AFTER INSERT ON campaigns.subscriber_reconciliations DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION campaigns.validate_subscriber_reconciliation();
DROP TRIGGER IF EXISTS subscriber_reconciliation_entity_consistency ON campaigns.entities;
CREATE CONSTRAINT TRIGGER subscriber_reconciliation_entity_consistency
AFTER INSERT OR UPDATE ON campaigns.entities DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION campaigns.validate_subscriber_reconciliation();

INSERT INTO campaigns.migrations(version) VALUES (25) ON CONFLICT DO NOTHING;