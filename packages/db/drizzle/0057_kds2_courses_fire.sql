CREATE TYPE "public"."fire_control_mode" AS ENUM('waiter', 'kitchen');--> statement-breakpoint
CREATE TABLE "kitchen_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kitchen_courses_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "kitchen_courses_name_key" UNIQUE("tenant_id","location_id","name")
);
--> statement-breakpoint
ALTER TABLE "kitchen_courses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "fire_control" "fire_control_mode" DEFAULT 'waiter' NOT NULL;--> statement-breakpoint
ALTER TABLE "working_order_lines" ADD COLUMN "course_id" uuid;--> statement-breakpoint
ALTER TABLE "ticket_items" ADD COLUMN "course_id" uuid;--> statement-breakpoint
ALTER TABLE "ticket_items" ADD COLUMN "fired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "course_id" uuid;--> statement-breakpoint
ALTER TABLE "kitchen_courses" ADD CONSTRAINT "kitchen_courses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_courses" ADD CONSTRAINT "kitchen_courses_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;