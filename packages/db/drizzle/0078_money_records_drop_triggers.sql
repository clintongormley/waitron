-- The next migration rebuilds `sales`, `bill_payments`, `bill_payment_refunds` and
-- `unpaid_departures` without `till_id`. Its renames fail while a trigger body names a table the
-- rebuild has dropped, and a trigger ON a rebuilt table would be dropped with it silently, so every
-- such trigger this set writes goes here and comes back in
-- `0080_money_records_recreate_triggers.sql`.
-- The append-only pairs on `sales` and `unpaid_departures` are not this set's: the rebuild drops
-- them, and `applyMigrations` installs them again once the set has migrated.
DROP TRIGGER bill_payments_guard_update;
--> statement-breakpoint
DROP TRIGGER bill_payments_no_delete;
--> statement-breakpoint
DROP TRIGGER bill_payment_refunds_guard_update;
--> statement-breakpoint
DROP TRIGGER bill_payment_refunds_no_delete;
--> statement-breakpoint
DROP TRIGGER sale_settlements_check_coverage;
