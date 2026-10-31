import {
  snapshot,
  askStartAgain,
  confirmations,
  expectStartAgainRefused,
  LEFT_VENUE,
  LEFT_STATE,
  damageRecoveryRecord,
  withoutSignIn,
  venueDb,
  invoiceTable,
  labelOf,
  unreadableSummary,
  expectUnreadableDeleted,
  expectHeldRefused,
  keptRecords,
  recordingFiscalSeat,
  heldActions,
  currentIds,
  abandonUnemptied,
  type Held,
} from "../test/start-again-held-fixture.js";
import { heldSetup } from "../test/held-setup-database.js";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { Hono } from "hono";
import { access, writeFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { mountFirstSetupResolutionApi } from "./setup-first-fiscal-api.js";
import { expectStartAgainDeleted } from "../test/start-again-deleted.js";
import { damageIndexes, damagePages } from "../test/damaged-database.js";

it("a held database with a damaged table (no recovery): the summary says it cannot be read, and Start again with that confirmation deletes it", async () => {
  const f = await heldSetup({ recovery: false });
  damagePages(venueDb(f), "department_days");
  expect(await labelOf(f)).toBe("occupied");
  const shown = await unreadableSummary(f);
  expect(shown).toEqual({
    reached: "fiscal-finished",
    databaseUnreadable: true,
  });
  await expectUnreadableDeleted(f, shown);
});

it("a damaged database whose confirmation shows another summary is refused setup.attempt_conflict, and nothing changes", async () => {
  const f = await heldSetup({ recovery: false });
  damagePages(venueDb(f), "department_days");
  const shown = await unreadableSummary(f);
  const { ids, actions } = await withoutSignIn(f);
  await expectStartAgainRefused(
    f,
    () =>
      actions.startAgainFirstSetup({
        ...ids,
        confirmUnreadableDatabase: { shown: { ...shown, reached: "named" } },
      }),
    { code: "setup.attempt_conflict" },
  );
});

it("confirmUnreadableDatabase beside a readable database is refused setup.attempt_conflict, and nothing changes", async () => {
  const f = await heldSetup({ recovery: false });
  const { ids, actions } = await withoutSignIn(f);
  const shown = await actions.startAgainSummary(ids);
  expect(shown).toEqual({ reached: "fiscal-finished" });
  await expectStartAgainRefused(
    f,
    () =>
      actions.startAgainFirstSetup({
        ...ids,
        confirmUnreadableDatabase: { shown: { ...shown, databaseUnreadable: true } },
      }),
    { code: "setup.attempt_conflict" },
  );
});

it("a damaged database beside a stopped recovery: the summary names both, and confirmRecoveryDiscard with that summary deletes both", async () => {
  const f = await heldSetup();
  damagePages(venueDb(f), "department_days");
  const startAgain = await askStartAgain(f);
  expect(startAgain.shown).toMatchObject({
    reached: "fiscal-finished",
    databaseUnreadable: true,
    recovery: expect.any(Object),
  });
  await expectStartAgainRefused(
    f,
    () =>
      startAgain.run({
        confirmRecoveryDiscard: { shown: startAgain.shown },
        confirmUnreadableDatabase: { shown: startAgain.shown },
      }),
    { code: "setup.attempt_conflict" },
  );
  await expect(startAgain.run()).resolves.toBeUndefined();
  const left = await snapshot(f);
  expect(Object.keys(left.venue).filter((name) => !LEFT_VENUE.test(name))).toEqual([]);
  expect(Object.keys(left.state).filter((name) => !LEFT_STATE.test(name))).toEqual([]);
  const records = await confirmations(f.roots.stateDir);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ database: "unreadable" });
  expect(records[0]!.shown).toEqual(startAgain.shown);
  expect((await f.workspace.readChain()).at(-1)!.phase).toBe("abandoned");
});

it("a damaged database beside a stopped recovery: confirmRecoveryDiscard whose summary leaves out that it cannot be read is refused setup.attempt_conflict, and nothing changes", async () => {
  const f = await heldSetup();
  damagePages(venueDb(f), "department_days");
  const startAgain = await askStartAgain(f);
  const { databaseUnreadable, ...without } = startAgain.shown;
  expect(databaseUnreadable).toBe(true);
  await expectStartAgainRefused(
    f,
    () => startAgain.run({ confirmRecoveryDiscard: { shown: without } }),
    {
      code: "setup.attempt_conflict",
    },
  );
});

it.each([
  ["a readable", false, ["present", "unreadable"]],
  ["an already damaged", true, ["unreadable", "unreadable"]],
] as const)(
  "finishing a recovery abandoned over %s database: the damaged database is deleted only with the page's confirmation, which writes its own record",
  async (_label, damagedFirst, databases) => {
    const f = await heldSetup();
    if (damagedFirst) damagePages(venueDb(f), "department_days");
    const first = await abandonUnemptied(f);
    expect(first.databaseUnreadable).toBe(damagedFirst ? true : undefined);
    if (!damagedFirst) damagePages(venueDb(f), "department_days");
    // A record is named by its millisecond; the suite's clock stands still.
    vi.setSystemTime(Date.now() + 1000);
    const ids = await currentIds(f);
    const actions = heldActions(f);
    const shown = await actions.startAgainSummary(ids);
    expect(shown).toEqual({ reached: "fiscal-finished", databaseUnreadable: true });
    await expect(actions.startAgainFirstSetup(ids)).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
    await expect(
      actions.startAgainFirstSetup({ ...ids, confirmRecoveryDiscard: { shown } }),
    ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    await expect(
      actions.startAgainFirstSetup({ ...ids, confirmUnreadableDatabase: { shown } }),
    ).resolves.toBeUndefined();
    await expect(access(venueDb(f))).rejects.toMatchObject({ code: "ENOENT" });
    const records = (await confirmations(f.roots.stateDir)).sort((a, b) =>
      a.at.localeCompare(b.at),
    );
    expect(records.map((record) => record.database)).toEqual(databases);
    expect(records.at(-1)!.shown).toEqual(shown);
  },
);

it("a damaged recovery-key record beside a damaged database: Start again needs both acknowledgements, and the record carries both", async () => {
  const f = await heldSetup({ recovery: false });
  await damageRecoveryRecord(f);
  damagePages(venueDb(f), "department_days");
  const { ids, actions } = await withoutSignIn(f);
  const shown = await actions.startAgainSummary(ids);
  expect(shown).toEqual({
    reached: "fiscal-finished",
    recoveryRecordDamaged: true,
    databaseUnreadable: true,
  });
  await expectStartAgainRefused(
    f,
    () => actions.startAgainFirstSetup({ ...ids, confirmUnreadableDatabase: { shown } }),
    { code: "setup.attempt_conflict" },
  );
  await expectStartAgainRefused(
    f,
    () => actions.startAgainFirstSetup({ ...ids, recoveryRecordDamagedShown: true }),
    { code: "setup.attempt_conflict" },
  );
  await expect(
    actions.startAgainFirstSetup({
      ...ids,
      recoveryRecordDamagedShown: true,
      confirmUnreadableDatabase: { shown },
    }),
  ).resolves.toBeUndefined();
  await expectStartAgainDeleted(f.roots);
  const records = await confirmations(f.roots.stateDir);
  expect(records.map((record) => [record.database, record.shown])).toEqual([["unreadable", shown]]);
});

it("the Start again route passes confirmUnreadableDatabase on: confirming a damaged database over HTTPS starts again", async () => {
  const f = await heldSetup({ recovery: false });
  damagePages(venueDb(f), "department_days");
  const { ids, actions } = await withoutSignIn(f);
  const shown = await actions.startAgainSummary(ids);
  expect(shown).toMatchObject({ databaseUnreadable: true });
  const app = new Hono();
  mountFirstSetupResolutionApi(app, f.host, () => {}, {
    startAgain: actions.startAgainFirstSetup,
  });
  const socket = new TLSSocket(new Socket());
  try {
    const response = await app.request(
      "https://box.test/setup-api/first-setup/resolution/start-again",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...ids, confirmUnreadableDatabase: { shown } }),
      },
      { incoming: { socket } },
    );
    expect(await response.json()).toEqual({ restarting: true });
    expect(response.status).toBe(200);
  } finally {
    socket.destroy();
  }
  await expectStartAgainDeleted(f.roots);
});

it("a held database whose invoice table is damaged, with no sale: the summary says it cannot be read, the fiscal module's own reader failed with code 11, and Start again with that confirmation deletes it", async () => {
  const f = await heldSetup({ recovery: false });
  damagePages(venueDb(f), invoiceTable);
  expect(await labelOf(f)).toBe("occupied");
  const { host, answers } = recordingFiscalSeat(f);
  const shown = await unreadableSummary(f, host);
  expect(shown).toEqual({
    reached: "fiscal-finished",
    databaseUnreadable: true,
  });
  expect(answers[0]).toEqual({ rejected: true, errcode: 11 });
  await expectUnreadableDeleted(f, shown, host);
});

it("control: the same held database undamaged: the summary does not say it cannot be read, and the fiscal module's reader counted nothing", async () => {
  const f = await heldSetup({ recovery: false });
  const { host, answers } = recordingFiscalSeat(f);
  const { ids, actions } = await withoutSignIn(f, host);
  expect(await actions.startAgainSummary(ids)).toEqual({ reached: "fiscal-finished" });
  expect(answers).toEqual([{ resolved: { records: 0, accepted: 0 } }]);
});

it.each([
  ["its first page damaged", (f: Held) => damagePages(venueDb(f), null)],
  ["junk bytes for a database", (f: Held) => writeFile(venueDb(f), "not a database")],
])(
  "a held setup database with %s (attempt committed): the summary says it cannot be read, and Start again with that confirmation deletes it",
  async (_label, damage) => {
    const f = await heldSetup({ recovery: false });
    await damage(f);
    expect(await labelOf(f)).toBe("corrupt");
    const shown = await unreadableSummary(f);
    expect(shown).toEqual({
      reached: "fiscal-finished",
      databaseUnreadable: true,
    });
    await expectUnreadableDeleted(f, shown);
  },
);

it("a damaged tenants page beside an invoice refuses kept-records, and deletes nothing", async () => {
  const f = await heldSetup({ invoices: 1, recovery: false });
  damagePages(venueDb(f), "tenants");
  expect(await labelOf(f)).toBe("corrupt");
  await expectHeldRefused(f, keptRecords);
});

it("the same sale with only the invoice table and its indexes damaged refuses kept-records, and deletes nothing", async () => {
  const f = await heldSetup({ invoices: 1, recovery: false });
  damagePages(venueDb(f), invoiceTable);
  await expectHeldRefused(f, keptRecords);
});

it("damaged indexes beside an intact sale and invoice refuse kept-records, and delete nothing", async () => {
  const f = await heldSetup({ invoices: 1, recovery: false });
  damageIndexes(venueDb(f));
  await expectHeldRefused(f, keptRecords);
});
