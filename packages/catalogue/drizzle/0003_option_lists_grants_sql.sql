-- Custom SQL migration file, put your code below! --
-- Options lists are mutable authoring configuration, the same shape as product_variants: the app
-- role reads, writes and removes rows, and never owns or truncates the tables.
REVOKE ALL ON "option_lists", "option_labels" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "option_lists", "option_labels" TO app_user;
