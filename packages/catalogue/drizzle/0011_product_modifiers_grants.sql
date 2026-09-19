-- Custom SQL migration file, put your code below! --
-- A product's attachment rows are mutable authoring configuration, the same shape as extra_lists
-- and product_option_groups: the app role reads, writes and removes rows, and never owns or
-- truncates the table.
REVOKE ALL ON "product_modifiers" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "product_modifiers" TO app_user;
