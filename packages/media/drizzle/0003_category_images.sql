ALTER TABLE "category_details" ADD CONSTRAINT "category_details_media_image_fk" FOREIGN KEY ("tenant_id", "image") REFERENCES "media_images" ("tenant_id", "filename") ON DELETE RESTRICT;
