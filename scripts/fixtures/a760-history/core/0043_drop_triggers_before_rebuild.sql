-- The next migration rebuilds `dining_tables`, `parties` and `service_commands`. Its renames fail
-- while a trigger body names a table the rebuild has dropped, and a trigger ON a rebuilt table
-- would be dropped with it silently, so every trigger that is either goes here and comes back in
-- `0045_recreate_triggers_after_rebuild.sql`.
DROP TRIGGER parties_clear_table_status;
--> statement-breakpoint
DROP TRIGGER working_orders_release_main_bill;
--> statement-breakpoint
DROP TRIGGER working_orders_release_main_bill_on_move;
