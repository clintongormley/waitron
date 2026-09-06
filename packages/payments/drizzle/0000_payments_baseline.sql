CREATE TYPE "public"."payment_refund_state" AS ENUM('succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_state" AS ENUM('attempting', 'captured', 'voided', 'refunded', 'partially_refunded', 'failed', 'accepted_offline', 'settled', 'declined', 'initiated');--> statement-breakpoint
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
CREATE TABLE "payment_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"payment_ref" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"state" "payment_refund_state" NOT NULL,
	"authorized_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_refunds_amount_ck" CHECK ("payment_refunds"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"working_order_id" uuid NOT NULL,
	"sale_id" uuid,
	"node_id" uuid,
	"provider" text NOT NULL,
	"payment_ref" text NOT NULL,
	"external_ref" text,
	"amount" numeric(12, 2) NOT NULL,
	"state" "payment_state" NOT NULL,
	"settled_at" timestamp with time zone,
	"reconcile_remediated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payments_provider_ref_key" UNIQUE("tenant_id","provider","payment_ref"),
	CONSTRAINT "payments_amount_ck" CHECK ("payments"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "payment_policy" ADD CONSTRAINT "payment_policy_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_payment_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."payments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_working_order_fk" FOREIGN KEY ("tenant_id","working_order_id") REFERENCES "public"."working_orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_sale_fk" FOREIGN KEY ("tenant_id","sale_id") REFERENCES "public"."sales"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_node_fk" FOREIGN KEY ("tenant_id","node_id") REFERENCES "public"."nodes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_refunds_payment_idx" ON "payment_refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payments_working_order_idx" ON "payments" USING btree ("working_order_id");--> statement-breakpoint
CREATE INDEX "payments_sale_idx" ON "payments" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "payments_reconcile_idx" ON "payments" USING btree ("tenant_id","provider","settled_at");