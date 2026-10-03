-- Independent cache: preserve the existing source and its conditional-update state.
CREATE TABLE IF NOT EXISTS campaigns.disposable_mailchecker_source (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  domains text[],
  etag text,
  checked_at timestamptz,
  updated_at timestamptz,
  next_check_at timestamptz,
  last_error text
);
INSERT INTO campaigns.migrations(version) VALUES (35) ON CONFLICT DO NOTHING;