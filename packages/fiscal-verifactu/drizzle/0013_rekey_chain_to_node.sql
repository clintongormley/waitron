ALTER TABLE "cadenas" DROP CONSTRAINT "cadenas_till_id_tills_id_fk";
--> statement-breakpoint
ALTER TABLE "registro_sif" DROP CONSTRAINT "registro_sif_till_id_tills_id_fk";
--> statement-breakpoint
DROP INDEX "registros_tenant_till_secuencia_uq";--> statement-breakpoint
DROP INDEX "registros_till_secuencia_idx";--> statement-breakpoint
DROP INDEX "registro_sif_activo_uq";--> statement-breakpoint
ALTER TABLE "cadenas" DROP CONSTRAINT "cadenas_tenant_id_till_id_pk";--> statement-breakpoint
ALTER TABLE "cadenas" ALTER COLUMN "node_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "registro_sif" ALTER COLUMN "node_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "registros_facturacion" ALTER COLUMN "node_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cadenas" ADD CONSTRAINT "cadenas_tenant_id_node_id_pk" PRIMARY KEY("tenant_id","node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registros_tenant_node_secuencia_uq" ON "registros_facturacion" USING btree ("tenant_id","node_id","secuencia");--> statement-breakpoint
CREATE INDEX "registros_node_secuencia_idx" ON "registros_facturacion" USING btree ("tenant_id","node_id","secuencia");--> statement-breakpoint
CREATE UNIQUE INDEX "registro_sif_activo_uq" ON "registro_sif" USING btree ("tenant_id","node_id") WHERE "registro_sif"."revocado_en" is null;--> statement-breakpoint
ALTER TABLE "cadenas" DROP COLUMN "till_id";--> statement-breakpoint
ALTER TABLE "registro_sif" DROP COLUMN "till_id";