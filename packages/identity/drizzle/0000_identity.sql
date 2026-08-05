CREATE TYPE "public"."person_role" AS ENUM('staff', 'supervisor', 'manager', 'admin');--> statement-breakpoint
CREATE TYPE "public"."person_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"pin_hash" text NOT NULL,
	"role" "person_role" DEFAULT 'staff' NOT NULL,
	"status" "person_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persons_display_name_ck" CHECK (length("persons"."display_name") > 0),
	CONSTRAINT "persons_pin_hash_ck" CHECK (length("persons"."pin_hash") > 0)
);
--> statement-breakpoint
ALTER TABLE "persons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "persons_tenant_id_idx" ON "persons" USING btree ("tenant_id");