CREATE TABLE "card_readers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "card_readers_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "card_readers_provider_ref_key" UNIQUE("tenant_id","provider","provider_ref")
);
--> statement-breakpoint
ALTER TABLE "card_readers" ADD CONSTRAINT "card_readers_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;