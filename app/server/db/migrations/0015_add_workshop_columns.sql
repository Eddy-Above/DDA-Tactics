-- 0015_add_workshop_columns.sql
-- Character Workshop (sandbox) support: sandbox tamers/digimon live with
-- campaign_id NULL and carry the creation-rules snapshot they were built
-- under (creation_rules). owner_id is reserved for a future accounts feature
-- so sandbox characters can be claimed later; nothing writes it yet.

ALTER TABLE tamers ADD COLUMN IF NOT EXISTS creation_rules jsonb;
ALTER TABLE tamers ADD COLUMN IF NOT EXISTS owner_id TEXT;

ALTER TABLE digimon ADD COLUMN IF NOT EXISTS creation_rules jsonb;
ALTER TABLE digimon ADD COLUMN IF NOT EXISTS owner_id TEXT;
