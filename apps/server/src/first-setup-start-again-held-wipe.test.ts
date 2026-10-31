import {
  holdingsRead,
  askStartAgain,
  withoutSignIn,
  missingHeldDatabase,
  startAgainMissing,
  stageFreshRestore,
  exists,
  type Held,
} from "../test/start-again-held-fixture.js";
import {
  diskSnapshot,
  expectStartAgainDeleted,
  expectStartAgainRefused,
  noConfirmations,
} from "../test/start-again-deleted.js";
import { heldSetup } from "../test/held-setup-database.js";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { Hono } from "hono";
import { access, rm, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  assertStartAgainAllowedOnDisk,
  finishStartAgainDeletion,
  firstSetupFrozenDigest,
  startAgainMarkerFor,
  writeStartAgainMarker,
  readStartAgainMarker,
  resolveFirstSetupBackupWorkspace,
  assertFirstSetupBackupBootTarget,
} from "@waitron/provisioning";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";
import { mountFirstSetupResolutionApi } from "./setup-first-fiscal-api.js";

import { foreignHotJournal } from "../test/foreign-journal.js";
import { clock } from "../test/hour-recovery-host.js";
import { createSelectedRecoveryPreparation } from "./recovery-preparation.js";
import { recoverySelectPastWaits } from "./testing/hour-test-clock.js";
import { runStagedRestore } from "./restore-request.js";

it("a held setup database with no recovery: the summary answers and Start again deletes it with no password", async () => {
  const f = await heldSetup({ recovery: false });
  const { ids, actions } = await withoutSignIn(f);
  await expect(actions.startAgainSummary(ids)).resolves.toEqual({ reached: "fiscal-finished" });
  await expect(actions.startAgainFirstSetup(ids)).resolves.toBeUndefined();
  await expectStartAgainDeleted(f.roots);
  await noConfirmations(f);
});

it("a held setup database with no recovery, when the box knows no modules, refuses the summary and Start again setup.not_ready before reading what it holds, and nothing changes", async () => {
  const f = await heldSetup({ recovery: false });
  const host = { ...f.host, modules: undefined } as unknown as Held["host"];
  const { ids, actions } = await withoutSignIn(f, host);
  holdingsRead.calls = 0;
  await expectStartAgainRefused(f, () => actions.startAgainSummary(ids).then(() => {}), {
    code: "setup.not_ready",
  });
  await expectStartAgainRefused(f, () => actions.startAgainFirstSetup(ids), {
    code: "setup.not_ready",
  });
  expect(holdingsRead.calls).toBe(0);
});

it("a held setup database with no recovery, its venue.db missing and trading settings saved, refuses the summary and Start again setup.not_ready for state/trading.env, and nothing changes", async () => {
  const f = await heldSetup({ recovery: false, tradingSettings: true });
  for (const name of ["venue.db", "venue.db-wal", "venue.db-shm"])
    await rm(join(f.roots.venueDir, name), { force: true });
  const { ids, actions } = await withoutSignIn(f);
  const refusal = { code: "setup.not_ready", reason: "refused artifact: state/trading.env" };
  await expectStartAgainRefused(f, () => actions.startAgainSummary(ids).then(() => {}), refusal);
  await expectStartAgainRefused(
    f,
    () =>
      actions.startAgainFirstSetup({
        ...ids,
        confirmMissingDatabase: { nothingFiledOrSold: true, shown: { reached: "fiscal-finished" } },
      }),
    refusal,
  );
});

it("with the setup database missing and a hot journal left where it was, Start again's wipe leaves no journal", async () => {
  const f = await missingHeldDatabase();
  const journal = join(f.roots.venueDir, "venue.db-journal");
  foreignHotJournal(journal, "rolls-back");
  await startAgainMissing(f);
  await expect(access(journal)).rejects.toMatchObject({ code: "ENOENT" });
});

it("with the setup database missing and no journal, Start again's wipe deletes the setup", async () => {
  await startAgainMissing(await missingHeldDatabase());
});

it("a held setup database, wiped, then the fresh-box restore writes into the usual folders", async () => {
  const f = await heldSetup({ recovery: false });
  const { ids, actions } = await withoutSignIn(f);
  await actions.startAgainFirstSetup(ids);
  // The backup's hour is chosen after the wipe, as on a box: the wipe deletes an earlier choice.
  const outcome = (await recoverySelectPastWaits(
    clock,
    createSelectedRecoveryPreparation(f.archive.options),
    { onBox: false },
  )) as { input: unknown };
  await stageFreshRestore(f, { ...f.archive, outcome });
  await expect(runStagedRestore(f.archive.restore)).resolves.toBe(true);
  expect(await exists(join(f.roots.venueDir, "venue.db"))).toBe(true);
  expect(await exists(join(f.roots.stateDir, "trading.env"))).toBe(true);
  for (const dir of [f.roots.venueDir, f.roots.stateDir])
    expect(await exists(join(dir, "first-setup-resolutions"))).toBe(false);
  expect((await resolveFirstSetupBackupWorkspace(f.roots)).kind).toBe("absent");
}, 180_000);

it("control: the same fresh-box restore beside a held setup database that was not wiped is refused, and places nothing", async () => {
  const f = await heldSetup({ recovery: false });
  await stageFreshRestore(f);
  const venue = (await diskSnapshot(f.roots)).venue;
  await expect(runStagedRestore(f.archive.restore)).rejects.toMatchObject({
    code: expect.stringMatching(/^setup\.attempt_(conflict|uncertain)$/),
  });
  expect((await diskSnapshot(f.roots)).venue).toEqual(venue);
  expect(await exists(join(f.roots.stateDir, "trading.env"))).toBe(false);
}, 180_000);

const hourAfterWipe = async (f: Held) =>
  (await recoverySelectPastWaits(clock, createSelectedRecoveryPreparation(f.archive.options), {
    onBox: false,
  })) as { input: unknown };

it("a missing setup database, wiped, then the fresh-box restore writes into the usual folders", async () => {
  const f = await missingHeldDatabase();
  await startAgainMissing(f);
  await stageFreshRestore(f, { ...f.archive, outcome: await hourAfterWipe(f) });
  await expect(runStagedRestore(f.archive.restore)).resolves.toBe(true);
  expect(await exists(join(f.roots.venueDir, "venue.db"))).toBe(true);
  expect(await exists(join(f.roots.stateDir, "trading.env"))).toBe(true);
  for (const dir of [f.roots.venueDir, f.roots.stateDir])
    expect(await exists(join(dir, "first-setup-resolutions"))).toBe(false);
  expect((await resolveFirstSetupBackupWorkspace(f.roots)).kind).toBe("absent");
}, 180_000);

it("control: the same fresh-box restore beside a missing setup database that was not wiped is refused, and places nothing", async () => {
  const f = await missingHeldDatabase();
  await stageFreshRestore(f);
  const venue = (await diskSnapshot(f.roots)).venue;
  await expect(runStagedRestore(f.archive.restore)).rejects.toMatchObject({
    code: expect.stringMatching(/^setup\.attempt_(conflict|uncertain)$/),
  });
  expect((await diskSnapshot(f.roots)).venue).toEqual(venue);
  expect(await exists(join(f.roots.stateDir, "trading.env"))).toBe(false);
}, 180_000);

it("a held setup database beside a stopped recovery, wiped (discarding the recovery), then the fresh-box restore writes into the usual folders", async () => {
  const f = await heldSetup();
  await (await askStartAgain(f)).run();
  await stageFreshRestore(f, { ...f.archive, outcome: await hourAfterWipe(f) });
  await expect(runStagedRestore(f.archive.restore)).resolves.toBe(true);
  expect(await exists(join(f.roots.venueDir, "venue.db"))).toBe(true);
  expect(await exists(join(f.roots.stateDir, "trading.env"))).toBe(true);
  expect(await exists(join(f.roots.venueDir, "first-setup-resolutions"))).toBe(false);
  // Start again keeps the discarded recovery's record folder in the state folder.
  expect(await exists(join(f.roots.stateDir, "first-setup-resolutions"))).toBe(true);
  expect((await resolveFirstSetupBackupWorkspace(f.roots)).kind).toBe("absent");
  await expect(assertFirstSetupBackupBootTarget(f.roots)).resolves.toBeUndefined();
}, 180_000);

it("a power cut during a held wipe with no recovery: the next start finishes the deletion", async () => {
  const f = await heldSetup({ recovery: false });
  const { ids } = await withoutSignIn(f);
  let removed = 0;
  const actions = createFirstSetupResolutionActions({
    ...f.roots,
    host: f.host,
    remove: async (path, kind) => {
      if (removed++ === 1) throw new Error("power cut");
      await (kind === "file" ? unlink(path) : rmdir(path));
    },
  });
  await expect(actions.startAgainFirstSetup(ids)).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
  });
  expect(removed).toBe(2);
  expect(await readStartAgainMarker(f.roots.venueDir)).not.toBeNull();
  await finishStartAgainDeletion(f.roots);
  await expectStartAgainDeleted(f.roots);
});

it("a deletion already marked: Start again answers setup.start_again_incomplete and the route asks for a restart", async () => {
  const f = await heldSetup({ recovery: false });
  const state = (await f.host.store.read())!;
  await writeStartAgainMarker(
    f.roots,
    await startAgainMarkerFor(
      await assertStartAgainAllowedOnDisk(f.roots, { held: true }),
      { attemptId: state.frozen.attemptId, frozenDigest: firstSetupFrozenDigest(state) },
      { held: true },
    ),
  );
  const { ids, actions } = await withoutSignIn(f);
  const requestRestart = vi.fn();
  const app = new Hono();
  mountFirstSetupResolutionApi(app, f.host, () => {}, {
    startAgain: actions.startAgainFirstSetup,
    requestRestart,
  });
  const socket = new TLSSocket(new Socket());
  try {
    const response = await app.request(
      "https://box.test/setup-api/first-setup/resolution/start-again",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids),
      },
      { incoming: { socket } },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "setup.start_again_incomplete" },
    });
  } finally {
    socket.destroy();
  }
  await vi.waitFor(() => expect(requestRestart).toHaveBeenCalledOnce());
});
