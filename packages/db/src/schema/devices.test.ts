import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { deviceProfiles } from "./device-profiles.js";
import { devices } from "./devices.js";
import { kitchenStations } from "./kitchen-stations.js";
import { locations, tenants } from "./tenants.js";

// What this suite proves is the column mapping and the two foreign keys.
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
const STATION_A = "cccccccc-0000-4000-8000-000000000001";
const STATION_B = "cccccccc-0000-4000-8000-000000000002";
// A kds device profile — a device is DEFINED by its profile (device_profile_id is NOT NULL).
const KDS_PROFILE_A = "eeeeeeee-0000-4000-8000-000000000001";
const KDS_PROFILE_B = "eeeeeeee-0000-4000-8000-000000000002";
// Ids that are never seeded — the negatives for the two foreign keys under test.
const GHOST_LOCATION = "dddddddd-0000-4000-8000-000000000099";
const GHOST_STATION = "cccccccc-0000-4000-8000-000000000099";
// A non-null token_hash fixture (shape only — the DB stores it as opaque text).
const TOKEN_HASH = "scrypt$00$00";

describe("devices schema (columns, FKs, unique)", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  // beforeEach, not beforeAll: `useVenueDb` empties every data table after each test by default, so
  // rows seeded once would be gone for every case after the first — and then every foreign key
  // below would fire for the wrong reason (CLAUDE.md §4).
  beforeEach(async () => {
    const db = suite.db;
    await db
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    // Two locations and a kitchen_station in each: a station-bound device needs a real station,
    // which itself needs an owning location. operation_description is Spanish test DATA, not a
    // schema identifier, exactly as the sibling kitchen-stations test uses 'Hostelería'.
    await db.insert(locations).values([
      {
        id: LOCATION_A,
        name: "Loc A",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      },
      {
        id: LOCATION_B,
        name: "Loc B",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      },
    ]);
    await db.insert(kitchenStations).values([
      { id: STATION_A, locationId: LOCATION_A, name: "Kitchen A" },
      { id: STATION_B, locationId: LOCATION_B, name: "Kitchen B" },
    ]);
    await db.insert(deviceProfiles).values([
      { id: KDS_PROFILE_A, name: "KDS A", formFactor: "kds" },
      { id: KDS_PROFILE_B, name: "KDS B", formFactor: "kds" },
    ]);
  });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  // Seed a kds-profile device bound to `station`. `profile`/`location` default to a real seeded
  // row, overridable to point a foreign key at a row that does not exist. Through the Drizzle
  // builder, since `id`, `enrolled_at` and `created_at` are all `$defaultFn` columns.
  async function seedDevice(
    station: string | null,
    label: string,
    location: string = LOCATION_A,
    profile: string = KDS_PROFILE_A,
  ): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(devices)
        .values({
          locationId: location,
          deviceProfileId: profile,
          stationId: station,
          label,
          tokenHash: TOKEN_HASH,
        })
        .returning({ id: devices.id });
      return row!.id;
    });
  }

  it("devices: exposes every column through the Drizzle export, with the active default", async () => {
    const id = await seedDevice(STATION_A, "Kitchen screen");
    await inTx((tx) =>
      tx.update(devices).set({ lastSeenAt: new Date().toISOString() }).where(eq(devices.id, id)),
    );
    const [row] = await inTx((tx) => tx.select().from(devices).where(eq(devices.id, id)));
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
    const e = await captureError(() => seedDevice(GHOST_STATION, "Ghost station"));
    expect(isRefusal(e, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("devices: the location FK rejects a non-existent location (direct location_id → locations.id)", async () => {
    // A valid station (STATION_A) is supplied so the location FK is the only constraint that can
    // fire.
    const e = await captureError(() => seedDevice(STATION_A, "Ghost location", GHOST_LOCATION));
    expect(isRefusal(e, FOREIGN_KEY_VIOLATION)).toBe(true);
  });
});
