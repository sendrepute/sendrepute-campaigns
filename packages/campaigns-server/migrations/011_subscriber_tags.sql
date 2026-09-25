UPDATE campaigns.entities
SET body = jsonb_set(body, '{tags}', '[]'::jsonb, true),
    updated_at = updated_at
WHERE kind = 'subscribers'
  AND NOT body ? 'tags';

INSERT INTO campaigns.migrations(version) VALUES (11) ON CONFLICT DO NOTHING;