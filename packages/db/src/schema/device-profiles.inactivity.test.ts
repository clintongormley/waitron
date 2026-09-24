import { CORE_MIGRATIONS } from "../migrations.js";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { useVenueDb } from "../testing/venue-db.js";
import { deviceProfiles } from "./device-profiles.js";
import { tenants } from "./tenants.js";

// Column shape and nullability only.

describe("device_profiles.inactivity_timeout_seconds", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });
  let admin: Database;

  // Drizzle rather than a raw insert: `tenants.created_at` is a JavaScript `$defaultFn`, not a SQL
  // DEFAULT.
  beforeAll(async () => {
    admin = suite.db;
    await admin
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant" })
      .onConflictDoNothing({ target: tenants.id });
  });

  it("exists as a nullable integer column (pragma_table_info)", async () => {
    // This pins the storage class, not the unit: `columns.ts` emits `integer` for a count, a money
    // amount and a quantity alike.
    const meta = await admin.execute<{ name: string; type: string; notnull: number }>(sql`
      select name, type, "notnull" from pragma_table_info('device_profiles')
      where name = 'inactivity_timeout_seconds'`);
    expect(meta.rows).toHaveLength(1);
    expect(meta.rows[0]!.type.toLowerCase()).toBe("integer");
    expect(meta.rows[0]!.notnull).toBe(0);
  });

  it("defaults to NULL when omitted on insert, and round-trips a value", async () => {
    const [omitted] = await admin
      .insert(deviceProfiles)
      .values({ name: "No timeout", formFactor: "till" })
      .returning({ seconds: deviceProfiles.inactivityTimeoutSeconds });
    expect(omitted!.seconds).toBeNull();

    const [withValue] = await admin
      .insert(deviceProfiles)
      .values({
        name: "Five minutes",
        formFactor: "phone-portrait",
        inactivityTimeoutSeconds: 300,
      })
      .returning({ seconds: deviceProfiles.inactivityTimeoutSeconds });
    expect(withValue!.seconds).toBe(300);
  });
});
