ALTER TABLE "persons" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_password_hash_ck" CHECK ("persons"."password_hash" is null or length("persons"."password_hash") > 0);--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_totp_secret_ck" CHECK ("persons"."totp_secret" is null or length("persons"."totp_secret") > 0);