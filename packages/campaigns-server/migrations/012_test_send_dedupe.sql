WITH duplicate_active_tests AS (
  SELECT id, row_number() OVER (
    PARTITION BY campaign_id, lower(snapshot->'subscriber'->>'email')
    ORDER BY created_at, id
  ) AS position
  FROM campaigns.jobs
  WHERE kind='test' AND state IN ('queued','sending')
)
UPDATE campaigns.jobs j
SET state='cancelled', updated_at=now(), revision=revision+1
FROM duplicate_active_tests duplicate
WHERE j.id=duplicate.id AND duplicate.position>1;

CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_active_test_recipient
  ON campaigns.jobs(campaign_id, lower(snapshot->'subscriber'->>'email'))
  WHERE kind='test' AND state IN ('queued','sending');

INSERT INTO campaigns.migrations(version) VALUES (12) ON CONFLICT DO NOTHING;