ALTER TABLE "categories" DROP COLUMN "name";
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "name" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_key" UNIQUE("tenant_id","id");