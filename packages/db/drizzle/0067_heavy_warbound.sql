CREATE TYPE "public"."receipt_print_mode" AS ENUM('auto', 'on_request', 'never');--> statement-breakpoint
CREATE TABLE "drawer_opens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"till_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"sale_id" uuid,
	CONSTRAINT "drawer_opens_reason_ck" CHECK ("drawer_opens"."reason" in ('cash_sale', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "drawer_opens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "receipt_print_mode" "receipt_print_mode" DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "tills" ADD COLUMN "receipt_printer_id" uuid;--> statement-breakpoint
ALTER TABLE "drawer_opens" ADD CONSTRAINT "drawer_opens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;