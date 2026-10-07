import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  captureError,
  deviceProfiles,
  devices,
  isUniqueViolation,
  locations,
  tenants,
  withTransaction,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { PAYMENTS_MIGRATIONS } from "../migrations.js";
import { freshNif } from "../../test/seed.js";
import { cardReaderHolders } from "./card-reader-holders.js";
import { cardReaders } from "./card-readers.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

async function seed(db: Database) {
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: freshNif(), legalName: "Test SL" })
    .onConflictDoNothing({ target: tenants.id });
  const [location] = await db
    .insert(locations)
    .values({ name: "Counter", invoiceLocales: ["es"], operationDescription: "Hostelería" })
    .returning({ id: locations.id });
  const [profile] = await db
    .insert(deviceProfiles)
    .values({ name: "Profile", formFactor: "till" })
    .returning({ id: deviceProfiles.id });
  const made = await db
    .insert(devices)
    .values(
      ["Till A", "Till B"].map((label) => ({
        locationId: location!.id,
        deviceProfileId: profile!.id,
        label,
        tokenHash: "scrypt$00$00",
      })),
    )
    .returning({ id: devices.id });
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
    deviceA: made[0]!.id,
    deviceB: made[1]!.id,
    reader1: readers[0]!.id,
    reader2: readers[1]!.id,
  };
}

describe("card_reader_holders", () => {
  it("refuses a second holder for one reader", async () => {
    const { deviceA, deviceB, reader1 } = await seed(suite.db);
    await withTransaction(suite.db, (tx) =>
      tx.insert(cardReaderHolders).values({ readerId: reader1, deviceId: deviceA }),
    );
    const e = await captureError(() =>
      withTransaction(suite.db, (tx) =>
        tx.insert(cardReaderHolders).values({ readerId: reader1, deviceId: deviceB }),
      ),
    );
    expect(isUniqueViolation(e)).toBe(true);
  });

  it("two readers may each have a holder, one device may hold both", async () => {
    const { deviceA, reader1, reader2 } = await seed(suite.db);
    await withTransaction(suite.db, (tx) =>
      tx.insert(cardReaderHolders).values([
        { readerId: reader1, deviceId: deviceA },
        { readerId: reader2, deviceId: deviceA },
      ]),
    );
    const rows = await suite.db.select().from(cardReaderHolders);
    expect(rows.map((r) => [r.readerId, r.deviceId]).sort()).toEqual(
      [
        [reader1, deviceA],
        [reader2, deviceA],
      ].sort(),
    );
    expect(rows.every((r) => typeof r.heldAt === "string")).toBe(true);
  });
});
