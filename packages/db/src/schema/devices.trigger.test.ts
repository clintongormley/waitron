/**
 * The device BINDING RULE: a `kds`-profile device binds a kitchen station and no register, and every
 * other form factor binds a register and no station. The deciding value — the profile's form factor
 * — lives in another table, so no CHECK constraint can express it; the rule is two triggers,
 * `device_binding_rule_insert` and `device_binding_rule_update`, in
 * `packages/db/drizzle/0001_behavioural_triggers.sql`.
 *
 * WHAT THIS SUITE ADDS to `scripts/behavioural-triggers.test.ts`, which pins the same two triggers
 * by name and refuses a write against each arm: every case here goes through the DRIZZLE builder,
 * so it is the shape the application writes — `id`, `enrolled_at` and `created_at` are `$defaultFn`
 * columns applied CLIENT-side, and a rule that only held for hand-written SQL would pass there and
 * fail here.
 */
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { captureError, pgErrorMessage } from "../testing/errors.js";
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

  // Through the Drizzle builder, since `id`, `enrolled_at` and `created_at` are `$defaultFn`
  // columns applied CLIENT-side.
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
    expect(pgErrorMessage(error)).toMatch(/kds device binds a station/);
  });

  it("rejects a till-profile device with a NULL register", async () => {
    const error = await captureError(() =>
      insertDevice({ profileId: tillProfileId, stationId: null, tillId: null, label: "Till bad" }),
    );
    expect(pgErrorMessage(error)).toMatch(/binds a register and no station/);
  });

  it("rejects a kds-profile device that also names a register", async () => {
    const error = await captureError(() =>
      insertDevice({ profileId: kdsProfileId, stationId, tillId, label: "KDS with till" }),
    );
    expect(pgErrorMessage(error)).toMatch(/kds device binds a station/);
  });

  it("rejects a register (non-kds) device that also names a station", async () => {
    // The symmetric ELSE-branch case: a till-profile device that names a valid register AND a
    // stray station. This exercises the `station_id is not null` disjunct, which the NULL-register
    // case above cannot reach.
    const error = await captureError(() =>
      insertDevice({ profileId: tillProfileId, stationId, tillId, label: "Till with station" }),
    );
    expect(pgErrorMessage(error)).toMatch(/binds a register and no station/);
  });

  it("a binding-changing UPDATE is still enforced (the WHEN did not disable it)", async () => {
    // Seed a valid till device, then UPDATE it into a bad state (add a stray station). The update
    // trigger's condition sees station_id change, fires, and the rule rejects — proving the gate
    // narrows WHEN the trigger runs, not WHETHER it enforces.
    await insertDevice({
      profileId: tillProfileId,
      stationId: null,
      tillId,
      label: "Till to break",
    });
    const error = await captureError(() =>
      db.update(devices).set({ stationId }).where(eq(devices.label, "Till to break")),
    );
    expect(pgErrorMessage(error)).toMatch(/binds a register and no station/);
  });

  it("reactivation re-validates the binding: the WHEN watches active false→true (BUG D)", async () => {
    // A device deactivated, its profile then changed to an incompatible form factor (permitted
    // WHILE the device is inactive — the drift guard blocks only ACTIVE devices), must be
    // re-validated when it is switched back on. Without the `active false→true` disjunct in the
    // update trigger's condition, the trigger never re-runs on an active-only change and the
    // invalid binding lands.
    const [profile] = await db
      .insert(deviceProfiles)
      .values({ name: "Reactivate till", formFactor: "till" })
      .returning({ id: deviceProfiles.id });
    // A valid till device (register, no station) on that profile, then deactivated.
    await insertDevice({
      profileId: profile!.id,
      stationId: null,
      tillId,
      label: "Reactivate me",
    });
    await db.update(devices).set({ active: false }).where(eq(devices.label, "Reactivate me"));
    // Flip the profile to kds — allowed because the referencing device is now inactive.
    await db
      .update(deviceProfiles)
      .set({ formFactor: "kds" })
      .where(eq(deviceProfiles.id, profile!.id));
    // Reactivating must now be REJECTED: the profile is kds but the device binds a register and no
    // station.
    const error = await captureError(() =>
      db.update(devices).set({ active: true }).where(eq(devices.label, "Reactivate me")),
    );
    expect(pgErrorMessage(error)).toMatch(/kds device binds a station/);
  });

  it("a non-binding UPDATE (last_seen_at touch) does not fire the trigger", async () => {
    // requireDevice touches last_seen_at on every authenticated request. That UPDATE changes no
    // binding column, so the update trigger's condition is false and the device_profiles lookup
    // never runs — the performance point of the two-trigger split. It must succeed.
    //
    // This device's binding is VALID, so the case would pass with the gate deleted too. What
    // separates the two is the same heartbeat run against a device the rule would refuse:
    // `scripts/behavioural-triggers.test.ts`, "says nothing about an update that touches no binding
    // column".
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

  // Prove by deletion (CLAUDE.md §1/§4): with the trigger dropped, the insert the trigger rejects
  // above now SUCCEEDS — so the trigger is provably what enforces the rule, not a foreign key or a
  // CHECK. The trigger's own text is read back first so it can be recreated afterwards.
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
