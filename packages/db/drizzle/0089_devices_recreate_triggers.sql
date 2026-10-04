-- The three triggers `0087_devices_drop_triggers.sql` dropped. `device_profile_form_factor_locked` is
-- `0001_behavioural_triggers.sql`'s, unchanged. The binding pair is `0072_device_binding_watcher_sql.sql`'s
-- with every `till_id` term gone: a `kds` device binds exactly one station or watcher, and any other
-- device binds neither.
CREATE TRIGGER device_profile_form_factor_locked
BEFORE UPDATE ON device_profiles
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'cannot change form factor of a profile in use by an active device')
  WHERE new.form_factor <> old.form_factor
    AND exists (
      SELECT 1 FROM devices d WHERE d.device_profile_id = new.id AND d.active <> 0
    );
END;
--> statement-breakpoint
CREATE TRIGGER device_binding_rule_insert
BEFORE INSERT ON devices
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'device has no profile')
  WHERE NOT exists (SELECT 1 FROM device_profiles p WHERE p.id = new.device_profile_id);

  SELECT raise(abort, 'a kds device binds a station or a watcher')
  WHERE (SELECT p.form_factor FROM device_profiles p WHERE p.id = new.device_profile_id) = 'kds'
    AND (new.station_id IS NULL) = (new.watcher_id IS NULL);

  SELECT raise(abort, 'a non-kds device binds no station or watcher')
  WHERE (SELECT p.form_factor FROM device_profiles p WHERE p.id = new.device_profile_id) <> 'kds'
    AND (new.station_id IS NOT NULL OR new.watcher_id IS NOT NULL);
END;
--> statement-breakpoint
CREATE TRIGGER device_binding_rule_update
BEFORE UPDATE ON devices
FOR EACH ROW
WHEN (
  old.station_id IS NOT new.station_id
  OR old.watcher_id IS NOT new.watcher_id
  OR old.device_profile_id IS NOT new.device_profile_id
  OR (old.active = 0 AND new.active <> 0)
)
BEGIN
  SELECT raise(abort, 'device has no profile')
  WHERE NOT exists (SELECT 1 FROM device_profiles p WHERE p.id = new.device_profile_id);

  SELECT raise(abort, 'a kds device binds a station or a watcher')
  WHERE (SELECT p.form_factor FROM device_profiles p WHERE p.id = new.device_profile_id) = 'kds'
    AND (new.station_id IS NULL) = (new.watcher_id IS NULL);

  SELECT raise(abort, 'a non-kds device binds no station or watcher')
  WHERE (SELECT p.form_factor FROM device_profiles p WHERE p.id = new.device_profile_id) <> 'kds'
    AND (new.station_id IS NOT NULL OR new.watcher_id IS NOT NULL);
END;
