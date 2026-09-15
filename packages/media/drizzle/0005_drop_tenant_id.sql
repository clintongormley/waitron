ALTER TABLE "media_image_data" DROP CONSTRAINT "media_image_data_image_fk";
--> statement-breakpoint
ALTER TABLE "media_images" DROP CONSTRAINT "media_images_tenant_filename_key";--> statement-breakpoint
ALTER TABLE "media_images" DROP CONSTRAINT "media_images_tenant_id_key";--> statement-breakpoint
ALTER TABLE "media_images" DROP CONSTRAINT "media_images_tenant_id_tenants_id_fk";
--> statement-breakpoint
DROP INDEX "media_images_tenant_date_idx";--> statement-breakpoint
ALTER TABLE "media_image_data" DROP CONSTRAINT "media_image_data_tenant_id_image_id_pk";--> statement-breakpoint
ALTER TABLE "media_image_data" ADD CONSTRAINT "media_image_data_image_id_pk" PRIMARY KEY("image_id");--> statement-breakpoint
ALTER TABLE "media_image_data" ADD CONSTRAINT "media_image_data_image_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media_images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_images_date_idx" ON "media_images" USING btree ("created_at","id");--> statement-breakpoint
ALTER TABLE "media_image_data" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "media_images" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "media_images" ADD CONSTRAINT "media_images_filename_key" UNIQUE("filename");