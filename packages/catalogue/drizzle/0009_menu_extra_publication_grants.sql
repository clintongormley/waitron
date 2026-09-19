-- Custom SQL migration file, put your code below! --
-- The per-menu extras publication rows are mutable menu configuration, the same shape as
-- extra_lists and menu_item_option_groups: the app role reads, writes and removes rows, and never
-- owns or truncates the tables.
REVOKE ALL ON "menu_item_extra_lists", "menu_item_extra_items" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "menu_item_extra_lists", "menu_item_extra_items" TO app_user;
