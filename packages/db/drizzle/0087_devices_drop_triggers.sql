-- The next migration rebuilds `devices` without `till_id`. A rebuild drops the triggers ON `devices`
-- silently, and its rename fails while a trigger on another table names `devices`, so the three go
-- here and come back in `0089_devices_recreate_triggers.sql`.
DROP TRIGGER device_binding_rule_insert;
--> statement-breakpoint
DROP TRIGGER device_binding_rule_update;
--> statement-breakpoint
DROP TRIGGER device_profile_form_factor_locked;
