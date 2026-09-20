ALTER TABLE "payment_policy" ALTER COLUMN "offline_amount_cap" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "payment_refunds" ALTER COLUMN "amount" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "amount" SET DATA TYPE bigint;
--> statement-breakpoint
-- Same repair as the core and catalogue sets: `ALTER COLUMN ... SET DATA TYPE` leaves each check
-- describing the decimal it was written over (`(amount)::numeric > (0)::numeric`). Behaviour is
-- unchanged; what changes is that a migrated database again matches what the schema declares.
-- Taken by applying the migrations and reading pg_get_constraintdef back, there being no
-- conformance guard for a module set.
ALTER TABLE "payment_policy" DROP CONSTRAINT "payment_policy_cap_ck";--> statement-breakpoint
ALTER TABLE "payment_policy" ADD CONSTRAINT "payment_policy_cap_ck" CHECK ("payment_policy"."offline_amount_cap" >= 0);--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_amount_ck";--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_ck" CHECK ("payments"."amount" > 0);--> statement-breakpoint
ALTER TABLE "payment_refunds" DROP CONSTRAINT "payment_refunds_amount_ck";--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_amount_ck" CHECK ("payment_refunds"."amount" > 0);
