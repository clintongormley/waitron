CREATE TABLE "sale_substitutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"substitution_sale_id" uuid NOT NULL,
	"substituted_sale_id" uuid NOT NULL,
	CONSTRAINT "sale_substitutions_substituted_key" UNIQUE("tenant_id","substituted_sale_id")
);
--> statement-breakpoint
ALTER TABLE "sale_substitutions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "counterparty_tax_id" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "counterparty_legal_name" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "counterparty_country_code" text;--> statement-breakpoint
ALTER TABLE "sale_substitutions" ADD CONSTRAINT "sale_substitutions_substitution_fk" FOREIGN KEY ("tenant_id","substitution_sale_id") REFERENCES "public"."sales"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_substitutions" ADD CONSTRAINT "sale_substitutions_substituted_fk" FOREIGN KEY ("tenant_id","substituted_sale_id") REFERENCES "public"."sales"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_substitutions_substitution_idx" ON "sale_substitutions" USING btree ("tenant_id","substitution_sale_id");--> statement-breakpoint

-- Everything above (CREATE TABLE, ENABLE RLS, the two composite FKs, the unique, the index, and
-- the three counterparty_* ADD COLUMNs on sales) is plain `drizzle-kit generate` against
-- ./src/schema/sales.ts, so drizzle/meta/0014_snapshot.json stays an accurate record of the shape.
-- Everything below is the immutability recipe (packages/db/src/immutability.sql.md), which
-- drizzle-kit has no concept of and never reverts — the same split 0005_sales.sql applies to
-- sale_lines/tenders. sale_substitutions is an append-only child of sales: written once when the F3
-- is issued, never edited.
--
-- The three counterparty_* columns on sales need NO DDL here: sales already REVOKEs UPDATE/DELETE
-- from app_user and FORCEs RLS, both table-wide, so the new columns inherit immutability and tenant
-- isolation with no privilege/trigger/policy change (the same reasoning 0013_sale_corrects_link and
-- 0009_registro_entorno relied on).

-- Tenant isolation, Part 4 of the recipe. ENABLE came for free from `.enableRLS()` above; FORCE is
-- required on top of it, because without FORCE the table owner bypasses the policy and migrations
-- run as owner. immutability.test.ts's auto-discovery guard asserts every table carrying the
-- reject_mutation() trigger has BOTH relrowsecurity and relforcerowsecurity set.
ALTER TABLE sale_substitutions FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- current_tenant_id() (0001_tenancy_rls.sql), not a bare current_setting(...)::uuid cast: it fails
-- closed (a malformed app.tenant_id returns NULL, filtering every row) and is the function every
-- other tenant-isolation policy in this package already uses.
CREATE POLICY sale_substitutions_tenant_isolation ON sale_substitutions
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

-- Privilege first, trigger second. The grants stop the application; the trigger stops the owner,
-- who can otherwise ALTER TABLE ... DISABLE TRIGGER — which is why the application must never BE the
-- owner. No UPDATE, on any column: a substitution link is written once and never moves.
REVOKE ALL ON sale_substitutions FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT ON sale_substitutions TO app_user;--> statement-breakpoint

-- Parts 2 and 3 of the recipe, verbatim, against reject_mutation() — the shared function created in
-- 0002_immutability.sql. It reports TG_TABLE_NAME and TG_OP and raises SQLSTATE WT001, so tests
-- assert on the code rather than on wording.
CREATE TRIGGER sale_substitutions_enforce_immutability
  BEFORE UPDATE OR DELETE ON sale_substitutions
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();--> statement-breakpoint

-- A row trigger does not fire on TRUNCATE, so TRUNCATE walks straight through the trigger above
-- unless it is separately stopped.
CREATE TRIGGER sale_substitutions_block_truncate
  BEFORE TRUNCATE ON sale_substitutions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();