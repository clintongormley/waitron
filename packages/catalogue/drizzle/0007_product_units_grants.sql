REVOKE ALL ON "units", "unit_seed_states", "product_units" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "units", "unit_seed_states", "product_units" TO app_user;
