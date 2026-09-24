// The `device_profile_form_factor_locked` trigger. Each mutating case creates its own profile so the
// suite stays order-independent.
//
// Not covered: a device insert racing a form-factor change. What serialises the two is the venue
// file's write queue (`packages/store/src/write-queue.ts`), and nothing here exercises it.
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FORM_FACTOR_REFUSAL } from "../trigger-refusals.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
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

  async function freshKdsProfile(): Promise<string> {
    profileSeq += 1;
    const [row] = await db
      .insert(deviceProfiles)
      .values({ name: `KDS profile ${profileSeq}`, formFactor: "kds" })
      .returning({ id: deviceProfiles.id });
    return row!.id;
  }

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
    expect(engineErrorMessage(error)).toBe(FORM_FACTOR_REFUSAL);
  });

  it("allows changing form_factor when the referencing device is INACTIVE (negative control)", async () => {
    const profileId = await freshKdsProfile();
    await insertKdsDevice(profileId, false, "Inactive kds");
    await db
      .update(deviceProfiles)
      .set({ formFactor: "till" })
      .where(eq(deviceProfiles.id, profileId));
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
    // The guard keys on a change of form factor, not on an active device being present.
    const profileId = await freshKdsProfile();
    await insertKdsDevice(profileId, true, "Active kds no-op");
    await db
      .update(deviceProfiles)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(deviceProfiles.id, profileId));
    expect(await formFactorOf(profileId)).toBe("kds");
  });

  // The drop is undone by recreating the trigger from the text SQLite stored for it; the mutated
  // profile is one no other case reads.
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
    // With the trigger back, the change is refused again, so the rest of the suite keeps its guard.
    const again = await captureError(() =>
      db.update(deviceProfiles).set({ formFactor: "kds" }).where(eq(deviceProfiles.id, profileId)),
    );
    expect(engineErrorMessage(again)).toBe(FORM_FACTOR_REFUSAL);
  });
});
