-- Tokens minted by the delivery worker carry immutable provenance. Older
-- unsubscribe tokens remain valid opt-out links but have no campaign attribution.
ALTER TABLE campaigns.tokens ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES campaigns.jobs(id) ON DELETE SET NULL;

ALTER TABLE campaigns.delivery_events DROP CONSTRAINT IF EXISTS delivery_events_event_type_check;
ALTER TABLE campaigns.delivery_events ADD CONSTRAINT delivery_events_event_type_check CHECK (event_type IN (
  'worker_attempt','accepted','rejected','unknown','retry_scheduled','cancelled',
  'provider_delivered','provider_opened','provider_clicked','provider_bounced',
  'provider_soft_bounced','provider_complained','provider_unsubscribed',
  'first_party_unsubscribed','reconciled_accepted','reconciled_rejected','explicit_retry'
));
CREATE UNIQUE INDEX IF NOT EXISTS delivery_events_first_party_unsubscribe_job
  ON campaigns.delivery_events(job_id) WHERE event_type='first_party_unsubscribed';

INSERT INTO campaigns.migrations(version) VALUES (32) ON CONFLICT DO NOTHING;