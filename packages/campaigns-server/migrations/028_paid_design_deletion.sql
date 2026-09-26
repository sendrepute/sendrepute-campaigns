ALTER TABLE campaigns.paid_designs ADD COLUMN IF NOT EXISTS template_deleted_at timestamptz;

-- Receipts/idempotency survive removal from Saved Library. An old response,
-- restore, or reconciliation must never recreate an intentionally removed row.
CREATE OR REPLACE FUNCTION campaigns.prevent_deleted_paid_template_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE removed timestamptz;
BEGIN
  IF NEW.kind = 'templates' THEN
    SELECT template_deleted_at INTO removed FROM campaigns.paid_designs WHERE id=NEW.id FOR UPDATE;
    IF removed IS NOT NULL THEN RAISE EXCEPTION 'Paid template was intentionally deleted' USING ERRCODE='23514'; END IF;
  ELSIF NEW.kind = 'campaigns' THEN
    PERFORM 1 FROM campaigns.entities WHERE kind='templates' AND id::text=NEW.body->>'templateId' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Campaign template is unavailable' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS prevent_deleted_paid_template_insert ON campaigns.entities;
CREATE TRIGGER prevent_deleted_paid_template_insert BEFORE INSERT ON campaigns.entities
FOR EACH ROW EXECUTE FUNCTION campaigns.prevent_deleted_paid_template_insert();
DROP TRIGGER IF EXISTS verify_campaign_template_update ON campaigns.entities;
CREATE TRIGGER verify_campaign_template_update BEFORE UPDATE OF body ON campaigns.entities
FOR EACH ROW WHEN (NEW.kind='campaigns') EXECUTE FUNCTION campaigns.prevent_deleted_paid_template_insert();

CREATE OR REPLACE FUNCTION campaigns.verify_subscription_templates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.welcome_template_id IS NOT NULL THEN
    PERFORM 1 FROM campaigns.entities WHERE kind='templates' AND id=NEW.welcome_template_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Welcome template is unavailable' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.goodbye_template_id IS NOT NULL THEN
    PERFORM 1 FROM campaigns.entities WHERE kind='templates' AND id=NEW.goodbye_template_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Goodbye template is unavailable' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS verify_subscription_templates ON campaigns.subscription_customizations;
CREATE TRIGGER verify_subscription_templates BEFORE INSERT OR UPDATE OF welcome_template_id,goodbye_template_id
ON campaigns.subscription_customizations FOR EACH ROW EXECUTE FUNCTION campaigns.verify_subscription_templates();
INSERT INTO campaigns.migrations(version) VALUES (28) ON CONFLICT DO NOTHING;