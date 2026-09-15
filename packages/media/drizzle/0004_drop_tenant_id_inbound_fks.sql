-- Custom SQL migration file, put your code below! --
-- The two foreign keys onto media_images(tenant_id, filename) are dropped before the next migration
-- removes that unique key and media_images.tenant_id; 0006 recreates them on the image column alone.
ALTER TABLE "products" DROP CONSTRAINT "products_media_image_fk";
--> statement-breakpoint
ALTER TABLE "category_details" DROP CONSTRAINT "category_details_media_image_fk";
