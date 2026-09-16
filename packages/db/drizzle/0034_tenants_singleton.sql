ALTER TABLE "tenants" ALTER COLUMN "id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_singleton_ck" CHECK ("tenants"."id" = 1);