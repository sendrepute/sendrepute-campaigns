CREATE TABLE IF NOT EXISTS campaigns.disposable_source (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  domains text[],
  etag text,
  checked_at timestamptz,
  updated_at timestamptz,
  next_check_at timestamptz,
  last_error text
);
CREATE TABLE IF NOT EXISTS campaigns.email_hygiene_runs (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  scope text NOT NULL,
  list_id uuid NOT NULL,
  allowed_lists jsonb,
  mode text NOT NULL CHECK (mode IN ('basic','dns')),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','completed','failed')),
  cursor_id uuid,
  processed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_hygiene_active ON campaigns.email_hygiene_runs(created_at) WHERE state IN ('queued','running');
CREATE INDEX IF NOT EXISTS email_hygiene_owner ON campaigns.email_hygiene_runs(actor_id,created_at);
CREATE TABLE IF NOT EXISTS campaigns.email_hygiene_results (
  run_id uuid NOT NULL REFERENCES campaigns.email_hygiene_runs(id) ON DELETE CASCADE,
  subscriber_id uuid NOT NULL,
  email text NOT NULL,
  status text NOT NULL CHECK (status IN ('passed','risky','invalid','unknown')),
  reasons jsonb NOT NULL,
  checked_at timestamptz NOT NULL,
  PRIMARY KEY(run_id,subscriber_id)
);
INSERT INTO campaigns.migrations(version) VALUES (34) ON CONFLICT DO NOTHING;