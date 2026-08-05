-- Hand-written (a --custom migration drizzle-kit will never regenerate), same reason as
-- packages/fiscal-verifactu/drizzle/0001_registros_inmutables.sql and this package's own
-- 0001_workforce_rls.sql: drizzle-kit has no concept of policies, FORCE, privileges or triggers,
-- which is exactly why this survives every later `generate` run instead of being reverted by one.
--
-- current_tenant_id() and reject_mutation() are NOT redefined here. Both are shared functions
-- created once by packages/db's own migrations (0001_tenancy_rls.sql, 0002_immutability.sql) and
-- already live in `public` by the time this runs, because core migrations run before this package's
-- (migrations.manifest.json orders `core` first; packages/migrations/src/manifest.test.ts proves
-- it). current_tenant_id() already fails closed (a malformed or unset app.tenant_id returns NULL,
-- filtering every row); reject_mutation() reports TG_TABLE_NAME/TG_OP and raises SQLSTATE WT001,
-- exactly what these tables need. Redefining either would be a same-name collision for no benefit.

--> statement-breakpoint
ALTER TABLE "employments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "employments_tenant_isolation" ON "employments"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
CREATE POLICY "time_entries_tenant_isolation" ON "time_entries"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

-- employments is MUTABLE — a contract's terms change and it ends by setting end_date, never by
-- deleting the row (the time history that references the person must keep its referent). So
-- SELECT, INSERT, UPDATE and no DELETE, the same shape as persons. REVOKE ALL first so a prior
-- provisioning GRANT ALL cannot survive the withheld privileges (packages/db/src/immutability.sql.md
-- Part 1), then the targeted grant.
REVOKE ALL ON "employments" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "employments" TO app_user;--> statement-breakpoint

-- time_entries is the IMMUTABLE registro de jornada floor (art. 34.9). The application connects as a
-- NON-OWNER role holding only SELECT, INSERT: a clock event, once appended, physically cannot be
-- rewritten or deleted by the app. The triggers below are the backstop, not the mechanism — the
-- table owner can always DISABLE TRIGGER, so a design that leaned on the trigger alone would be
-- leaning on the app not being the owner anyway, which the revocation is what guarantees. Migrations
-- run as owner; the application never does.
REVOKE ALL ON "time_entries" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT ON "time_entries" TO app_user;--> statement-breakpoint

-- Parts 2 and 3 of packages/db/src/immutability.sql.md's recipe, against reject_mutation() (the
-- shared function from packages/db's 0002_immutability.sql). It reports TG_TABLE_NAME and TG_OP, so
-- this one function covers time_entries with no per-table redefinition, and it raises SQLSTATE WT001
-- so tests assert on the code rather than on wording.
CREATE TRIGGER "time_entries_enforce_immutability"
  BEFORE UPDATE OR DELETE ON "time_entries"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();--> statement-breakpoint

-- A row trigger does NOT fire on TRUNCATE. Without this second, statement-level trigger, TRUNCATE
-- silently walks straight through every protection above and empties the append-only table.
CREATE TRIGGER "time_entries_block_truncate"
  BEFORE TRUNCATE ON "time_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
