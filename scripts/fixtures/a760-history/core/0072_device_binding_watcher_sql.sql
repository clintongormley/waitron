-- A KDS screen binds exactly one station or watcher; another device binds a till alone.
DROP TRIGGER IF EXISTS device_binding_rule_insert;--> statement-breakpoint
DROP TRIGGER IF EXISTS device_binding_rule_update;--> statement-breakpoint
CREATE TRIGGER device_binding_rule_insert
BEFORE INSERT ON devices
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'device has no profile')
  WHERE NOT exists (SELECT 1 FROM device_profiles p WHERE p.id = new.device_profile_id);

  SELECT raise(abort, 'a kds device binds a station or a watcher, and no register')
  WHERE (SELECT p.form_factor FROM device_profiles p WHERE p.id = new.device_profile_id) = 'kds'
    AND ((new.station_id IS NULL) = (new.watcher_id IS NULL) OR new.till_id IS NOT NULL);

  SELECT raise(abort, 'a non-kds device binds a register and no station or watcher')
  WHERE (SELECT p.form_factor FROM device_profiles p WHERE p.id = new.device_profile_id) <> 'kds'
    AND (new.till_id IS NULL OR new.station_id IS NOT NULL OR new.watcher_id IS NOT NULL);
END;
--> statement-breakpoint
CREATE TRIGGER device_binding_rule_update
BEFORE UPDATE ON devices
FOR EACH ROW
WHEN (
  old.station_id IS NOT new.station_id
  OR old.watcher_id IS NOT new.watcher_id
  OR old.till_id IS NOT new.till_id
  OR old.device_profile_id IS NOT new.device_profile_id
  OR (old.active = 0 AND new.active <> 0)
)
BEGIN
  SELECT raise(abort, 'device has no profile')
  WHERE NOT exists (SELECT 1 FROM device_profiles p WHERE p.id = new.device_profile_id);

  SELECT raise(abort, 'a kds device binds a station or a watcher, and no register')
  WHERE (SELECT p.form_factor FROM device_profiles p WHERE p.id = new.device_profile_id) = 'kds'
    AND ((new.station_id IS NULL) = (new.watcher_id IS NULL) OR new.till_id IS NOT NULL);

  SELECT raise(abort, 'a non-kds device binds a register and no station or watcher')
  WHERE (SELECT p.form_factor FROM device_profiles p WHERE p.id = new.device_profile_id) <> 'kds'
    AND (new.till_id IS NULL OR new.station_id IS NOT NULL OR new.watcher_id IS NOT NULL);
END;
