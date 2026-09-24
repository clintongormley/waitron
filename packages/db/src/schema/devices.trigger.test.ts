/**
 * The device binding rule: a `kds`-profile device binds a kitchen station and no register, and every
 * other form factor binds a register and no station. The form factor lives in another table, so the
 * rule is two triggers in `packages/db/drizzle/0001_behavioural_triggers.sql`.
 *
 * `scripts/behavioural-triggers.test.ts` pins the same triggers with hand-written SQL; every case here
 * writes through the Drizzle builder, the shape the application writes.
 */
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { seedKitchenStation, seedTenant } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { deviceProfiles } from "./device-profiles.js";
import { devices } from "./devices.js";
import { locations, tills } from "./tenants.js";
import type { LocationId } from "@waitron/shared";

const TOKEN_HASH = "scrypt$00$00";

describe("devices binding-rule trigger (form factor → station XOR register)", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });
  let db: Database;
  let locationId: LocationId;
  let stationId: string;
  let tillId: string;
  let kdsProfileId: string;
  let tillProfileId: string;

  beforeAll(async () => {
    db = suite.db;
    await seedTenant(db);
    const [location] = await db
      .insert(locations)
      .values({ name: "Loc", invoiceLocales: ["es"], operationDescription: "Hostelería" })
      .returning({ id: locations.id });
    locationId = location!.id as LocationId;
    stationId = await seedKitchenStation(db, { locationId });
    const [till] = await db
      .insert(tills)
      .values({ locationId, name: "Till" })
      .returning({ id: tills.id });
    tillId = till!.id;
    const [kds] = await db
      .insert(deviceProfiles)
      .values({ name: "KDS profile", formFactor: "kds" })
      .returning({ id: deviceProfiles.id });
    kdsProfileId = kds!.id;
    const [tillProfile] = await db
      .insert(deviceProfiles)
      .values({ name: "Till profile", formFactor: "till" })
      .returning({ id: deviceProfiles.id });
    tillProfileId = tillProfile!.id;
  });

  async function insertDevice(fields: {
    profileId: string;
    stationId: string | null;
    tillId: string | null;
    label: string;
  }): Promise<void> {
    await db.insert(devices).values({
      locationId,
      deviceProfileId: fields.profileId,
      stationId: fields.stationId,
      tillId: fields.tillId,
      label: fields.label,
      tokenHash: TOKEN_HASH,
    });
  }

  it("accepts a kds-profile device bound to a station and no register", async () => {
    await expect(
      insertDevice({ profileId: kdsProfileId, stationId, tillId: null, label: "KDS ok" }),
    ).resolves.toBeUndefined();
  });

  it("accepts a till-profile device bound to a register and no station", async () => {
    await expect(
      insertDevice({ profileId: tillProfileId, stationId: null, tillId, label: "Till ok" }),
    ).resolves.toBeUndefined();
  });

  it("rejects a kds-profile device with a NULL station", async () => {
    const error = await captureError(() =>
      insertDevice({ profileId: kdsProfileId, stationId: null, tillId: null, label: "KDS bad" }),
    );
    expect(engineErrorMessage(error)).toMatch(/kds device binds a station/);
  });

  it("rejects a till-profile device with a NULL register", async () => {
    const error = await captureError(() =>
      insertDevice({ profileId: tillProfileId, stationId: null, tillId: null, label: "Till bad" }),
    );
    expect(engineErrorMessage(error)).toMatch(/binds a register and no station/);
  });

  it("rejects a kds-profile device that also names a register", async () => {
    const error = await captureError(() =>
      insertDevice({ profileId: kdsProfileId, stationId, tillId, label: "KDS with till" }),
    );
    expect(engineErrorMessage(error)).toMatch(/kds device binds a station/);
  });

  it("rejects a register (non-kds) device that also names a station", async () => {
    // Reaches the `station_id is not null` disjunct, which the NULL-register case cannot.
    const error = await captureError(() =>
      insertDevice({ profileId: tillProfileId, stationId, tillId, label: "Till with station" }),
    );
    expect(engineErrorMessage(error)).toMatch(/binds a register and no station/);
  });

  it("a binding-changing UPDATE is still enforced (the WHEN did not disable it)", async () => {
    await insertDevice({
      profileId: tillProfileId,
      stationId: null,
      tillId,
      label: "Till to break",
    });
    const error = await captureError(() =>
      db.update(devices).set({ stationId }).where(eq(devices.label, "Till to break")),
    );
    expect(engineErrorMessage(error)).toMatch(/binds a register and no station/);
  });

  it("reactivation re-validates the binding: the WHEN watches active false→true (BUG D)", async () => {
    // A profile's form factor may change while its device is inactive, so reactivation must
    // re-validate: without the `active` false→true disjunct in the update trigger's WHEN, the
    // invalid binding lands.
    const [profile] = await db
      .insert(deviceProfiles)
      .values({ name: "Reactivate till", formFactor: "till" })
      .returning({ id: deviceProfiles.id });
    await insertDevice({
      profileId: profile!.id,
      stationId: null,
      tillId,
      label: "Reactivate me",
    });
    await db.update(devices).set({ active: false }).where(eq(devices.label, "Reactivate me"));
    await db
      .update(deviceProfiles)
      .set({ formFactor: "kds" })
      .where(eq(deviceProfiles.id, profile!.id));
    const error = await captureError(() =>
      db.update(devices).set({ active: true }).where(eq(devices.label, "Reactivate me")),
    );
    expect(engineErrorMessage(error)).toMatch(/kds device binds a station/);
  });

  it("a non-binding UPDATE (last_seen_at touch) does not fire the trigger", async () => {
    // This device's binding is valid, so the case would pass with the WHEN gate deleted too. What
    // separates the two is `scripts/behavioural-triggers.test.ts`, "says nothing about an update
    // that touches no binding column".
    await insertDevice({
      profileId: tillProfileId,
      stationId: null,
      tillId,
      label: "Till heartbeat",
    });
    await db
      .update(devices)
      .set({ lastSeenAt: new Date().toISOString() })
      .where(eq(devices.label, "Till heartbeat"));
    const [row] = await db
      .select({ lastSeenAt: devices.lastSeenAt })
      .from(devices)
      .where(eq(devices.label, "Till heartbeat"));
    expect(row!.lastSeenAt).not.toBeNull();
  });

  it("prove-by-deletion: dropping the trigger lets the bad insert succeed", async () => {
    const [stored] = db.all<{ sql: string }>(
      sql`select sql from sqlite_master
           where type = 'trigger' and name = 'device_binding_rule_insert'`,
    );
    expect(stored?.sql, "device_binding_rule_insert must exist to be deleted").toBeDefined();
    try {
      db.run(sql`drop trigger device_binding_rule_insert`);
      // The exact insert the "rejects a kds-profile device with a NULL station" case refuses.
      await insertDevice({
        profileId: kdsProfileId,
        stationId: null,
        tillId: null,
        label: "KDS no-trigger",
      });
      const [counted] = db.all<{ n: number }>(
        sql`select cast(count(*) as int) as n from devices where label = 'KDS no-trigger'`,
      );
      expect(counted!.n).toBe(1);
    } finally {
      if (stored !== undefined) db.run(sql.raw(stored.sql));
      await db.delete(devices).where(eq(devices.label, "KDS no-trigger"));
    }
  });
});
