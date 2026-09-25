CREATE TABLE IF NOT EXISTS campaigns.custom_domains (
  id uuid PRIMARY KEY,
  hostname text NOT NULL UNIQUE,
  base_path text NOT NULL DEFAULT '/',
  challenge text NOT NULL,
  verified_at timestamptz,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (hostname = lower(hostname)),
  CHECK (hostname !~ '[/:\s]'),
  CHECK (base_path ~ '^/([^?#]*)$')
);

CREATE TABLE IF NOT EXISTS campaigns.sent_documents (
  id uuid PRIMARY KEY,
  job_id uuid REFERENCES campaigns.jobs(id) ON DELETE RESTRICT,
  campaign_id uuid,
  recipient_id uuid,
  subject text NOT NULL,
  html text NOT NULL,
  text_content text,
  tracking_allowed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id)
);
CREATE INDEX IF NOT EXISTS sent_documents_campaign
  ON campaigns.sent_documents(campaign_id,created_at DESC,id);

CREATE TABLE IF NOT EXISTS campaigns.tracking_tokens (
  token_hash text PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES campaigns.sent_documents(id) ON DELETE RESTRICT,
  scope text NOT NULL CHECK (scope IN ('webversion','open','click')),
  destination text,
  destination_key text,
  record_event boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CHECK ((scope = 'click') = (destination IS NOT NULL)),
  CHECK ((scope = 'click') = (destination_key IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS tracking_tokens_document
  ON campaigns.tracking_tokens(document_id,scope);

CREATE TABLE IF NOT EXISTS campaigns.tracking_event_ledger (
  document_id uuid NOT NULL REFERENCES campaigns.sent_documents(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('open','click')),
  event_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY(document_id,event_type,event_key)
);

CREATE OR REPLACE FUNCTION campaigns.sent_tracking_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'sent campaign documents and tracking records are immutable';
END $$;

DROP TRIGGER IF EXISTS sent_documents_no_update ON campaigns.sent_documents;
CREATE TRIGGER sent_documents_no_update
  BEFORE UPDATE OR DELETE ON campaigns.sent_documents
  FOR EACH ROW EXECUTE FUNCTION campaigns.sent_tracking_immutable();

DROP TRIGGER IF EXISTS tracking_tokens_no_update ON campaigns.tracking_tokens;
CREATE TRIGGER tracking_tokens_no_update
  BEFORE UPDATE OR DELETE ON campaigns.tracking_tokens
  FOR EACH ROW EXECUTE FUNCTION campaigns.sent_tracking_immutable();

DROP TRIGGER IF EXISTS tracking_event_ledger_no_update ON campaigns.tracking_event_ledger;
CREATE TRIGGER tracking_event_ledger_no_update
  BEFORE UPDATE OR DELETE ON campaigns.tracking_event_ledger
  FOR EACH ROW EXECUTE FUNCTION campaigns.sent_tracking_immutable();

INSERT INTO campaigns.migrations(version) VALUES (19) ON CONFLICT DO NOTHING;