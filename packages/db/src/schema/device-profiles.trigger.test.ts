// This suite exercises the form-factor drift-guard trigger (`device_profile_form_factor_locked`),
// which the SQLite migration set restores in `packages/db/drizzle/0001_behavioural_triggers.sql`.
// Each mutating case creates its OWN profile so the suite stays order-independent.
//
// LOSS, from the storage swap: the concurrency case is deleted. It raced a device INSERT against a
// form_factor change on two backends and proved that the `for share` row lock the binding-rule
// trigger took made the second transaction BLOCK rather than interleave. SQLite admits one writer
// per file and has no row locks at all, so there is no second backend to race and no lock to
// observe; `withTransaction` runs every write body inside the venue file's write queue
// (`packages/store/src/write-queue.ts`), which is what serialises them now. That is a different
// mechanism and this suite no longer says anything about it —
// `packages/catalogue/test/fixtures.ts`'s `racePair` is the shape that asks the question on this
// engine, and nothing here uses it.
//
// The binding-rule triggers that case leaned on are themselves intact: `device_binding_rule_insert`
// and `_update`, in the same `packages/db/drizzle/0001_behavioural_triggers.sql`, covered by
// `packages/db/src/schema/devices.trigger.test.ts`. It is the LOCK they took, and the race that
// observed it, that this suite no longer has.
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FORM_FACTOR_REFUSAL } from "../trigger-refusals.js";
import { captureError, pgErrorMessage } from "../testing/errors.js";
import { seedKitchenStation, seedTenant } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { deviceProfiles } from "./device-profiles.js";
import { devices } from "./devices.js";
import { locations } from "./tenants.js";
import type { LocationId } from "@waitron/shared";

const TOKEN_HASH = "scrypt$00$00";

describe("device_profiles form-factor drift guard (locked while an active device uses it)", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });
  let db: Database;
  let locationId: LocationId;
  let stationId: string;
  let profileSeq = 0;

  beforeAll(async () => {
    db = suite.db;
    await seedTenant(db);
    const [location] = await db
      .insert(locations)
      .values({
        name: "Loc",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      })
      .returning({ id: locations.id });
    locationId = location!.id as LocationId;
    stationId = await seedKitchenStation(db, { locationId });
  });

  // A fresh `kds` profile per case, so a form_factor mutation in one case never leaks into another.
  // Through the Drizzle builder, since `id`, `created_at` and `updated_at` are `$defaultFn` columns
  // applied CLIENT-side.
  async function freshKdsProfile(): Promise<string> {
    profileSeq += 1;
    const [row] = await db
      .insert(deviceProfiles)
      .values({ name: `KDS profile ${profileSeq}`, formFactor: "kds" })
      .returning({ id: deviceProfiles.id });
    return row!.id;
  }

  /** A kds device bound to the station. */
  async function insertKdsDevice(profileId: string, active: boolean, label: string): Promise<void> {
    await db.insert(devices).values({
      locationId,
      deviceProfileId: profileId,
      stationId,
      tillId: null,
      label,
      tokenHash: TOKEN_HASH,
      active,
    });
  }

  async function formFactorOf(profileId: string): Promise<string> {
    const [row] = await db
      .select({ formFactor: deviceProfiles.formFactor })
      .from(deviceProfiles)
      .where(eq(deviceProfiles.id, profileId));
    return row!.formFactor;
  }

  it("rejects changing form_factor while an ACTIVE device references the profile", async () => {
    const profileId = await freshKdsProfile();
    await insertKdsDevice(profileId, true, "Active kds");
    const error = await captureError(() =>
      db.update(deviceProfiles).set({ formFactor: "till" }).where(eq(deviceProfiles.id, profileId)),
    );
    expect(pgErrorMessage(error)).toBe(FORM_FACTOR_REFUSAL);
  });

  it("allows changing form_factor when the referencing device is INACTIVE (negative control)", async () => {
    const profileId = await freshKdsProfile();
    await insertKdsDevice(profileId, false, "Inactive kds");
    await db
      .update(deviceProfiles)
      .set({ formFactor: "till" })
      .where(eq(deviceProfiles.id, profileId));
    // Confirm the control succeeded for the reason we think: the value really changed.
    expect(await formFactorOf(profileId)).toBe("till");
  });

  it("allows changing form_factor when NO device references the profile (negative control)", async () => {
    const profileId = await freshKdsProfile();
    await db
      .update(deviceProfiles)
      .set({ formFactor: "till" })
      .where(eq(deviceProfiles.id, profileId));
    expect(await formFactorOf(profileId)).toBe("till");
  });

  it("allows a no-op UPDATE that leaves form_factor unchanged, even with an active device", async () => {
    // The guard fires only when the new form factor differs from the old. An UPDATE that re-writes
    // the same value (touching updated_at, say) with an active device present must pass — proving
    // the guard keys on the CHANGE, not the mere presence of an active device.
    const profileId = await freshKdsProfile();
    await insertKdsDevice(profileId, true, "Active kds no-op");
    await db
      .update(deviceProfiles)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(deviceProfiles.id, profileId));
    expect(await formFactorOf(profileId)).toBe("kds");
  });

  // Prove by deletion (CLAUDE.md §1/§4): with the trigger dropped, the form_factor change the guard
  // rejects above now SUCCEEDS — so the trigger is provably what enforces the rule.
  //
  // The PostgreSQL version did this inside a ROLLED-BACK transaction so neither the drop nor the
  // mutated row outlived the case. `withTransaction` IS this file's one write transaction
  // (`packages/db/src/tenancy.ts`), so the drop is undone by recreating the trigger from the text
  // SQLite stored for it, and the mutated profile is a fresh one no other case reads.
  it("prove-by-deletion: dropping the trigger lets the locked change succeed", async () => {
    const profileId = await freshKdsProfile();
    await insertKdsDevice(profileId, true, "Active kds for deletion");
    const [stored] = db.all<{ sql: string }>(
      sql`select sql from sqlite_master
           where type = 'trigger' and name = 'device_profile_form_factor_locked'`,
    );
    expect(stored?.sql).toContain("form factor");
    try {
      db.run(sql`drop trigger device_profile_form_factor_locked`);
      await db
        .update(deviceProfiles)
        .set({ formFactor: "till" })
        .where(eq(deviceProfiles.id, profileId));
      expect(await formFactorOf(profileId)).toBe("till");
    } finally {
      db.run(sql.raw(stored!.sql));
    }
    // And with the trigger back, the same change is refused again — so the restore is real and the
    // rest of the suite is not running against a database missing its guard.
    const again = await captureError(() =>
      db.update(deviceProfiles).set({ formFactor: "kds" }).where(eq(deviceProfiles.id, profileId)),
    );
    expect(pgErrorMessage(again)).toBe(FORM_FACTOR_REFUSAL);
  });
});
