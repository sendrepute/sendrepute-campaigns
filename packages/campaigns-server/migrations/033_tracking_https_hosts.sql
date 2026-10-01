-- Approval is additive: retain routes for already-delivered immutable links
-- even after a challenge is rotated or the selectable domain is deleted.
CREATE TABLE IF NOT EXISTS campaigns.tracking_https_hosts (
  hostname text NOT NULL,
  base_path text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(hostname,base_path),
  CHECK (hostname = lower(hostname)),
  CHECK (hostname !~ '[/:\s]'),
  CHECK (base_path ~ '^/([^?#]*)$')
);
INSERT INTO campaigns.tracking_https_hosts(hostname,base_path)
  SELECT hostname,base_path FROM campaigns.custom_domains WHERE verified_at IS NOT NULL
  ON CONFLICT DO NOTHING;
INSERT INTO campaigns.migrations(version) VALUES (33) ON CONFLICT DO NOTHING;