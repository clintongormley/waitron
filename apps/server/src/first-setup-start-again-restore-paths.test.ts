import {
  withoutSignIn,
  missingHeldDatabase,
  startAgainMissing,
  hourAfterWipe,
  seedResolutionRecord,
  exists,
  type Held,
} from "../test/start-again-held-fixture.js";
import { diskSnapshot } from "../test/start-again-deleted.js";
import { heldSetup } from "../test/held-setup-database.js";
import { agreeInternet, managedHttp, stageBucketRoute } from "../test/hour-recovery-host.js";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runStagedRestore } from "./restore-request.js";

const wipeHeld = async (f: Held) => {
  const { ids, actions } = await withoutSignIn(f);
  await actions.startAgainFirstSetup(ids);
};

async function withResolutionRecord(f: Held) {
  expect(await exists(await seedResolutionRecord(f))).toBe(true);
}

async function stageBucket(held: Held) {
  const { f } = await stageBucketRoute(held.archive);
  agreeInternet();
  return () => runStagedRestore(f.restore);
}

/** Stages the Cloud restore through `/setup-api/cloud-recovery/restore`. */
async function stageCloud(f: Held, archive: Held["archive"] = f.archive) {
  const managed = await managedHttp(archive);
  agreeInternet();
  return () =>
    runStagedRestore({
      ...f.archive.restore,
      onManagedCloudRestored: (binding) => managed.client().markRestored(binding),
    });
}

async function expectPlaced(f: Held, place: () => Promise<boolean>) {
  await expect(place()).resolves.toBe(true);
  expect(await exists(join(f.roots.venueDir, "venue.db"))).toBe(true);
  expect(await exists(join(f.roots.stateDir, "trading.env"))).toBe(true);
  for (const dir of [f.roots.venueDir, f.roots.stateDir])
    expect(await exists(join(dir, "first-setup-resolutions"))).toBe(false);
}

async function expectRefusedPlacingNothing(f: Held, place: () => Promise<boolean>) {
  const venue = (await diskSnapshot(f.roots)).venue;
  await expect(place()).rejects.toMatchObject({
    code: expect.stringMatching(/^setup\.attempt_(conflict|uncertain)$/),
  });
  expect((await diskSnapshot(f.roots)).venue).toEqual(venue);
  expect(await exists(join(f.roots.stateDir, "trading.env"))).toBe(false);
}

it("a held setup database, wiped, then the bucket restore writes into the usual folders", async () => {
  const f = await heldSetup();
  await withResolutionRecord(f);
  await wipeHeld(f);
  await expectPlaced(f, await stageBucket(f));
}, 180_000);

it("a missing setup database, wiped, then the bucket restore writes into the usual folders", async () => {
  const f = await missingHeldDatabase();
  await withResolutionRecord(f);
  await startAgainMissing(f);
  await expectPlaced(f, await stageBucket(f));
}, 180_000);

it("control: the same bucket restore beside a held setup database that was not wiped is refused, and places nothing", async () => {
  const f = await heldSetup();
  await expectRefusedPlacingNothing(f, await stageBucket(f));
}, 180_000);

it("control: the same bucket restore beside a missing setup database that was not wiped is refused, and places nothing", async () => {
  const f = await missingHeldDatabase();
  await expectRefusedPlacingNothing(f, await stageBucket(f));
}, 180_000);

it("a held setup database, wiped, then the Waitron Cloud restore writes into the usual folders", async () => {
  const f = await heldSetup();
  await withResolutionRecord(f);
  await wipeHeld(f);
  await expectPlaced(f, await stageCloud(f, { ...f.archive, outcome: await hourAfterWipe(f) }));
}, 180_000);

it("a missing setup database, wiped, then the Waitron Cloud restore writes into the usual folders", async () => {
  const f = await missingHeldDatabase();
  await withResolutionRecord(f);
  await startAgainMissing(f);
  await expectPlaced(f, await stageCloud(f, { ...f.archive, outcome: await hourAfterWipe(f) }));
}, 180_000);

it("control: the same Waitron Cloud restore beside a held setup database that was not wiped is refused, and places nothing", async () => {
  const f = await heldSetup();
  await expectRefusedPlacingNothing(f, await stageCloud(f));
}, 180_000);

it("control: the same Waitron Cloud restore beside a missing setup database that was not wiped is refused, and places nothing", async () => {
  const f = await missingHeldDatabase();
  await expectRefusedPlacingNothing(f, await stageCloud(f));
}, 180_000);
