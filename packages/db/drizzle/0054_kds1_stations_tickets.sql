CREATE TYPE "public"."bump_mode" AS ENUM('line', 'ticket');--> statement-breakpoint
CREATE TYPE "public"."ticket_state" AS ENUM('queued', 'preparing', 'ready');--> statement-breakpoint
CREATE TABLE "kitchen_stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kitchen_stations_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "kitchen_stations_name_key" UNIQUE("tenant_id","location_id","name")
);
--> statement-breakpoint
ALTER TABLE "kitchen_stations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ticket_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"working_order_id" uuid NOT NULL,
	"working_order_line_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"state" "ticket_state" DEFAULT 'queued' NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"preparing_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	CONSTRAINT "ticket_items_working_order_line_id_key" UNIQUE("tenant_id","working_order_line_id")
);
--> statement-breakpoint
ALTER TABLE "ticket_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "order_prep" CASCADE;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "bump_mode" "bump_mode" DEFAULT 'line' NOT NULL;--> statement-breakpoint
ALTER TABLE "working_orders" ADD COLUMN "collected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "station_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "station_id" uuid;--> statement-breakpoint
ALTER TABLE "kitchen_stations" ADD CONSTRAINT "kitchen_stations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_stations" ADD CONSTRAINT "kitchen_stations_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_items" ADD CONSTRAINT "ticket_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_items_queue_idx" ON "ticket_items" USING btree ("tenant_id","station_id","state");--> statement-breakpoint
ALTER TABLE "working_order_lines" ADD CONSTRAINT "working_order_lines_tenant_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
DROP TYPE "public"."prep_state";