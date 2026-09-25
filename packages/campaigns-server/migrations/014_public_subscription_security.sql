CREATE TABLE IF NOT EXISTS campaigns.public_rate_limits (
  fingerprint text PRIMARY KEY,
  used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  reset_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS public_rate_limits_expiry
  ON campaigns.public_rate_limits(reset_at);

-- Only one live confirmation may exist for an address/list pair. Expired and
-- duplicate legacy rows are retired before adding the invariant.
UPDATE campaigns.tokens
SET consumed_at = coalesce(consumed_at, now())
WHERE purpose = 'subscribe'
  AND consumed_at IS NULL
  AND expires_at <= now();

WITH duplicates AS (
  SELECT token_hash
  FROM (
    SELECT token_hash,
           row_number() OVER (
             PARTITION BY list_id, lower(email)
             ORDER BY expires_at DESC, token_hash
           ) AS position
    FROM campaigns.tokens
    WHERE purpose = 'subscribe' AND consumed_at IS NULL
  ) ranked
  WHERE position > 1
)
UPDATE campaigns.tokens
SET consumed_at = now()
WHERE token_hash IN (SELECT token_hash FROM duplicates);

CREATE UNIQUE INDEX IF NOT EXISTS tokens_one_live_subscription
  ON campaigns.tokens(list_id, lower(email))
  WHERE purpose = 'subscribe' AND consumed_at IS NULL;

INSERT INTO campaigns.migrations(version) VALUES (14) ON CONFLICT DO NOTHING;