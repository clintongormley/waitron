import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  captureError,
  deviceProfiles,
  isUniqueViolation,
  tenants,
  withTransaction,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { PAYMENTS_MIGRATIONS } from "../migrations.js";
import { freshNif } from "../../test/seed.js";
import { cardReaders } from "./card-readers.js";
import { deviceProfileCardReaders } from "./device-profile-card-readers.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

async function seed(db: Database) {
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: freshNif(), legalName: "Test SL" })
    .onConflictDoNothing({ target: tenants.id });
  const profiles = await db
    .insert(deviceProfiles)
    .values(["Profile A", "Profile B"].map((name) => ({ name, formFactor: "till" as const })))
    .returning({ id: deviceProfiles.id });
  const readers = await db
    .insert(cardReaders)
    .values(
      ["rdr_1", "rdr_2"].map((providerRef) => ({
        provider: "sumup",
        providerRef,
        name: providerRef,
      })),
    )
    .returning({ id: cardReaders.id });
  return {
    profileA: profiles[0]!.id,
    profileB: profiles[1]!.id,
    reader1: readers[0]!.id,
    reader2: readers[1]!.id,
  };
}

describe("device_profile_card_readers", () => {
  it("refuses a second default reader for one profile", async () => {
    const { profileA, reader1, reader2 } = await seed(suite.db);
    await withTransaction(suite.db, (tx) =>
      tx.insert(deviceProfileCardReaders).values({
        deviceProfileId: profileA,
        readerId: reader1,
        position: 0,
        isDefault: true,
      }),
    );
    const e = await captureError(() =>
      withTransaction(suite.db, (tx) =>
        tx.insert(deviceProfileCardReaders).values({
          deviceProfileId: profileA,
          readerId: reader2,
          position: 1,
          isDefault: true,
        }),
      ),
    );
    expect(isUniqueViolation(e)).toBe(true);
  });

  it("one default per profile, beside other listed readers and another profile's default, is accepted", async () => {
    const { profileA, profileB, reader1, reader2 } = await seed(suite.db);
    await withTransaction(suite.db, (tx) =>
      tx.insert(deviceProfileCardReaders).values([
        { deviceProfileId: profileA, readerId: reader1, position: 0, isDefault: true },
        { deviceProfileId: profileA, readerId: reader2, position: 1 },
        { deviceProfileId: profileB, readerId: reader1, position: 0, isDefault: true },
      ]),
    );
    const rows = await suite.db
      .select()
      .from(deviceProfileCardReaders)
      .where(eq(deviceProfileCardReaders.deviceProfileId, profileA));
    expect(rows.map((r) => [r.readerId, r.position, r.isDefault]).sort()).toEqual(
      [
        [reader1, 0, true],
        [reader2, 1, false],
      ].sort(),
    );
  });
});
