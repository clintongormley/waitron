-- Hand-written, same reason as 0001_registros_inmutables.sql's / 0003_envio_flujo_rls.sql's
-- header: drizzle-kit diffs against its own snapshot and has no concept of policies, FORCE or
-- privileges, so none of this would survive a later `generate` run if it lived in a generated
-- file — and it does not need to, because a generated migration never touches it again.
--
-- current_tenant_id() is NOT redefined here, for the same reason 0001/0003 do not redefine it: it
-- is a shared function created once by packages/db's 0001_tenancy_rls.sql and already lives in
-- the `public` schema by the time this migration runs (core migrations run before this package's
-- — migrations.test.ts's "fails when fiscal runs before core" proves it).

--> statement-breakpoint
ALTER TABLE "acks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- current_tenant_id(), not a bare current_setting(...)::uuid cast: identical rationale to
-- 0001_registros_inmutables.sql's / 0003_envio_flujo_rls.sql's policies — it fails closed on a
-- malformed or unset app.tenant_id, and it is the one function every other tenant-isolation
-- policy in this package already uses.
CREATE POLICY "acks_tenant_isolation" ON "acks"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

-- acks is MUTABLE, upserted by the drainer/consumer as the ack it carries gets delivered
-- downstream — the same shape as envio_flujo in 0003_envio_flujo_rls.sql, which does not get the
-- append-only triggers either. It gets Part 4 of packages/db/src/immutability.sql.md's recipe
-- (tenant isolation) only.
--
-- REVOKE ALL, not just UPDATE/DELETE/TRUNCATE: a provisioning script that ran
-- `GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user` before this migration would otherwise
-- hand back exactly the privileges being withheld.
REVOKE ALL ON "acks" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "acks" TO app_user;
