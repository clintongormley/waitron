ALTER TABLE "card_readers" DROP CONSTRAINT "card_readers_tenant_fk";--> statement-breakpoint
ALTER TABLE "device_card_readers" DROP CONSTRAINT "device_card_readers_tenant_fk";--> statement-breakpoint
ALTER TABLE "device_card_readers" DROP CONSTRAINT "device_card_readers_device_fk";--> statement-breakpoint
ALTER TABLE "device_card_readers" DROP CONSTRAINT "device_card_readers_reader_fk";--> statement-breakpoint
ALTER TABLE "payment_policy" DROP CONSTRAINT "payment_policy_tenant_fk";--> statement-breakpoint
ALTER TABLE "payment_refunds" DROP CONSTRAINT "payment_refunds_payment_fk";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_working_order_fk";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_sale_fk";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_node_fk";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_reader_fk";--> statement-breakpoint
ALTER TABLE "card_readers" DROP CONSTRAINT "card_readers_tenant_id_key";--> statement-breakpoint
ALTER TABLE "card_readers" DROP CONSTRAINT "card_readers_provider_ref_key";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_tenant_id_key";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_provider_ref_key";--> statement-breakpoint
DROP INDEX "payments_reconcile_idx";--> statement-breakpoint
ALTER TABLE "device_card_readers" DROP CONSTRAINT "device_card_readers_tenant_id_device_id_pk";--> statement-breakpoint
ALTER TABLE "device_card_readers" ADD CONSTRAINT "device_card_readers_device_id_pk" PRIMARY KEY("device_id");--> statement-breakpoint
ALTER TABLE "payment_policy" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "payment_policy" ADD COLUMN "id" integer PRIMARY KEY DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "device_card_readers" ADD CONSTRAINT "device_card_readers_device_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_card_readers" ADD CONSTRAINT "device_card_readers_reader_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."card_readers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_payment_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_working_order_fk" FOREIGN KEY ("working_order_id") REFERENCES "public"."working_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_sale_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_node_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reader_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."card_readers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_reconcile_idx" ON "payments" USING btree ("provider","settled_at");--> statement-breakpoint
ALTER TABLE "card_readers" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "device_card_readers" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "payment_refunds" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "card_readers" ADD CONSTRAINT "card_readers_provider_ref_key" UNIQUE("provider","provider_ref");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_provider_ref_key" UNIQUE("provider","payment_ref");--> statement-breakpoint
ALTER TABLE "payment_policy" ADD CONSTRAINT "payment_policy_singleton_ck" CHECK ("payment_policy"."id" = 1);
