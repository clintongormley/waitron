-- Custom SQL migration file, put your code below! --
-- Every table in this set is mutable authoring configuration: the app role reads and writes rows,
-- and never owns or truncates a table. Where a table has no DELETE, removal happens by
-- deactivating or detaching the row instead.
--
-- This migration consolidates the grants that used to be spread across five custom migrations, one
-- per feature that added tables. They came back together when the set was regenerated to stop the
-- baseline creating `menu_item_option_groups` and `menu_item_options`, whose foreign keys pointed at
-- core tables this change drops.
REVOKE ALL ON "menu_sections", "menu_items" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "menu_sections", "menu_items" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "content_languages" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "content_languages" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON category_details, product_categories TO app_user;
--> statement-breakpoint
GRANT DELETE ON categories TO app_user;
--> statement-breakpoint
REVOKE ALL ON "units", "unit_seed_states", "product_units" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "units", "unit_seed_states", "product_units" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON product_variants, menu_item_variants TO app_user;
--> statement-breakpoint
REVOKE ALL ON "option_lists", "option_labels" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "option_lists", "option_labels" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "extra_lists", "extra_list_items" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "extra_lists", "extra_list_items" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "menu_item_extra_lists", "menu_item_extra_items" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "menu_item_extra_lists", "menu_item_extra_items" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "product_modifiers" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "product_modifiers" TO app_user;
