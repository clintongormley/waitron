import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  FOREIGN_KEY_VIOLATION,
  captureError,
  devices,
  isRefusal,
  withTransaction,
} from "@waitron/db";
import { seedDevice, seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { PAYMENTS_MIGRATIONS } from "../migrations.js";
import { cardReaders } from "./card-readers.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

async function seed() {
  await seedVenue(suite.db);
  const { deviceId } = await seedDevice(suite.db, {});
  const readers = await suite.db
    .insert(cardReaders)
    .values(["First", "Second"].map((name) => ({ provider: "sumup", providerRef: name, name })))
    .returning({ id: cardReaders.id });
  return { deviceId, readers: readers.map((r) => r.id) };
}

describe("reader ownership columns", () => {
  it("allows one device to hold two readers", async () => {
    const { deviceId, readers } = await seed();
    await suite.db.run(sql`update card_readers set held_by_device_id = ${deviceId}`);
    expect(
      (await suite.db.execute(sql`select id, held_by_device_id from card_readers order by id`))
        .rows,
    ).toEqual(readers.sort().map((id) => ({ id, held_by_device_id: deviceId })));
  });

  it("deleting a device frees its readers without deleting them", async () => {
    const { deviceId, readers } = await seed();
    await suite.db.run(sql`update card_readers set held_by_device_id = ${deviceId}`);
    await suite.db.delete(devices).where(eq(devices.id, deviceId));
    expect(
      (await suite.db.execute(sql`select id, held_by_device_id from card_readers order by id`))
        .rows,
    ).toEqual(readers.sort().map((id) => ({ id, held_by_device_id: null })));
  });

  it("refuses a holder that is not a device", async () => {
    await seed();
    const error = await captureError(() =>
      withTransaction(suite.db, (tx) =>
        tx.run(sql`update card_readers set held_by_device_id = 'missing'`),
      ),
    );
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });
});
