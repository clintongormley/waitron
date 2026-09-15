import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTransaction } from "../tenancy.js";
import { devices } from "./devices.js";
import { tenants } from "./tenants.js";

// Real Postgres (a template clone), not PGlite: every write below runs as the non-owner
// `app_user`, the deployment role, which PGlite (every connection a superuser) cannot be. The
// cases retain the role switch so the reads and writes still exercise app_user grants.
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
const STATION_A = "cccccccc-0000-4000-8000-000000000001";
const STATION_B = "cccccccc-0000-4000-8000-000000000002";
// A kds device profile per tenant — a device is DEFINED by its profile now (device_profile_id is NOT
// NULL), and a `kds` form factor is what the binding rule requires for a station-bound device.
const KDS_PROFILE_A = "eeeeeeee-0000-4000-8000-000000000001";
const KDS_PROFILE_B = "eeeeeeee-0000-4000-8000-000000000002";
// Ids that are never seeded — the negatives for the two foreign keys under test.
const GHOST_LOCATION = "dddddddd-0000-4000-8000-000000000099";
const GHOST_STATION = "cccccccc-0000-4000-8000-000000000099";
// A non-null token_hash fixture (shape only — the DB stores it as opaque text; the real scrypt
// value comes from hashSecret in a later task).
const TOKEN_HASH = "scrypt$00$00";

describe("devices schema (columns, FKs, unique)", () => {
  const suite = useTemplateDb({ template: "core" });

  // beforeEach, not beforeAll: the suite helper truncates between tests (`resetPerTest`, the
  // default), so rows seeded once would be gone for every case after the first — and then every
  // foreign key below would fire for the wrong reason (CLAUDE.md §4).
  beforeEach(async () => {
    await suite.admin
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    // Two locations and a kitchen_station in each: a station-bound device needs a real station,
    // which itself needs an owning location. operation_description is Spanish test DATA, not a
    // schema identifier, exactly as the sibling kitchen-stations test uses 'Hostelería'.
    await suite.admin.execute(sql`
      insert into locations (id, name, invoice_locales, operation_description) values (${LOCATION_A}, 'Loc A', array['es'], 'Hostelería'),
        (${LOCATION_B}, 'Loc B', array['es'], 'Hostelería')
      on conflict (id) do nothing`);
    await suite.admin.execute(sql`
      insert into kitchen_stations (id, location_id, name) values (${STATION_A}, ${LOCATION_A}, 'Kitchen A'),
        (${STATION_B}, ${LOCATION_B}, 'Kitchen B')
      on conflict (id) do nothing`);
    // Two kds device profiles — the target a station-bound device's device_profile_id points at,
    // and the `kds` form factor the binding rule reads to require a station.
    await suite.admin.execute(sql`
      insert into device_profiles (id, name, form_factor) values (${KDS_PROFILE_A}, 'KDS A', 'kds'),
        (${KDS_PROFILE_B}, 'KDS B', 'kds')
      on conflict (id) do nothing`);
  });

  function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.admin, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  // Seed a kds-profile device bound to `station` (a kds device binds a station and no register — the
  // binding rule, tested in devices.trigger.pg.test.ts). `profile`/`location` default to a real
  // seeded row, overridable to point a foreign key at a row that does not exist.
  async function seedDevice(
    station: string | null,
    label: string,
    location: string = LOCATION_A,
    profile: string = KDS_PROFILE_A,
  ): Promise<string> {
    return asApp(async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into devices (location_id, device_profile_id, station_id, label, token_hash) values (${location}, ${profile}, ${station}, ${label}, ${TOKEN_HASH}) returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  // ---- devices ------------------------------------------------------------------------------

  it("devices: exposes every column through the Drizzle export, with the active default", async () => {
    const id = await seedDevice(STATION_A, "Kitchen screen");
    await asApp((tx) => tx.execute(sql`update devices set last_seen_at = now() where id = ${id}`));
    // Read back through the Drizzle `devices` export (not raw SQL) — exercises the produced table
    // export and its column mapping under the app role.
    const [row] = await asApp((tx) =>
      tx
        .select()
        .from(devices)
        .where(sql`id = ${id}`),
    );
    expect(row!.deviceProfileId).toBe(KDS_PROFILE_A);
    expect(row!.locationId).toBe(LOCATION_A);
    expect(row!.stationId).toBe(STATION_A);
    expect(row!.label).toBe("Kitchen screen");
    expect(row!.active).toBe(true);
    expect(row!.lastSeenAt).not.toBeNull();
  });

  it("devices: the station FK rejects a station_id that names no kitchen_stations row", async () => {
    // Positive control first, so the rejection below is the station FK biting and not the row being
    // malformed: a station that EXISTS is accepted.
    await seedDevice(STATION_B, "Real station");
    // A never-seeded station → 23503 on devices_station_fk. The kds profile satisfies the binding
    // rule (station present, no register), and the location is a real one, so this is the only
    // constraint that can fire.
    const e = await captureError(() => seedDevice(GHOST_STATION, "Ghost station"));
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation on station_id
  });

  it("devices: the location FK rejects a non-existent location (direct location_id → locations.id)", async () => {
    // The direct FK the spec's `shifts` shape uses guarantees referential integrity to `locations`.
    // A never-seeded location → 23503. A valid station (STATION_A) is supplied so the binding rule
    // is satisfied and the ONLY violated constraint is the location FK.
    const e = await captureError(() => seedDevice(STATION_A, "Ghost location", GHOST_LOCATION));
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation on location_id
  });
});
