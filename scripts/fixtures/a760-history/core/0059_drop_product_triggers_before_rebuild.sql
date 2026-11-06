-- Custom SQL migration file, put your code below! --
-- The next migration rebuilds products and categories. Drop triggers on products and triggers
-- whose bodies name it before the rebuild; core and media recreate them afterwards.
DROP TRIGGER IF EXISTS products_variant_one_level_insert;--> statement-breakpoint
DROP TRIGGER IF EXISTS products_variant_parent_fixed_update;--> statement-breakpoint
DROP TRIGGER IF EXISTS products_id_fixed_update;--> statement-breakpoint
DROP TRIGGER IF EXISTS products_ordering_check_insert;--> statement-breakpoint
DROP TRIGGER IF EXISTS products_ordering_check_update;--> statement-breakpoint
DROP TRIGGER IF EXISTS products_media_image_fk_insert;--> statement-breakpoint
DROP TRIGGER IF EXISTS products_media_image_fk_update;--> statement-breakpoint
DROP TRIGGER IF EXISTS products_media_image_fk_parent_delete;--> statement-breakpoint
DROP TRIGGER IF EXISTS products_media_image_fk_parent_rename;
