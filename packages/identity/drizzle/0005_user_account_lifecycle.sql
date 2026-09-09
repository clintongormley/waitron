ALTER TYPE "public"."person_status" ADD VALUE 'pending' BEFORE 'active';--> statement-breakpoint
ALTER TABLE "persons" DROP CONSTRAINT "persons_pin_hash_ck";--> statement-breakpoint
ALTER TABLE "persons" ALTER COLUMN "pin_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "first_names" text;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "last_names" text;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "telephone" text;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_first_names_ck" CHECK ("persons"."first_names" is null or length("persons"."first_names") > 0);--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_last_names_ck" CHECK ("persons"."last_names" is null or length("persons"."last_names") > 0);--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_telephone_ck" CHECK ("persons"."telephone" is null or length("persons"."telephone") > 0);--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_pin_hash_ck" CHECK ("persons"."pin_hash" is null or length("persons"."pin_hash") > 0);