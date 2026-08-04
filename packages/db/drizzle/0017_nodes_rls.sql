-- FORCE ROW LEVEL SECURITY + tenant-isolation policy + a SELECT-only app-role grant for `nodes`.
--
-- `nodes` shipped in 0015 with ENABLE only; 0001 deferred FORCE/policy/grants until something
-- referenced it ("nothing FKs nodes yet", nodes.test.ts). The node_id rekey's additive column pass
-- (this same change) makes seven fiscal/commercial tables FK `nodes`, so it is now a first-class
-- tenant-scoped table and gets the FORCE + tenant-isolation policy its sibling `tills` already has in
-- 0001_tenancy_rls.sql. Drizzle does not emit FORCE/POLICY/GRANT, so this is a hand-written custom
-- migration, exactly like 0001. The `current_tenant_id()` function and the `app_user` role already
-- exist from 0001 and are NOT recreated here.
--
-- FORCE and the FOR ALL policy mirror the `tills` lines of 0001: FORCE (so a deployment that connects
-- as the migration owner is still isolated — inert against a superuser, which is why it is not the
-- control that matters), and a FOR ALL policy whose USING filters reads and WITH CHECK filters
-- writes. The policy stays FOR ALL, not FOR SELECT, deliberately: defence-in-depth of the same shape
-- `tills` carries, so a WITH CHECK is already in place if the grant is ever widened.
--
-- The GRANT does NOT mirror `tills`, which gets SELECT/INSERT/UPDATE (0001:106). It is SELECT only —
-- so `nodes` follows `tenants` (SELECT only, 0001:102), not `tills` — by least privilege (CLAUDE.md
-- §3: `app_user` holds SELECT on `tenants` and NOT INSERT for exactly this reason). The node_id rekey
-- confirmed no app-role path writes a node: the running POS only READS nodes, node rows are
-- owner-provisioned, and every node INSERT in the tree runs as the owner (the `seedNode`/fixture
-- helpers and the `suite.admin`/superuser transactions the tests seed through) — grepped across the
-- repo on 2026-08-03, no `insert`/`update` of `nodes` under `asAppUser`/`withTenant` exists. NO
-- DELETE either, the same rule 0001 states for `tills` (a node with sales behind it must not be
-- removable), so SELECT is the whole grant.
--
-- 2026-08-04 note: the 2026-08-03 enumeration above is no longer exhaustive. `applyVenue`
-- (@waitron/provisioning, feat/locations-provisioning) now runs `insert into nodes …` under
-- `withTenant` (venue-apply.ts) — a node INSERT that the grep's "no … under `withTenant`" clause did
-- not anticipate. The SELECT-only `app_user` grant below is UNAFFECTED: `applyVenue`'s `deps.db` is
-- the owner-admin connection that owns the tables (Task C1), so that insert runs as the table OWNER,
-- not as `app_user`. The grant turns on the ROLE the write runs as, not on whether `withTenant` wraps
-- it, and no app-role path writes a node.
ALTER TABLE "nodes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "nodes_tenant_isolation" ON "nodes"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
GRANT SELECT ON "nodes" TO app_user;