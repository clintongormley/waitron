CREATE TABLE "table_service_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"label" text NOT NULL,
	"color" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "table_service_statuses_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "table_service_statuses_tenant_label_key" UNIQUE("tenant_id","label")
);
--> statement-breakpoint
ALTER TABLE "table_service_statuses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "table_service_statuses" ADD CONSTRAINT "table_service_statuses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;