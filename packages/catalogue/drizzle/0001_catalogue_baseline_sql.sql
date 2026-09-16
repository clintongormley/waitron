-- Custom SQL migration file, put your code below! --
-- Menu authoring is mutable configuration. Remove offers by deactivating or detaching them; the
-- app role never owns or truncates these tables.
REVOKE ALL ON "menu_sections", "menu_items", "menu_item_option_groups", "menu_item_options" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "menu_sections", "menu_items" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "menu_item_option_groups", "menu_item_options" TO app_user;
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
