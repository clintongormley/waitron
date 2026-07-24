ALTER TYPE "public"."payment_state" ADD VALUE 'accepted_offline';--> statement-breakpoint
ALTER TYPE "public"."payment_state" ADD VALUE 'settled';--> statement-breakpoint
ALTER TYPE "public"."payment_state" ADD VALUE 'declined';--> statement-breakpoint
CREATE TABLE "payment_policy" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"offline_mode" text NOT NULL,
	"offline_amount_cap" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_policy_offline_mode_ck" CHECK ("payment_policy"."offline_mode" in ('accept_offline', 'cash_only')),
	CONSTRAINT "payment_policy_cap_ck" CHECK ("payment_policy"."offline_amount_cap" >= 0)
);
--> statement-breakpoint
ALTER TABLE "payment_policy" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_policy" ADD CONSTRAINT "payment_policy_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;