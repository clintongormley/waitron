-- The binding rule moves into venue-service's `setDeviceKitchenScreens`: a core trigger naming
-- venue-service's tables would make core depend on a module.
DROP TRIGGER `device_binding_rule_insert`;
--> statement-breakpoint
DROP TRIGGER `device_binding_rule_update`;
