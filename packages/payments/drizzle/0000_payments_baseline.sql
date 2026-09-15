CREATE TYPE "public"."payment_refund_state" AS ENUM('succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_state" AS ENUM('attempting', 'captured', 'voided', 'refunded', 'partially_refunded', 'failed', 'accepted_offline', 'settled', 'declined', 'initiated');--> statement-breakpoint
CREATE TABLE "card_readers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	"unpaired_at" timestamp with time zone,
	CONSTRAINT "card_readers_provider_ref_key" UNIQUE("provider","provider_ref")
);
--> statement-breakpoint
CREATE TABLE "device_card_readers" (
	"device_id" uuid NOT NULL,
	"reader_id" uuid NOT NULL,
	CONSTRAINT "device_card_readers_device_id_pk" PRIMARY KEY("device_id")
);
--> statement-breakpoint
CREATE TABLE "payment_policy" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"offline_mode" text NOT NULL,
	"offline_amount_cap" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_policy_singleton_ck" CHECK ("payment_policy"."id" = 1),
	CONSTRAINT "payment_policy_offline_mode_ck" CHECK ("payment_policy"."offline_mode" in ('accept_offline', 'cash_only')),
	CONSTRAINT "payment_policy_cap_ck" CHECK ("payment_policy"."offline_amount_cap" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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
	"working_order_id" uuid NOT NULL,
	"sale_id" uuid,
	"node_id" uuid,
	"reader_id" uuid,
	"provider" text NOT NULL,
	"payment_ref" text NOT NULL,
	"external_ref" text,
	"card_scheme" text,
	"card_last4" text,
	"card_entry_mode" text,
	"card_auth_code" text,
	"amount" numeric(12, 2) NOT NULL,
	"state" "payment_state" NOT NULL,
	"settled_at" timestamp with time zone,
	"reconcile_remediated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_ref_key" UNIQUE("provider","payment_ref"),
	CONSTRAINT "payments_amount_ck" CHECK ("payments"."amount" > 0),
	CONSTRAINT "payments_card_last4_ck" CHECK ("payments"."card_last4" is null or length("payments"."card_last4") = 4),
	CONSTRAINT "payments_card_entry_mode_ck" CHECK ("payments"."card_entry_mode" is null or "payments"."card_entry_mode" in ('contactless','chip','swipe','unknown'))
);
--> statement-breakpoint
ALTER TABLE "device_card_readers" ADD CONSTRAINT "device_card_readers_device_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_card_readers" ADD CONSTRAINT "device_card_readers_reader_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."card_readers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_payment_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_working_order_fk" FOREIGN KEY ("working_order_id") REFERENCES "public"."working_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_sale_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_node_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reader_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."card_readers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_refunds_payment_idx" ON "payment_refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payments_working_order_idx" ON "payments" USING btree ("working_order_id");--> statement-breakpoint
CREATE INDEX "payments_sale_idx" ON "payments" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "payments_reconcile_idx" ON "payments" USING btree ("provider","settled_at");