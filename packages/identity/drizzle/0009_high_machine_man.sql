ALTER TABLE "persons" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_locale_ck" CHECK ("persons"."locale" is null or length("persons"."locale") > 0);