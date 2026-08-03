-- FORCE ROW LEVEL SECURITY + tenant-isolation policy + app-role grants for `nodes`.
--
-- `nodes` shipped in 0015 with ENABLE only; 0001 deferred FORCE/policy/grants until something
-- referenced it ("nothing FKs nodes yet", nodes.test.ts). The node_id rekey's additive column pass
-- (this same change) makes seven fiscal/commercial tables FK `nodes`, so it is now a first-class
-- tenant-scoped table and gets the identical treatment its sibling `tills` already has in
-- 0001_tenancy_rls.sql. Drizzle does not emit FORCE/POLICY/GRANT, so this is a hand-written custom
-- migration, exactly like 0001. The `current_tenant_id()` function and the `app_user` role already
-- exist from 0001 and are NOT recreated here.
--
-- Mirrors the `tills` lines of 0001 verbatim: FORCE (so a deployment that connects as the migration
-- owner is still isolated — inert against a superuser, which is why it is not the control that
-- matters), a FOR ALL policy whose USING filters reads and WITH CHECK filters writes (both, or a
-- tenant could INSERT rows it can never read back), and SELECT/INSERT/UPDATE grants. NO DELETE, per
-- 0001's own rule — nothing in the write path deletes a node, and a node with sales behind it must
-- not be removable.
ALTER TABLE "nodes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "nodes_tenant_isolation" ON "nodes"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "nodes" TO app_user;