-- Durable recovery records, independent of the 30-day hygiene report lifetime.
CREATE TABLE IF NOT EXISTS campaigns.deleted_subscribers (
  id uuid PRIMARY KEY,
  subscriber_id uuid NOT NULL,
  scope text NOT NULL,
  body jsonb NOT NULL,
  original_created_at timestamptz NOT NULL,
  reasons jsonb NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scope, subscriber_id)
);
CREATE INDEX IF NOT EXISTS deleted_subscribers_scope_date
  ON campaigns.deleted_subscribers(scope, deleted_at DESC, id);
INSERT INTO campaigns.migrations(version) VALUES (36) ON CONFLICT DO NOTHING;