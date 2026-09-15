-- Custom SQL migration file, put your code below! --
-- The foreign key onto media_images(tenant_id, filename) is dropped before the next migration
-- removes that unique key and media_images.tenant_id; 0006 recreates it on the image column alone.
ALTER TABLE "products" DROP CONSTRAINT "products_media_image_fk";
