-- Custom migration (drizzle-kit models no grants). Membership Slice 3 (distribution): the runtime-
-- adoption writer persists a gossiped, accepted membership document on the APP pool (a node adopting
-- a newer document over /sync-api/hello — apps/server/src/membership-adopt.ts). Slice 2 granted SELECT
-- only (owner-role writes); this adds the deferred INSERT/UPDATE. NO DELETE — the singleton is never
-- deleted, supersession is an UPDATE to a higher term.
GRANT INSERT, UPDATE ON "node_membership" TO app_user;
