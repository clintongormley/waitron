CREATE TABLE "layout_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "layout_profiles_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "layout_profiles_tenant_name_key" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
ALTER TABLE "layout_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "layout_profiles" ADD CONSTRAINT "layout_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;