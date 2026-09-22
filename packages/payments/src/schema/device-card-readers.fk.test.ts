import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  CORE_MIGRATIONS,
  FOREIGN_KEY_VIOLATION,
  UNIQUE_VIOLATION,
  captureError,
  deviceProfiles,
  devices,
  isPgError,
  locations,
  tenants,
  tills,
  withTransaction,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { PAYMENTS_MIGRATIONS } from "../migrations.js";
import { freshNif } from "../../test/seed.js";
import { cardReaders } from "./card-readers.js";
import { deviceCardReaders } from "./device-card-readers.js";

// This suite used to run on real PostgreSQL under a non-superuser LOGIN inheriting `app_user`'s
// grants, and doubled as the grant check for 0001_payments_baseline_sql.sql's
// SELECT/INSERT/UPDATE/DELETE on this table. That half is GONE and has no replacement: this engine
// has no roles. What is left is the primary key and the two foreign keys.
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

interface Seeded {
  deviceId: string;
  readerId: string;
}

/**
 * Seeds a location, a `till`-form-factor device profile, a till, one device bound to that till, and
 * one card reader — the rows device_card_readers' device and reader FKs point at.
 *
 * Through the table definitions rather than raw SQL: `id` and `created_at` are `$defaultFn`
 * generators only the insert BUILDER runs, and `invoice_locales` is a list the column's own
 * mapping encodes (the same reason `packages/payments/test/seed.ts` gives at `seedWorkingOrder`).
 */
async function seedDeviceAndReader(db: Database): Promise<Seeded> {
  // One `tenants` row so the database looks like a provisioned one; nothing below references it.
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: freshNif(), legalName: "Test SL" })
    .onConflictDoNothing({ target: tenants.id });
  const [location] = await db
    .insert(locations)
    .values({ name: "Counter", invoiceLocales: ["es"], operationDescription: "Hostelería" })
    .returning({ id: locations.id });
  const [till] = await db
    .insert(tills)
    .values({ locationId: location!.id, name: "Till 1" })
    .returning({ id: tills.id });
  const [profile] = await db
    .insert(deviceProfiles)
    .values({ name: "Profile", formFactor: "till" })
    .returning({ id: deviceProfiles.id });
  const [device] = await db
    .insert(devices)
    .values({
      locationId: location!.id,
      deviceProfileId: profile!.id,
      tillId: till!.id,
      label: "Counter till",
      tokenHash: "scrypt$00$00",
    })
    .returning({ id: devices.id });
  const [reader] = await db
    .insert(cardReaders)
    .values({ provider: "sumup", providerRef: `rdr_${device!.id}`, name: "Counter" })
    .returning({ id: cardReaders.id });
  return { deviceId: device!.id, readerId: reader!.id };
}

describe("device_card_readers", () => {
  it("stores a device's default reader, round-trips, and a delete clears the default", async () => {
    const db = suite.db;
    const { deviceId, readerId } = await seedDeviceAndReader(db);

    await withTransaction(db, async (tx) => {
      await tx.insert(deviceCardReaders).values({ deviceId, readerId });
    });

    const stored = await withTransaction(db, (tx) =>
      tx.select().from(deviceCardReaders).where(eq(deviceCardReaders.deviceId, deviceId)),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]!.readerId).toBe(readerId);

    // The mapping is mutable — DELETE clears the device's default (unlike an append-only ledger).
    await withTransaction(db, async (tx) => {
      await tx.delete(deviceCardReaders).where(eq(deviceCardReaders.deviceId, deviceId));
    });
    const afterDelete = await withTransaction(db, (tx) =>
      tx.select().from(deviceCardReaders).where(eq(deviceCardReaders.deviceId, deviceId)),
    );
    expect(afterDelete).toHaveLength(0);
  });

  it("rejects a second default reader for the same device (PK device_id)", async () => {
    const db = suite.db;
    const { deviceId, readerId } = await seedDeviceAndReader(db);
    const [reader2] = await db
      .insert(cardReaders)
      .values({
        provider: "sumup",
        providerRef: `rdr_second_${deviceId}`,
        name: "Second",
      })
      .returning({ id: cardReaders.id });

    await withTransaction(db, async (tx) => {
      await tx.insert(deviceCardReaders).values({ deviceId, readerId });
    });

    const dup = await captureError(() =>
      withTransaction(db, async (tx) => {
        await tx.insert(deviceCardReaders).values({ deviceId, readerId: reader2!.id });
      }),
    );
    // Was `pgErrorCode(dup) === "23505"`. SQLite splits PostgreSQL's one `23505` into a unique
    // index (2067) and a primary key (1555); `UNIQUE_VIOLATION` holds both, which is what keeps
    // this answer the same as it was (`packages/db/src/sql-state.ts`).
    expect(isPgError(dup, UNIQUE_VIOLATION)).toBe(true);
  });

  it("refuses a device or a reader that does not exist", async () => {
    const db = suite.db;
    const { deviceId, readerId } = await seedDeviceAndReader(db);
    // LOSS: this case used to assert `/device_card_readers_device_fk/` and
    // `/device_card_readers_reader_fk/` on the message, which told the two keys apart. SQLite
    // reports every foreign-key refusal as the six words `FOREIGN KEY constraint failed` and names
    // neither the constraint nor the column (`packages/db/src/constraint-target.ts`), so that half
    // has no replacement. Each statement below still carries exactly ONE unknown id against a
    // seeded real one, so which key fired is fixed by the statement rather than by the message.
    const noDevice = await captureError(() =>
      withTransaction(db, async (tx) => {
        await tx.insert(deviceCardReaders).values({ deviceId: randomUUID(), readerId });
      }),
    );
    expect(isPgError(noDevice, FOREIGN_KEY_VIOLATION)).toBe(true);
    const noReader = await captureError(() =>
      withTransaction(db, async (tx) => {
        await tx.insert(deviceCardReaders).values({ deviceId, readerId: randomUUID() });
      }),
    );
    expect(isPgError(noReader, FOREIGN_KEY_VIOLATION)).toBe(true);
  });
});
