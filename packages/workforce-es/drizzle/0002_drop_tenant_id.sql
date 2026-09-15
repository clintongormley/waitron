ALTER TABLE "convenio_config" DROP CONSTRAINT "convenio_config_tenant_location_uq";--> statement-breakpoint
ALTER TABLE "convenio_config" DROP CONSTRAINT "convenio_config_tenant_fk";
--> statement-breakpoint
DROP INDEX "convenio_config_tenant_id_idx";--> statement-breakpoint
ALTER TABLE "convenio_config" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "convenio_config" ADD CONSTRAINT "convenio_config_location_uq" UNIQUE("location_id");