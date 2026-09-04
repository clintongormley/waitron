-- Custom migration (mirror_config is out of the schema barrel; drizzle-kit never diffs it). Add the
-- mirror's sync ORIGIN nodeId (the primary it pulls from), distinct from its OWN identity
-- (config.till.nodeId). Membership R3a: the cloud runs as its own node from adopt. NOT NULL is safe —
-- mirror_config is empty until an adopt writes it (a primary carries the table empty too).
ALTER TABLE "mirror_config" ADD COLUMN "origin_node_id" uuid NOT NULL;
