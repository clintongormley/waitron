CREATE TABLE "dining_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"label" text NOT NULL,
	"zone" text,
	"capacity" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tab_id" uuid,
	CONSTRAINT "dining_tables_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "dining_tables_location_label_key" UNIQUE("tenant_id","location_id","label")
);
--> statement-breakpoint
ALTER TABLE "dining_tables" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenant_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;