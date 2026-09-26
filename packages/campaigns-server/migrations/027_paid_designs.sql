CREATE TABLE IF NOT EXISTS campaigns.paid_designs (
 id uuid PRIMARY KEY,
 scope text NOT NULL,
 owner_id text NOT NULL,
 operation text NOT NULL,
 input jsonb NOT NULL,
 source jsonb,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed')),
 result jsonb,
 error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paid_designs_scope_owner ON campaigns.paid_designs(scope,owner_id,created_at);
INSERT INTO campaigns.migrations(version) VALUES (27) ON CONFLICT DO NOTHING;