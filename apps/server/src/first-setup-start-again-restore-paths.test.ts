import {
  withoutSignIn,
  missingHeldDatabase,
  startAgainMissing,
  seedResolutionRecord,
  exists,
  type Held,
} from "../test/start-again-held-fixture.js";
import { diskSnapshot } from "../test/start-again-deleted.js";
import { heldSetup } from "../test/held-setup-database.js";
import {
  agreeInternet,
  bucketCommand,
  clock,
  key,
  managedHttp,
  restoreApp,
  scope,
  suite,
} from "../test/hour-recovery-host.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { hashPassword } from "@waitron/identity";
import { copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { encodeRecoveryKit } from "@waitron/stream";
import { createSelectedRecoveryPreparation } from "./recovery-preparation.js";
import { recoverySelectPastWaits } from "./testing/hour-test-clock.js";
import { runStagedRestore, stageStreamRestore } from "./restore-request.js";

const wipeHeld = async (f: Held) => {
  const { ids, actions } = await withoutSignIn(f);
  await actions.startAgainFirstSetup(ids);
};

async function withResolutionRecord(f: Held) {
  expect(await exists(await seedResolutionRecord(f))).toBe(true);
}

/** Stages the bucket restore through `/setup-api/restore-bucket` and the real stream staging. */
async function stageBucket(held: Held) {
  // Bucket staging refuses a backup with no administrator password to sign in with.
  await seedPersons(suite.db, {
    displayName: "Backup administrator",
    role: "admin",
    passwordHash: hashPassword("fixture-restore-password"),
  });
  const { f, command, deps, kit } = await bucketCommand(held.archive);
  const app = restoreApp({
    stageBucketRestore: (input) =>
      stageStreamRestore({
        ...f.restore,
        ...input,
        kit,
        litestreamBin: "/unused",
        now: () => new Date(),
        openStore: deps.openStore,
        restoreGeneration: async ({ outPath }) => {
          await copyFile(f.database, outPath);
        },
      }),
  });
  const response = await app.request("https://box.test/setup-api/restore-bucket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kit: encodeRecoveryKit(kit),
      environment: "preproduction",
      oldBoxGone: true,
      venueConfirmed: scope.taxpayerNif,
      recoveryOperation: JSON.parse(await readFile(command.operationPath, "utf8")),
      nodeRecoverySecret: key.secret,
      recoveryContext: {
        selectedSourceId: `stream:${f.options.node.locationId}:gen-0-${f.options.node.nodeId}-20261016T124000Z`,
        oldBoxGone: true,
        soleRecovery: true,
      },
    }),
  });
  expect(response.status, await response.clone().text()).toBe(202);
  agreeInternet();
  return () => runStagedRestore(f.restore);
}

/** The backup's hour, chosen after the wipe as on a box: the wipe deletes an earlier choice. */
const hourAfterWipe = async (f: Held) =>
  (await recoverySelectPastWaits(clock, createSelectedRecoveryPreparation(f.archive.options), {
    onBox: false,
  })) as { input: unknown };

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
