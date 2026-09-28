-- Legacy duplicate names remain untouched. Only new names/renames must be unique.
-- A transaction-level advisory lock serializes concurrent provider mutations,
-- including writes outside the HTTP router (e.g. import or restore).
CREATE INDEX IF NOT EXISTS entities_provider_name_lookup_idx
  ON campaigns.entities (lower(btrim(body->>'name')))
  WHERE kind='providers';

CREATE OR REPLACE FUNCTION campaigns.enforce_provider_name_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE normalized text;
BEGIN
  IF NEW.kind <> 'providers' THEN RETURN NEW; END IF;
  normalized := lower(btrim(NEW.body->>'name'));
  IF normalized IS NULL OR normalized = '' THEN
    RAISE EXCEPTION 'Provider name is required' USING ERRCODE='23514', CONSTRAINT='provider_name_required';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.kind = 'providers'
    AND normalized = lower(btrim(OLD.body->>'name')) THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('campaigns:provider-name-identity',0));
  IF EXISTS (
    SELECT 1 FROM campaigns.entities
    WHERE kind='providers' AND id<>NEW.id AND lower(btrim(body->>'name'))=normalized
  ) THEN
    RAISE EXCEPTION 'Provider name already exists'
      USING ERRCODE='23505', CONSTRAINT='provider_name_identity';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS entities_provider_name_identity ON campaigns.entities;
CREATE TRIGGER entities_provider_name_identity
BEFORE INSERT OR UPDATE OF kind,body ON campaigns.entities
FOR EACH ROW EXECUTE FUNCTION campaigns.enforce_provider_name_identity();

INSERT INTO campaigns.migrations(version) VALUES (31) ON CONFLICT DO NOTHING;