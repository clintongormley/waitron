ALTER TABLE "management_account_actions" ADD COLUMN "code_hash" text;--> statement-breakpoint
ALTER TABLE "management_account_actions" ADD COLUMN "code_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "management_account_actions" ADD COLUMN "code_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "management_account_actions" ADD CONSTRAINT "management_account_actions_code_hash_ck" CHECK ("management_account_actions"."code_hash" is null or length("management_account_actions"."code_hash") = 64);--> statement-breakpoint
ALTER TABLE "management_account_actions" ADD CONSTRAINT "management_account_actions_code_attempts_ck" CHECK ("management_account_actions"."code_attempts" >= 0);