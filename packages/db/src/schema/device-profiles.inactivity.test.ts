import { CORE_MIGRATIONS } from "../migrations.js";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { useVenueDb } from "../testing/venue-db.js";
import { deviceProfiles } from "./device-profiles.js";
import { tenants } from "./tenants.js";

// The core migration chain (0011_device_profile_inactivity_timeout_sql) adds a nullable
// `inactivity_timeout_seconds` integer to `device_profiles`. This is about column shape and
// nullability, not grants or triggers (CLAUDE.md §4). The real-PG grant path is covered by the
// app-role suites in packages/layouts.

describe("device_profiles.inactivity_timeout_seconds", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });
  let admin: Database;

  // Drizzle rather than a raw insert: `tenants.created_at` is `$defaultFn(now)`, a JavaScript
  // generator rather than a SQL DEFAULT, so the raw statement reached nothing to fill it and the
  // whole suite died in `beforeAll` with `NOT NULL constraint failed: tenants.created_at`, both
  // cases reporting `skipped` (measured on this suite, node v26.7.0).
  beforeAll(async () => {
    admin = suite.db;
    await admin
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant" })
      .onConflictDoNothing({ target: tenants.id });
  });

  it("exists as a nullable integer column (pragma_table_info)", async () => {
    // `information_schema.columns` does not exist on this engine — run as written this statement
    // died with `no such table: information_schema.columns`. `pragma_table_info` is the
    // replacement, following `packages/payments/src/migrations.test.ts`: `type` for the declared
    // type and `notnull` (1 or 0) for `is_nullable`'s 'NO'/'YES'.
    //
    // BOTH halves survive here, unlike the json columns in `catalogue.test.ts`: the column is
    // `count("inactivity_timeout_seconds")`, which emits `integer`, and the pragma reports
    // `INTEGER`. What the type no longer separates is one integer MEANING from another —
    // `packages/db/src/schema/columns.ts` emits `integer` for a count, a money amount and a
    // quantity alike (CLAUDE.md §3) — so this assertion pins the storage class, not the unit.
    const meta = await admin.execute<{ name: string; type: string; notnull: number }>(sql`
      select name, type, "notnull" from pragma_table_info('device_profiles')
      where name = 'inactivity_timeout_seconds'`);
    expect(meta.rows).toHaveLength(1);
    expect(meta.rows[0]!.type.toLowerCase()).toBe("integer");
    expect(meta.rows[0]!.notnull).toBe(0);
  });

  it("defaults to NULL when omitted on insert, and round-trips a value", async () => {
    // Drizzle for the inserts: `device_profiles.id` is `$defaultFn(newId)`, so a raw insert
    // omitting it is refused `NOT NULL constraint failed: device_profiles.id` (measured on the
    // sibling suite `device-profiles.fk.test.ts` before the same change).
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
