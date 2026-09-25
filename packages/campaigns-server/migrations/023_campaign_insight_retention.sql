CREATE INDEX IF NOT EXISTS insight_requests_retention ON campaigns.insight_requests(created_at);
INSERT INTO campaigns.migrations(version) VALUES (23) ON CONFLICT DO NOTHING;