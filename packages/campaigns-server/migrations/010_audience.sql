ALTER TABLE campaigns.installation
  ADD COLUMN IF NOT EXISTS scope uuid NOT NULL DEFAULT gen_random_uuid();

UPDATE campaigns.entities subscriber
SET body=jsonb_set(subscriber.body,'{scope}',to_jsonb(installation.scope::text),true),
    updated_at=now()
FROM campaigns.installation installation
WHERE subscriber.kind='subscribers'
  AND (subscriber.body->>'scope' IS NULL OR subscriber.body->>'scope'='');

CREATE TABLE IF NOT EXISTS campaigns.audience_custom_fields (
  scope text NOT NULL,
  key text NOT NULL CHECK (key ~ '^[A-Za-z][A-Za-z0-9_.-]{0,63}$'),
  definition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key),
  CHECK (scope <> '')
);

CREATE TABLE IF NOT EXISTS campaigns.audience_segments (
  scope text NOT NULL,
  id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description text,
  predicate jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, id),
  CHECK (scope <> ''),
  CHECK (description IS NULL OR length(description) <= 1000)
);
CREATE INDEX IF NOT EXISTS audience_segments_scope_updated
  ON campaigns.audience_segments(scope, updated_at DESC, id);

UPDATE campaigns.roles
SET body=jsonb_set(body,'{permissions}',
      coalesce(body->'permissions','[]'::jsonb)||'["audiences:read","audiences:manage"]'::jsonb),
    updated_at=now()
WHERE system=true AND lower(body->>'name') IN ('admin','manager')
  AND NOT coalesce(body->'permissions','[]'::jsonb) ?& ARRAY['audiences:read','audiences:manage'];
UPDATE campaigns.roles
SET body=jsonb_set(body,'{permissions}',
      coalesce(body->'permissions','[]'::jsonb)||'["audiences:read"]'::jsonb),
    updated_at=now()
WHERE system=true AND lower(body->>'name') IN ('editor','analyst')
  AND NOT coalesce(body->'permissions','[]'::jsonb) ? 'audiences:read';

INSERT INTO campaigns.migrations(version) VALUES (10) ON CONFLICT DO NOTHING;