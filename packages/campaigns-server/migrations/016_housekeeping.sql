CREATE TABLE IF NOT EXISTS campaigns.housekeeping_runs (
  id uuid PRIMARY KEY,
  scope text NOT NULL,
  actor_id uuid,
  policy text NOT NULL CHECK (policy IN ('unconfirmed','inactive')),
  cutoff timestamptz NOT NULL,
  candidate_count integer NOT NULL CHECK (candidate_count >= 0),
  deleted_count integer NOT NULL CHECK (deleted_count >= 0),
  cancelled_job_count integer NOT NULL CHECK (cancelled_job_count >= 0),
  blocked_count integer NOT NULL CHECK (blocked_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (scope <> '')
);
CREATE INDEX IF NOT EXISTS housekeeping_runs_scope_created
  ON campaigns.housekeeping_runs(scope,created_at DESC,id);

ALTER TABLE campaigns.delivery_events DROP CONSTRAINT IF EXISTS delivery_events_event_type_check;
ALTER TABLE campaigns.delivery_events ADD CONSTRAINT delivery_events_event_type_check CHECK (event_type IN (
  'worker_attempt','accepted','rejected','unknown','retry_scheduled','cancelled',
  'provider_delivered','provider_opened','provider_clicked','provider_bounced',
  'provider_soft_bounced','provider_complained','provider_unsubscribed',
  'reconciled_accepted','reconciled_rejected','explicit_retry'
));

UPDATE campaigns.roles
SET body=jsonb_set(body,'{permissions}',
      coalesce(body->'permissions','[]'::jsonb)||'["housekeeping:manage"]'::jsonb),
    updated_at=now()
WHERE system=true AND lower(body->>'name') IN ('admin')
  AND NOT coalesce(body->'permissions','[]'::jsonb) ? 'housekeeping:manage';

INSERT INTO campaigns.migrations(version) VALUES (16) ON CONFLICT DO NOTHING;