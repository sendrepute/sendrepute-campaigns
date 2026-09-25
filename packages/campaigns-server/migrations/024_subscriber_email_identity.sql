-- The runner wraps all migrations in one transaction under its migration and
-- delivery locks. Do not repair identities here: subscribers may own consent,
-- suppression, jobs, automation runs, and immutable delivery history.
-- Direct SQL execution must also run inside an explicit transaction: without
-- one this lock fails instead of allowing a racy preflight.
LOCK TABLE campaigns.entities IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  missing_scope bigint;
  missing_email bigint;
  duplicate_groups bigint;
BEGIN
  SELECT count(*) FILTER (WHERE NOT coalesce(
           jsonb_typeof(body->'scope') = 'string'
           AND length(btrim(body->>'scope')) > 0, false)),
         count(*) FILTER (WHERE NOT coalesce(
           jsonb_typeof(body->'email') = 'string'
           AND length(btrim(body->>'email')) > 0, false))
    INTO missing_scope, missing_email
    FROM campaigns.entities
   WHERE kind = 'subscribers';

  SELECT count(*) INTO duplicate_groups
    FROM (
      SELECT body->>'scope', lower(btrim(body->>'email'))
        FROM campaigns.entities
       WHERE kind = 'subscribers'
         AND jsonb_typeof(body->'scope') = 'string'
         AND length(btrim(body->>'scope')) > 0
         AND jsonb_typeof(body->'email') = 'string'
         AND length(btrim(body->>'email')) > 0
       GROUP BY body->>'scope', lower(btrim(body->>'email'))
      HAVING count(*) > 1
    ) duplicates;

  IF missing_scope > 0 OR missing_email > 0 OR duplicate_groups > 0 THEN
    RAISE EXCEPTION 'Migration 024 blocked: % subscribers with missing/blank/non-string scope, % with missing/blank/non-string email, % duplicate normalized email groups. No subscriber data was changed. Run node lib/campaigns-server/review-subscriber-identities.mjs against the Campaigns database; see lib/campaigns-server/SUBSCRIBER-IDENTITY.md. Resolve deliberately and retry.',
      missing_scope, missing_email, duplicate_groups;
  END IF;
END $$;

-- A subscriber must have a real scope and an email identity. This does not
-- rewrite the original email casing/spacing or any subscriber metadata.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'campaigns.entities'::regclass
       AND conname = 'entities_subscriber_identity_required'
  ) THEN
    ALTER TABLE campaigns.entities
      ADD CONSTRAINT entities_subscriber_identity_required
      CHECK (
        kind <> 'subscribers' OR (
          coalesce(jsonb_typeof(body->'scope') = 'string'
                   AND length(btrim(body->>'scope')) > 0, false)
          AND coalesce(jsonb_typeof(body->'email') = 'string'
                       AND length(btrim(body->>'email')) > 0, false)
        )
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS entities_subscribers_scope_email_identity_uidx
  ON campaigns.entities ((body->>'scope'), (lower(btrim(body->>'email'))))
  WHERE kind = 'subscribers';

INSERT INTO campaigns.migrations(version) VALUES (24) ON CONFLICT DO NOTHING;