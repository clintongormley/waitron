-- The next migration rebuilds `parties`, and its rename fails while a trigger body names it.
-- These two cleared the main bill, which that migration drops; nothing replaces them.
DROP TRIGGER working_orders_release_main_bill;
--> statement-breakpoint
DROP TRIGGER working_orders_release_main_bill_on_move;
