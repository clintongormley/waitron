-- Frozen daily close (cierre Z, sub-project 8, slice 8b), Task 1: the immutable `daily_closes`
-- ledger and its mutable per-(tenant, node) chain head `daily_close_chain`.
--
-- The two CREATE TABLEs, the ENABLE ROW LEVEL SECURITY (from `.enableRLS()`), and the composite
-- (tenant_id, node_id) → nodes FKs below were emitted by `drizzle-kit generate`. Everything from
-- the "-- === Immutability recipe ===" line down is HAND-WRITTEN: drizzle-kit diffs against its own
-- snapshot and has no concept of FORCE, policies, privileges or triggers, so it emits none of them
-- — which is exactly why this survives every later `generate` run instead of being reverted by one.
-- Mirrors packages/fiscal-verifactu/drizzle/0001_registros_inmutables.sql (the immutable table) and
-- this package's 0029_park_retrieve.sql (the mutable counter) verbatim for the idioms.
--
-- `current_tenant_id()` (0001_tenancy_rls.sql), `reject_mutation()` (0002_immutability.sql) and the
-- `app_user` role (0001) already exist by the time this migration runs — all three are in this same
-- core set, ordered before 0033 by filename — and are NOT redefined here. `reject_mutation()`
-- reports TG_TABLE_NAME/TG_OP and raises SQLSTATE WT001, so the one shared definition covers this
-- table with no per-table redefinition.

CREATE TABLE "daily_close_chain" (
	"tenant_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"sequence_no" integer DEFAULT 0 NOT NULL,
	"last_entry_hash" text DEFAULT '' NOT NULL,
	CONSTRAINT "daily_close_chain_pk" PRIMARY KEY("tenant_id","node_id")
);
--> statement-breakpoint
ALTER TABLE "daily_close_chain" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "daily_closes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"business_day" date NOT NULL,
	"sequence_no" integer NOT NULL,
	"prev_entry_hash" text NOT NULL,
	"entry_hash" text NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "daily_closes_business_day_key" UNIQUE("tenant_id","node_id","business_day"),
	CONSTRAINT "daily_closes_sequence_key" UNIQUE("tenant_id","node_id","sequence_no")
);
--> statement-breakpoint
ALTER TABLE "daily_closes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "daily_close_chain" ADD CONSTRAINT "daily_close_chain_node_fk" FOREIGN KEY ("tenant_id","node_id") REFERENCES "public"."nodes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_closes" ADD CONSTRAINT "daily_closes_node_fk" FOREIGN KEY ("tenant_id","node_id") REFERENCES "public"."nodes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- === Immutability recipe (hand-written; see header) =========================================

-- Part 1/4 of packages/db/src/immutability.sql.md's recipe for `daily_closes`.
--
-- FORCE (not just ENABLE) so a deployment that connects as the migration owner is still subject to
-- the policy — inert against a superuser, which is why the app-role grant below is the control that
-- actually matters, not this. A FOR ALL policy whose USING filters reads and WITH CHECK filters
-- writes, keyed on current_tenant_id() (fails closed on a malformed app.tenant_id, unlike a bare
-- current_setting cast).
ALTER TABLE "daily_closes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "daily_closes_tenant_isolation" ON "daily_closes"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

-- The real control: the application connects as a NON-OWNER role holding only these privileges.
-- REVOKE ALL, not just UPDATE/DELETE/TRUNCATE: a provisioning script that ran
-- `GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user` before this migration would otherwise hand
-- back exactly the privileges being withheld (packages/db/src/immutability.sql.md, Part 1). SELECT +
-- INSERT only: a close is written once and thereafter read — never updated, never deleted.
REVOKE ALL ON "daily_closes" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT ON "daily_closes" TO app_user;--> statement-breakpoint

-- Parts 2 and 3: the trigger backstop. The revocation above is the mechanism; this is the backstop,
-- because the table owner can always ALTER TABLE … DISABLE TRIGGER and migrations run as owner. A
-- row trigger for UPDATE/DELETE, plus a SEPARATE statement trigger for TRUNCATE — a row trigger does
-- NOT fire on TRUNCATE, so without the second one TRUNCATE walks straight through every protection
-- above and empties the table.
CREATE TRIGGER "daily_closes_immutable"
  BEFORE UPDATE OR DELETE ON "daily_closes"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();--> statement-breakpoint
CREATE TRIGGER "daily_closes_no_truncate"
  BEFORE TRUNCATE ON "daily_closes"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();--> statement-breakpoint

-- Part 4 ONLY for `daily_close_chain`: it is the MUTABLE chain head — `sequence_no` and
-- `last_entry_hash` advance on every close — so it gets tenant isolation but NO append-only trigger,
-- and its grant INCLUDES UPDATE. The same shape `cadenas`/`working_order_counters`/`invoice_series`
-- carry. NO DELETE: a node keeps its chain head for the life of the node.
ALTER TABLE "daily_close_chain" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "daily_close_chain_tenant_isolation" ON "daily_close_chain"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
REVOKE ALL ON "daily_close_chain" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "daily_close_chain" TO app_user;
