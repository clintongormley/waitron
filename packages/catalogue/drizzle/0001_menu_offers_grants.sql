-- Menu authoring is mutable configuration. Remove offers by deactivating or detaching them; the
-- app role never owns or truncates these tables.
REVOKE ALL ON "menu_sections", "menu_items", "menu_item_option_groups", "menu_item_options" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "menu_sections", "menu_items" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "menu_item_option_groups", "menu_item_options" TO app_user;
