import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { useVenueDb } from "../testing/venue-db.js";

describe("devices carry no binding-rule trigger", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  it("keeps the form factor lock on device_profiles after the devices rebuild", () => {
    const [row] = suite.db.all<{ sql: string }>(
      sql`select sql from sqlite_master where type = 'trigger' and name = 'device_profile_form_factor_locked'`,
    );
    expect(row!.sql).toBe(`CREATE TRIGGER device_profile_form_factor_locked
BEFORE UPDATE ON device_profiles
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'cannot change form factor of a profile in use by an active device')
  WHERE new.form_factor <> old.form_factor
    AND exists (
      SELECT 1 FROM devices d WHERE d.device_profile_id = new.id AND d.active <> 0
    );
END`);
  });

  it("holds neither device_binding_rule_insert nor device_binding_rule_update", () => {
    const names = suite.db
      .all<{ name: string }>(sql`select name from sqlite_master where type = 'trigger'`)
      .map((row) => row.name);
    expect(names).toContain("device_profile_form_factor_locked");
    expect(names).not.toContain("device_binding_rule_insert");
    expect(names).not.toContain("device_binding_rule_update");
  });
});
