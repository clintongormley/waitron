ALTER TABLE "products" ADD CONSTRAINT "products_media_image_fk"
  FOREIGN KEY ("tenant_id", "image") REFERENCES "media_images" ("tenant_id", "filename") ON DELETE RESTRICT;
--> statement-breakpoint
REVOKE ALL ON "media_images", "media_image_data" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "media_images" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "media_image_data" TO app_user;
