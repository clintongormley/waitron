import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  checkFailed,
  deviceProfiles,
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

describe("profile reader column", () => {
  it("starts empty and stores an object, refusing other JSON shapes", async () => {
    const { deviceId, readers } = await seed();
    const [device] = await suite.db.select().from(devices).where(eq(devices.id, deviceId));
    const profileId = device!.deviceProfileId;
    expect(
      (
        await suite.db.execute(
          sql`select card_readers from device_profiles where id = ${profileId}`,
        )
      ).rows,
    ).toEqual([{ card_readers: "{}" }]);
    for (const value of ["[]", '"x"', "3"]) {
      const error = await captureError(() =>
        withTransaction(suite.db, (tx) =>
          tx.run(sql`update device_profiles set card_readers = ${value} where id = ${profileId}`),
        ),
      );
      expect(checkFailed(error, "device_profiles_card_readers_ck")).toBe(true);
    }
    const list = { ids: readers, defaultId: readers[0] };
    await suite.db.run(
      sql`update device_profiles set card_readers = ${JSON.stringify(list)} where id = ${profileId}`,
    );
    expect(
      (
        await suite.db
          .select({ list: deviceProfiles.cardReaders })
          .from(deviceProfiles)
          .where(eq(deviceProfiles.id, profileId))
      )[0]!.list,
    ).toEqual(list);
  });
});

describe("core device reader without payments", () => {
  const core = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  it("accepts no choice and a plain reader id when payments is absent", async () => {
    await seedVenue(core.db);
    const { deviceId } = await seedDevice(core.db, {});
    expect(
      (await core.db.execute(sql`select card_reader_id from devices where id = ${deviceId}`)).rows,
    ).toEqual([{ card_reader_id: null }]);
    await core.db.run(
      sql`update devices set card_reader_id = 'external-reader' where id = ${deviceId}`,
    );
    expect(
      (await core.db.execute(sql`select card_reader_id from devices where id = ${deviceId}`)).rows,
    ).toEqual([{ card_reader_id: "external-reader" }]);
  });
});
