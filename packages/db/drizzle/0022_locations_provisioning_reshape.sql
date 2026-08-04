DROP INDEX "tenants_nif_key";--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "country" text NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "tax_id" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_country_tax_id_key" ON "tenants" USING btree ("country","tax_id");--> statement-breakpoint
ALTER TABLE "tenants" DROP COLUMN "nif";