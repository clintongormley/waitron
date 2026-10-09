-- `0122_devices_drop_form_factor_trigger.sql`'s trigger, as `0091_devices_recreate_triggers.sql` has it.
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
