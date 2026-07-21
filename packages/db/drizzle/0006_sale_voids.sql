CREATE TABLE "sale_voids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"voided_at" timestamp with time zone NOT NULL,
	"voided_by" uuid,
	CONSTRAINT "sale_voids_sale_id_key" UNIQUE("sale_id")
);
--> statement-breakpoint
ALTER TABLE "sale_voids" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sale_voids" ADD CONSTRAINT "sale_voids_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_voids" ADD CONSTRAINT "sale_voids_sale_fk" FOREIGN KEY ("tenant_id","sale_id") REFERENCES "public"."sales"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_voids_tenant_idx" ON "sale_voids" USING btree ("tenant_id");
--> statement-breakpoint

-- The append-only recipe (packages/db/src/immutability.sql.md), all four parts, in this same
-- migration. A void is a fact recorded once, never revised in place — the identical reasoning
-- that puts this recipe on sales/sale_lines/tenders (0005_sales.sql) applies here, not
-- invoice_series's tenant-isolation-only subset: there is no live counter on this table for an
-- application role to advance.
ALTER TABLE sale_voids FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY sale_voids_tenant_isolation ON sale_voids
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint

-- Privilege first, trigger second. The grants stop the application; the trigger
-- stops the owner, who can otherwise ALTER TABLE ... DISABLE TRIGGER anyway —
-- which is why the application must never BE the owner.
REVOKE ALL ON sale_voids FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON sale_voids TO app_user;
--> statement-breakpoint

-- No UPDATE, not even on voided_by: sub-project 5 fills that column by supplying it on the
-- INSERT `recordVoid` already makes, never by a later UPDATE — there is no scenario in which a
-- void, once recorded, is corrected in place rather than superseded by a further fact elsewhere.

CREATE TRIGGER sale_voids_enforce_immutability
  BEFORE UPDATE OR DELETE ON sale_voids
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint

-- A row trigger does not fire on TRUNCATE, so TRUNCATE walks straight through
-- the trigger above unless it is separately stopped.
CREATE TRIGGER sale_voids_block_truncate
  BEFORE TRUNCATE ON sale_voids
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();