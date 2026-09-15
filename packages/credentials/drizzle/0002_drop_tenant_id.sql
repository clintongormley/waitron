ALTER TABLE "tenant_credentials" DROP CONSTRAINT "tenant_credentials_tenant_fk";
--> statement-breakpoint
ALTER TABLE "tenant_credentials" DROP CONSTRAINT "tenant_credentials_pk";
--> statement-breakpoint
ALTER TABLE "tenant_credentials" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "tenant_credentials" ADD CONSTRAINT "tenant_credentials_pk" PRIMARY KEY("purpose");
