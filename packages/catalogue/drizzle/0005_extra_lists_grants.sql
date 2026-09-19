-- Custom SQL migration file, put your code below! --
-- Extras lists are mutable authoring configuration, the same shape as product_variants and
-- option_lists: the app role reads, writes and removes rows, and never owns or truncates the tables.
REVOKE ALL ON "extra_lists", "extra_list_items" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "extra_lists", "extra_list_items" TO app_user;
