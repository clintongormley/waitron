-- Custom SQL migration file, put your code below! --
-- Products and category details reference an image by filename, which media_images_filename_key
-- (0005) now makes unique on its own.
ALTER TABLE "products" ADD CONSTRAINT "products_media_image_fk"
  FOREIGN KEY ("image") REFERENCES "media_images" ("filename") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "category_details" ADD CONSTRAINT "category_details_media_image_fk"
  FOREIGN KEY ("image") REFERENCES "media_images" ("filename") ON DELETE RESTRICT;
