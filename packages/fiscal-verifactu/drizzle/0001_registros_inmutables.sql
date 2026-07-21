-- Hand-written. Everything below is invisible to drizzle-kit, which diffs against its own
-- snapshot and has no concept of triggers, policies, FORCE or privileges — which is exactly why
-- this survives every later `generate` run instead of being reverted by one.
--
-- current_tenant_id() and reject_mutation() are NOT redefined here. Both are shared functions
-- created once by packages/db's own migrations (0001_tenancy_rls.sql, 0002_immutability.sql) and
-- already live in the `public` schema by the time this migration runs — because core migrations
-- must run before this package's (packages/db/src/immutability.sql.md; migrations.test.ts's
-- "fails when fiscal runs before core" proves it). Redefining either here would mean two
-- functions doing the same thing with the same name colliding at CREATE OR REPLACE time, for no
-- benefit: reject_mutation() already reports TG_TABLE_NAME/TG_OP and raises SQLSTATE WT001,
-- exactly what this table needs, and current_tenant_id() already fails closed on a malformed or
-- unset app.tenant_id.

--> statement-breakpoint
ALTER TABLE "registros_facturacion" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cadenas" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "registro_sif" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "envios" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- current_tenant_id() (packages/db's 0001_tenancy_rls.sql), not a bare
-- current_setting(...)::uuid cast: it already fails closed (a malformed app.tenant_id returns
-- NULL, filtering every row, instead of raising `invalid input syntax for type uuid`) and it is
-- the one function every other tenant-isolation policy in this repo already uses.
CREATE POLICY "registros_facturacion_tenant_isolation" ON "registros_facturacion"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
CREATE POLICY "cadenas_tenant_isolation" ON "cadenas"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
CREATE POLICY "registro_sif_tenant_isolation" ON "registro_sif"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
CREATE POLICY "envios_tenant_isolation" ON "envios"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

-- The real control: the application connects as a NON-OWNER role holding only these privileges.
-- The triggers below are the backstop, not the mechanism — the table owner can always
-- ALTER TABLE … DISABLE TRIGGER, so a design that relies on the trigger alone relies on the
-- application not being the owner anyway. Migrations run as owner; the application never does.
--
-- REVOKE ALL, not just UPDATE/DELETE/TRUNCATE: a provisioning script that ran
-- `GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user` before this migration would otherwise
-- hand back exactly the privileges being withheld (packages/db/src/immutability.sql.md, Part 1).
REVOKE ALL ON "registros_facturacion" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT ON "registros_facturacion" TO app_user;--> statement-breakpoint

-- cadenas, registro_sif and envios are MUTABLE — the chain head advances, a SIF identity is
-- revoked in place, and delivery state on envios changes for hours after the registro commits.
-- They get Part 4 of the recipe (tenant isolation) only, never the append-only triggers: the
-- same shape invoice_series (packages/db) already applies for the same reason.
REVOKE ALL ON "cadenas" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "cadenas" TO app_user;--> statement-breakpoint
REVOKE ALL ON "registro_sif" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "registro_sif" TO app_user;--> statement-breakpoint
REVOKE ALL ON "envios" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "envios" TO app_user;--> statement-breakpoint

-- contadores_instalacion carries no tenant_id and no RLS at all (findings §1: a single
-- cross-tenant writer keyed by NIF, where a tenant-scoping policy would itself be the bug), so it
-- gets no FORCE and no POLICY above — only the grant the allocator needs to advance its counter.
REVOKE ALL ON "contadores_instalacion" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "contadores_instalacion" TO app_user;--> statement-breakpoint

-- Parts 2 and 3 of packages/db/src/immutability.sql.md's recipe, verbatim, against
-- reject_mutation() — the shared function created once in packages/db's 0002_immutability.sql.
-- It reports TG_TABLE_NAME and TG_OP, so this one definition covers registros_facturacion (and
-- every other protected table in the whole repo) with no per-table redefinition, and it raises
-- SQLSTATE WT001 so tests assert on the code rather than on wording.
CREATE TRIGGER "registros_facturacion_enforce_immutability"
  BEFORE UPDATE OR DELETE ON "registros_facturacion"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();--> statement-breakpoint

-- A row trigger does NOT fire on TRUNCATE. Without this second, statement-level trigger, TRUNCATE
-- silently walks straight through every protection above and empties the table.
CREATE TRIGGER "registros_facturacion_block_truncate"
  BEFORE TRUNCATE ON "registros_facturacion"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
