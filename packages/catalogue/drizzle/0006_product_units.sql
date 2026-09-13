CREATE TABLE "product_units" (
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	CONSTRAINT "product_units_product_key" UNIQUE("tenant_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "unit_seed_states" (
	"tenant_id" uuid PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"seed_key" text,
	"name" jsonb NOT NULL,
	"precision" integer NOT NULL,
	"hardware_unit" text,
	CONSTRAINT "units_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "units_tenant_seed_key_key" UNIQUE("tenant_id","seed_key"),
	CONSTRAINT "units_precision_ck" CHECK ("units"."precision" between 0 and 3),
	CONSTRAINT "units_hardware_unit_ck" CHECK ("units"."hardware_unit" in ('kg', 'g', 'mg'))
);
--> statement-breakpoint
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_unit_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."units"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_seed_states" ADD CONSTRAINT "unit_seed_states_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_units_unit_idx" ON "product_units" USING btree ("tenant_id","unit_id");--> statement-breakpoint
CREATE INDEX "units_tenant_idx" ON "units" USING btree ("tenant_id");