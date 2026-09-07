-- The old kind-based CHECKs (devices_station_kind_ck / device_pairing_codes_station_kind_ck, both
-- defined in the baseline custom migration 0001) reference device_kind, so 0003's DROP COLUMN
-- device_kind already dropped them. These IF EXISTS drops make that explicit and idempotent.
ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_station_kind_ck;
--> statement-breakpoint
ALTER TABLE device_pairing_codes DROP CONSTRAINT IF EXISTS device_pairing_codes_station_kind_ck;
--> statement-breakpoint
-- The binding rule (spec §1.3): a device's form factor — read from its profile, NOT a kind column —
-- decides its station/register binding. A kds device binds a station and no register; every other
-- form factor binds a register and no station. `devices` is a `state` table, so this is an ORDINARY
-- constraint trigger (NOT ENABLE ALWAYS / reject_mutation — that idiom is for the append-only ledger
-- tables). The profile is looked up by the same tenant-consistent (tenant_id, device_profile_id) that
-- devices_device_profile_fk enforces, so a NULL form factor means no profile in the tenant.
CREATE OR REPLACE FUNCTION device_binding_rule() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
DECLARE
  ff text;
BEGIN
  -- FOR SHARE row-locks the profile so a concurrent device_profiles form_factor UPDATE (which takes a
  -- FOR NO KEY UPDATE lock on the same row) serialises against this insert/rebind rather than racing it.
  -- Without the lock the two commit interleaved and leave an ACTIVE device whose binding contradicts its
  -- profile: the drift guard (device_profile_form_factor_locked, migration 0005) checks EXISTS(active
  -- device) but cannot see this INSERT while it is uncommitted, and this trigger reads the form factor
  -- without locking it — so each transaction sees a consistent-but-stale picture. The shared lock makes
  -- them wait: whichever commits second re-evaluates and one side is rejected.
  SELECT p.form_factor INTO ff
    FROM device_profiles p
   WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.device_profile_id
   FOR SHARE;
  IF ff IS NULL THEN
    RAISE EXCEPTION 'device % has no profile in its tenant', NEW.id;
  END IF;
  IF ff = 'kds' THEN
    IF NEW.station_id IS NULL OR NEW.till_id IS NOT NULL THEN
      RAISE EXCEPTION 'a kds device binds a station and no register';
    END IF;
  ELSE
    IF NEW.till_id IS NULL OR NEW.station_id IS NOT NULL THEN
      RAISE EXCEPTION 'a % device binds a register and no station', ff;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- TWO triggers, not one AFTER INSERT OR UPDATE, so UPDATEs that touch no binding column (e.g.
-- requireDevice's per-request last_seen_at touch) never re-run the device_profiles lookup. A single
-- INSERT-OR-UPDATE trigger cannot express this: a WHEN referencing OLD is rejected at creation for
-- the INSERT arm ("INSERT trigger's WHEN condition cannot reference OLD values"), and TG_OP is not a
-- SQL column so it cannot appear in a WHEN ("column \"tg_op\" does not exist") — both measured on
-- postgres:18-alpine. So: an unconditional AFTER INSERT, plus an AFTER UPDATE gated on a binding
-- column actually changing. Both call the same function.
CREATE CONSTRAINT TRIGGER device_binding_rule_insert
  AFTER INSERT ON devices
  FOR EACH ROW EXECUTE FUNCTION device_binding_rule();
--> statement-breakpoint
-- The reactivation disjunct (OLD.active = false AND NEW.active = true) re-validates the binding when a
-- device is switched back on. Without it, the WHEN watches only the binding columns, so this sequence
-- lands an invalid binding: deactivate a device, change its referenced profile to an incompatible form
-- factor (the drift guard allows it — it blocks only while a device is ACTIVE), then reactivate. On the
-- active-only UPDATE the WHEN was false, so the trigger never re-ran and the contradiction stuck.
CREATE CONSTRAINT TRIGGER device_binding_rule_update
  AFTER UPDATE ON devices
  FOR EACH ROW
  WHEN (
    OLD.station_id IS DISTINCT FROM NEW.station_id
    OR OLD.till_id IS DISTINCT FROM NEW.till_id
    OR OLD.device_profile_id IS DISTINCT FROM NEW.device_profile_id
    OR (OLD.active = false AND NEW.active = true)
  )
  EXECUTE FUNCTION device_binding_rule();
