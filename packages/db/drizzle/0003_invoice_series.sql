CREATE TABLE "invoice_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"till_id" uuid NOT NULL,
	"code" text NOT NULL,
	"purpose" text DEFAULT 'standard' NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "invoice_series_till_code_key" UNIQUE("tenant_id","till_id","code"),
	CONSTRAINT "invoice_series_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoice_series_purpose_ck" CHECK ("invoice_series"."purpose" in ('standard', 'rectificative')),
	CONSTRAINT "invoice_series_next_number_ck" CHECK ("invoice_series"."next_number" >= 1),
	CONSTRAINT "invoice_series_code_ck" CHECK ("invoice_series"."code" <> '')
);
--> statement-breakpoint
ALTER TABLE "invoice_series" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoice_series" ADD CONSTRAINT "invoice_series_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_series" ADD CONSTRAINT "invoice_series_till_id_tills_id_fk" FOREIGN KEY ("till_id") REFERENCES "public"."tills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_series_tenant_idx" ON "invoice_series" USING btree ("tenant_id");
--> statement-breakpoint

-- Tenant isolation, Part 4 of the recipe (packages/db/src/immutability.sql.md)
-- applied WITHOUT parts 1-3: invoice_series is mutable (next_number changes on
-- every allocation), not append-only, so the immutability triggers do not
-- apply here. ENABLE already came for free above, from `.enableRLS()` on the
-- Drizzle table definition. FORCE is required on top of it: without FORCE the
-- table owner bypasses the policy, and migrations run as owner.
ALTER TABLE "invoice_series" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- current_tenant_id() (0001_tenancy_rls.sql) rather than a bare
-- current_setting(...)::uuid cast: it already fails closed (a malformed
-- app.tenant_id returns NULL, filtering every row, instead of raising
-- `invalid input syntax for type uuid`) and it is the one function every
-- other tenant-isolation policy in this package already uses — verified
-- against tenants/locations/tills in 0001_tenancy_rls.sql.
CREATE POLICY "invoice_series_tenant_isolation" ON "invoice_series"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint

REVOKE ALL ON "invoice_series" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "invoice_series" TO app_user;
--> statement-breakpoint

-- The one column the application may advance, and the only relaxation of
-- Task 5's blanket revocation anywhere in this plan. It is scoped to the
-- single column: the app role still cannot rewrite a series' code, purpose,
-- till or tenant. invoice_series is configuration, not a fiscal record —
-- nothing about it is under audit — so the immutability argument that governs
-- `sales` does not apply here. `sales` keeps its total revocation.
GRANT UPDATE ("next_number") ON "invoice_series" TO app_user;