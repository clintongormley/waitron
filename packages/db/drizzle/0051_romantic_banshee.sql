CREATE TABLE "floor_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "floor_zones_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "floor_zones_name_key" UNIQUE("tenant_id","location_id","name")
);
--> statement-breakpoint
ALTER TABLE "floor_zones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "working_order_lines" ADD COLUMN "served_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dining_tables" ADD COLUMN "zone_id" uuid;--> statement-breakpoint
ALTER TABLE "floor_zones" ADD CONSTRAINT "floor_zones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_zones" ADD CONSTRAINT "floor_zones_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_tables" DROP COLUMN "zone";