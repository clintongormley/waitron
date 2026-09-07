-- The form-factor drift guard (spec §1.3): a device is DEFINED by its profile's form factor, and the
-- binding rule (device_binding_rule_insert / device_binding_rule_update) reads that form factor to decide a device's station/register
-- binding. So a profile's form_factor must not change out from under an ACTIVE device that references
-- it — that would silently invalidate the device's binding without re-running the binding rule (which
-- only fires on writes to `devices`). This BEFORE UPDATE trigger on `device_profiles` refuses the
-- change while any active device in the same tenant points at the profile. `device_profiles` is a
-- `state` table, so this is an ORDINARY trigger (NOT ENABLE ALWAYS / reject_mutation — that idiom is
-- for the append-only ledger tables). The active-device lookup is tenant-scoped by (tenant_id, id), the
-- same tenant-consistent shape devices_device_profile_fk enforces.
CREATE OR REPLACE FUNCTION device_profile_form_factor_locked() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.form_factor <> OLD.form_factor
     AND EXISTS (SELECT 1 FROM devices d
                  WHERE d.tenant_id = NEW.tenant_id
                    AND d.device_profile_id = NEW.id
                    AND d.active) THEN
    RAISE EXCEPTION 'cannot change form factor of a profile in use by an active device';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER device_profile_form_factor_locked
  BEFORE UPDATE ON device_profiles
  FOR EACH ROW EXECUTE FUNCTION device_profile_form_factor_locked();
