import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { seedDevice } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { cardReaders, selectDeviceReader, setProfileReaderList } from "@waitron/payments";
import { readDeviceEquipment } from "./device-equipment.js";
import { readTillSetup, completeTillSetup, setupRevisionOf } from "./till-setup.js";
import { setupVenue } from "./testing/venue-fixtures.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

it("refreshes the saved reader slip setting in setup revision and every equipment projection", async () => {
  const { cfg } = await setupVenue(suite.db);
  const { deviceId, profileId } = await seedDevice(suite.db, { locationId: cfg.locationId });
  const [reader] = await suite.db
    .insert(cardReaders)
    .values({ provider: "sumup", providerRef: "own-slip-reader", name: "Counter" })
    .returning();
  await withTransaction(suite.db, async (tx) => {
    await setProfileReaderList(tx, profileId, {
      readerIds: [reader!.id],
      defaultReaderId: reader!.id,
    });
    expect(
      await selectDeviceReader(tx, { deviceId, selection: { id: reader!.id }, via: "list" }),
    ).toMatchObject({ ok: true });
  });
  const binding = {
    deviceId,
    deviceProfileId: profileId,
    locationId: cfg.locationId,
    label: "Counter",
    formFactor: "till" as const,
    capabilities: [],
  };
  const read = () =>
    withTransaction(suite.db, async (tx) => ({
      setup: completeTillSetup(await readTillSetup(tx, { cfg, venueLocale: "en-GB" }, binding)),
      equipment: await readDeviceEquipment(tx, deviceId),
    }));
  const before = await read();
  expect(before.setup.activeReaders).toEqual([
    expect.objectContaining({ id: reader!.id, printsOwnSlipAutomatically: false }),
  ]);
  await suite.db
    .update(cardReaders)
    .set({ printsOwnSlipAutomatically: true })
    .where(eq(cardReaders.id, reader!.id));
  const after = await read();
  expect(after.setup.activeReaders).toEqual([
    expect.objectContaining({ id: reader!.id, printsOwnSlipAutomatically: true }),
  ]);
  expect(setupRevisionOf(after.setup)).not.toBe(setupRevisionOf(before.setup));
  const role = after.equipment.roles.find((item) => item.role === "card_terminal")!;
  for (const item of [role.resolved, role.chosen, role.default, ...role.choices]) {
    expect(item).toMatchObject({ id: reader!.id, printsOwnSlipAutomatically: true });
  }
});
