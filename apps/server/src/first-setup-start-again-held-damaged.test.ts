import {
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
  type Held,
} from "../test/start-again-held-fixture.js";
import {
  expectStartAgainDeleted,
  noConfirmations,
  expectStartAgainRefused,
} from "../test/start-again-deleted.js";
import { heldSetup } from "../test/held-setup-database.js";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { Hono } from "hono";
import { readFile, writeFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { mountFirstSetupResolutionApi } from "./setup-first-fiscal-api.js";

import { cutAfterFirstPage, damageIndexes, damagePages } from "../test/damaged-database.js";

it("a held database with a damaged table: the summary says it cannot be read, and Start again with that confirmation deletes it", async () => {
  const f = await heldSetup();
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
  const f = await heldSetup();
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
  const f = await heldSetup();
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

it("a damaged recovery-key record beside a damaged database: Start again needs both acknowledgements, and deletes the setup", async () => {
  const f = await heldSetup();
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
  await noConfirmations(f);
});

it("the Start again route passes confirmUnreadableDatabase on: confirming a damaged database over HTTPS starts again", async () => {
  const f = await heldSetup();
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
  const f = await heldSetup();
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
  const f = await heldSetup();
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
    const f = await heldSetup();
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
  const f = await heldSetup({ invoices: 1 });
  damagePages(venueDb(f), "tenants");
  expect(await labelOf(f)).toBe("corrupt");
  await expectHeldRefused(f, keptRecords);
});

it("the same sale with only the invoice table and its indexes damaged refuses kept-records, and deletes nothing", async () => {
  const f = await heldSetup({ invoices: 1 });
  damagePages(venueDb(f), invoiceTable);
  await expectHeldRefused(f, keptRecords);
});

it("damaged indexes beside an intact sale and invoice refuse kept-records, and delete nothing", async () => {
  const f = await heldSetup({ invoices: 1 });
  damageIndexes(venueDb(f));
  await expectHeldRefused(f, keptRecords);
});

const damagedBesideWal = {
  code: "setup.not_ready",
  reason: "database unreadable: damaged beside a -wal: errcode 11",
};

/** Start again sent as the page sends it after showing "cannot be read", expected refused. */
async function expectConfirmedRefused(f: Held, refusal: object) {
  const { ids, actions } = await withoutSignIn(f);
  await expectStartAgainRefused(
    f,
    () =>
      actions.startAgainFirstSetup({
        ...ids,
        confirmUnreadableDatabase: {
          shown: { reached: "fiscal-finished", databaseUnreadable: true },
        },
      }),
    refusal,
  );
}

it("a damaged database beside a non-empty -wal: the summary and Start again confirming it cannot be read both answer setup.not_ready, and no file changes", async () => {
  const f = await heldSetup({ pendingWal: true });
  cutAfterFirstPage(venueDb(f));
  await expectHeldRefused(f, damagedBesideWal);
  await expectConfirmedRefused(f, damagedBesideWal);
});

it("an invoice saved only into the -wal beside a main file cut after its first page: the summary and a confirmed Start again answer setup.not_ready, and no file changes", async () => {
  const f = await heldSetup({ crash: { walBytes: 8000, invoices: 1 } });
  cutAfterFirstPage(venueDb(f));
  await expectHeldRefused(f, damagedBesideWal);
  await expectConfirmedRefused(f, damagedBesideWal);
});

it("a damaged database beside its own -wal, with an invoice the read can see: a confirmed Start again is refused kept-records, and no file changes", async () => {
  const f = await heldSetup({ pendingWal: true, invoices: 1 });
  const wal = await readFile(`${venueDb(f)}-wal`);
  damagePages(venueDb(f), "department_days");
  await writeFile(`${venueDb(f)}-wal`, wal);
  await expectHeldRefused(f, keptRecords);
  await expectConfirmedRefused(f, keptRecords);
});

it("control: the same damaged database with no -wal: the summary says it cannot be read, and Start again with that confirmation deletes it", async () => {
  const f = await heldSetup();
  cutAfterFirstPage(venueDb(f));
  const shown = await unreadableSummary(f);
  expect(shown).toEqual({ reached: "fiscal-finished", databaseUnreadable: true });
  await expectUnreadableDeleted(f, shown);
});

it("control: the same damaged database beside an empty -wal: the summary says it cannot be read, and Start again with that confirmation deletes it", async () => {
  const f = await heldSetup();
  cutAfterFirstPage(venueDb(f));
  await writeFile(`${venueDb(f)}-wal`, "");
  const shown = await unreadableSummary(f);
  expect(shown).toEqual({ reached: "fiscal-finished", databaseUnreadable: true });
  await expectUnreadableDeleted(f, shown);
});
