-- `0083_working_orders_drop_till.sql` rebuilds `working_orders` (`0082` only adds columns to it).
-- A rename fails while a trigger body names a table the rebuild has dropped, and a trigger ON a
-- rebuilt table would be dropped with it silently, so every trigger that is either goes here and
-- comes back in `0084_working_orders_recreate_triggers.sql`.
DROP TRIGGER working_orders_release_main_bill;
--> statement-breakpoint
DROP TRIGGER working_orders_release_main_bill_on_move;
--> statement-breakpoint
DROP TRIGGER working_orders_enforce_transition;
--> statement-breakpoint
DROP TRIGGER working_order_lines_require_open_parent_insert;
--> statement-breakpoint
DROP TRIGGER working_order_lines_require_open_parent_update;
--> statement-breakpoint
DROP TRIGGER working_order_lines_require_open_parent_delete;
--> statement-breakpoint
DROP TRIGGER working_order_lines_check_locales_insert;
--> statement-breakpoint
DROP TRIGGER working_order_lines_check_locales_update;
--> statement-breakpoint
DROP TRIGGER working_order_lines_check_variant_locales_insert;
--> statement-breakpoint
DROP TRIGGER working_order_lines_check_variant_locales_update;
