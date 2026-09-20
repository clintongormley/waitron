ALTER TABLE "payment_policy" ALTER COLUMN "offline_amount_cap" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "payment_refunds" ALTER COLUMN "amount" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "amount" SET DATA TYPE bigint;