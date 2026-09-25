CREATE TABLE IF NOT EXISTS campaigns.brands (
  id uuid PRIMARY KEY,
  scope text NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  logo_url text,
  color text,
  default_from_name text,
  default_from_email text,
  default_reply_to text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scope, name),
  CHECK (scope <> ''),
  CHECK (logo_url IS NULL OR length(logo_url) <= 2048),
  CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$')
);
CREATE INDEX IF NOT EXISTS brands_scope_updated
  ON campaigns.brands(scope, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS entities_brand_id
  ON campaigns.entities((body->>'brandId'))
  WHERE kind IN ('lists','templates','campaigns') AND body ? 'brandId';

UPDATE campaigns.roles
SET body=jsonb_set(body,'{permissions}',
      coalesce(body->'permissions','[]'::jsonb)||'["brands:manage"]'::jsonb),
    updated_at=now()
WHERE system=true AND lower(body->>'name') IN ('admin','manager')
  AND NOT coalesce(body->'permissions','[]'::jsonb) ? 'brands:manage';

INSERT INTO campaigns.migrations(version) VALUES (15) ON CONFLICT DO NOTHING;