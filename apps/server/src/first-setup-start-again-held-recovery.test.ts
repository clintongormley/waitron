import {
  extraDeletable,
  snapshot,
  expectRefused,
  askStartAgain,
  confirmations,
  expectStartAgainRefused,
  LEFT_VENUE,
  LEFT_STATE,
  damageRecoveryRecord,
  handMade,
} from "../test/start-again-held-fixture.js";
import { heldSetup } from "../test/held-setup-database.js";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { Hono } from "hono";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getTableName, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { openVenueDatabase } from "@waitron/db";
import { applyMigrationSet } from "@waitron/db/testing/venue-db.js";
import { manifestSets } from "@waitron/migrations";
import { registrosFacturacion } from "@waitron/fiscal-verifactu/src/schema/registros.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";
import { mountFirstSetupResolutionApi } from "./setup-first-fiscal-api.js";

it("in the held state, Start again confirming the summary deletes the setup, and keeps whose setup it was", async () => {
  const f = await heldSetup();
  const startAgain = await askStartAgain(f);
  await expect(startAgain.run()).resolves.toBeUndefined();
  const left = await snapshot(f);
  expect(Object.keys(left.venue).filter((name) => !LEFT_VENUE.test(name))).toEqual([]);
  expect(Object.keys(left.state).filter((name) => !LEFT_STATE.test(name))).toEqual([]);
  const records = await confirmations(f.roots.stateDir);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    database: "present",
    shown: startAgain.shown,
    setupAdministrator: { displayName: expect.any(String), email: expect.any(String) },
    signedIn: false,
  });
  expect((await f.workspace.readChain()).at(-1)!.phase).toBe("abandoned");
});

it("in the held state, a damaged recovery-key record: the summary shows it, and Start again sent as the page sends it, acknowledging it, deletes the setup", async () => {
  const f = await heldSetup();
  await damageRecoveryRecord(f);
  const startAgain = await askStartAgain(f);
  expect(startAgain.shown).toMatchObject({ recoveryRecordDamaged: true });
  await expect(
    startAgain.run({
      confirmRecoveryDiscard: { shown: startAgain.shown },
      recoveryRecordDamagedShown: true,
    }),
  ).resolves.toBeUndefined();
  const left = await snapshot(f);
  expect(Object.keys(left.venue).filter((name) => !LEFT_VENUE.test(name))).toEqual([]);
  expect(Object.keys(left.state).filter((name) => !LEFT_STATE.test(name))).toEqual([]);
  const records = await confirmations(f.roots.stateDir);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ database: "present", shown: startAgain.shown });
  expect((await f.workspace.readChain()).at(-1)!.phase).toBe("abandoned");
});

it.each([
  ["a damaged recovery-key record, sent without recoveryRecordDamagedShown", true, false],
  ["a readable recovery-key record, sent with recoveryRecordDamagedShown", false, true],
] as const)(
  "in the held state, %s, is refused setup.attempt_conflict, and nothing changes",
  async (_label, damaged, flag) => {
    const f = await heldSetup();
    if (damaged) await damageRecoveryRecord(f);
    const startAgain = await askStartAgain(f);
    expect(startAgain.shown.recoveryRecordDamaged).toBe(damaged ? true : undefined);
    await expectStartAgainRefused(
      f,
      () =>
        startAgain.run({
          confirmRecoveryDiscard: { shown: startAgain.shown },
          ...(flag && { recoveryRecordDamagedShown: true as const }),
        }),
      { code: "setup.attempt_conflict" },
    );
  },
);

it("a setup database that is not empty but holds no rows (a view only) is not the held state: the summary and Start again are refused setup.not_ready, and nothing changes", async () => {
  const f = await heldSetup();
  const before = await askStartAgain(f);
  for (const name of ["venue.db", "venue.db-wal", "venue.db-shm"])
    await rm(join(f.roots.venueDir, name), { force: true });
  const db = await openVenueDatabase(f.roots.venueDir);
  try {
    for (const set of TEST_MIGRATIONS) await applyMigrationSet(db.venue, set);
    db.venue.run(sql`create view held_probe as select 1 as one`);
  } finally {
    await db.close();
  }
  expect(await f.host.resolution.inspectFirstSetupResolution()).toMatchObject({
    database: "no-venue-rows",
    emptyDatabase: false,
  });
  await expectRefused(f, { code: "setup.not_ready" });
  const { shown } = before;
  const { ids } = await f.signIn();
  await expectStartAgainRefused(
    f,
    () => before.actions.startAgainFirstSetup({ ...ids, confirmRecoveryDiscard: { shown } }),
    { code: "setup.not_ready" },
  );
});

it("a setup database whose -wal holds no rows stays refused setup.not_ready when its main file alone still holds one, and nothing changes", async () => {
  const f = await heldSetup();
  const before = await askStartAgain(f);
  for (const name of ["venue.db", "venue.db-wal", "venue.db-shm"])
    await rm(join(f.roots.venueDir, name), { force: true });
  const db = await openVenueDatabase(f.roots.venueDir);
  try {
    for (const set of TEST_MIGRATIONS) await applyMigrationSet(db.venue, set);
    db.venue.run(sql`create table held_probe_rows (n)`);
    db.venue.run(sql`insert into held_probe_rows values (1)`);
  } finally {
    await db.close();
  }
  // The row's deletion and a view stay in the -wal: the files are copied while the database is open.
  const venueDb = join(f.roots.venueDir, "venue.db");
  const writer = new DatabaseSync(venueDb);
  let files: [Buffer, Buffer];
  try {
    writer.exec(
      "pragma wal_autocheckpoint = 0; delete from held_probe_rows; create view held_probe as select 1 as one",
    );
    files = [await readFile(venueDb), await readFile(`${venueDb}-wal`)];
  } finally {
    writer.close();
  }
  await writeFile(venueDb, files[0]);
  await writeFile(`${venueDb}-wal`, files[1]);
  await rm(`${venueDb}-shm`, { force: true });
  const main = new DatabaseSync(`file:${venueDb}?immutable=1`, { readOnly: true });
  try {
    expect(main.prepare("select count(*) as n from held_probe_rows").get()).toEqual({ n: 1 });
  } finally {
    main.close();
  }
  expect(await f.host.resolution.inspectFirstSetupResolution()).toMatchObject({
    database: "no-venue-rows",
    emptyDatabase: false,
  });
  await expectRefused(f, { code: "setup.not_ready" });
  const { shown } = before;
  const { ids } = await f.signIn();
  await expectStartAgainRefused(
    f,
    () => before.actions.startAgainFirstSetup({ ...ids, confirmRecoveryDiscard: { shown } }),
    { code: "setup.not_ready" },
  );
});

it("in the held state, an invoice record refuses Start again kept-records even when the fiscal module lists its invoice table, and every other append-only table, as deletable, and nothing changes", async () => {
  // A sale also writes append-only rows outside the invoice table; listing them all leaves kept 0.
  const every = manifestSets().flatMap((set) => set.appendOnlyTables);
  expect(every).toContain(getTableName(registrosFacturacion));
  extraDeletable.set("fiscal-verifactu", every);
  const f = await heldSetup({ invoices: 1 });
  await expectStartAgainRefused(f, await handMade(f, true), {
    code: "setup.start_again_refused",
    params: { cause: "kept-records" },
    reason: expect.stringMatching(/^rows=\d+ kept=0 records=1 accepted=0$/),
  });
});

it("in the held state, an invoice record refuses Start again kept-records, and nothing changes", async () => {
  const f = await heldSetup({ invoices: 1 });
  await expectStartAgainRefused(f, await handMade(f, true), {
    code: "setup.start_again_refused",
    params: { cause: "kept-records" },
  });
});

it("in the held state, saved trading settings refuse Start again trading-settings, and nothing changes", async () => {
  const f = await heldSetup({ tradingSettings: true });
  await expectStartAgainRefused(f, await handMade(f, true), {
    code: "setup.start_again_refused",
    params: { cause: "trading-settings" },
  });
});

it("in the held state, a complete attempt with no saved trading settings refuses Start again setup-finished, and nothing changes", async () => {
  const f = await heldSetup({ status: "complete" });
  await expectStartAgainRefused(f, await handMade(f, false), {
    code: "setup.start_again_refused",
    params: { cause: "setup-finished" },
  });
});

it("in the held state, a request carrying confirmMissingDatabase is refused setup.attempt_conflict, and nothing changes", async () => {
  const f = await heldSetup();
  const startAgain = await askStartAgain(f);
  await expectStartAgainRefused(
    f,
    () =>
      startAgain.run({
        confirmRecoveryDiscard: { shown: startAgain.shown },
        confirmMissingDatabase: { nothingFiledOrSold: true, shown: startAgain.shown },
      }),
    { code: "setup.attempt_conflict" },
  );
});

it("in the held state, a request answering no-current-master is refused setup.not_ready, and nothing changes", async () => {
  const f = await heldSetup();
  const startAgain = await askStartAgain(f);
  await expectStartAgainRefused(
    f,
    () =>
      startAgain.run({
        confirmRecoveryDiscard: { shown: startAgain.shown },
        register: { kind: "no-current-master", confirmed: true },
      }),
    { code: "setup.not_ready" },
  );
});

it("in the held state, the Start again route passes the shown summary on, so confirming it over HTTPS starts again", async () => {
  const f = await heldSetup();
  const startAgain = await askStartAgain(f);
  const app = new Hono();
  mountFirstSetupResolutionApi(app, f.host, () => {}, {
    startAgain: startAgain.actions.startAgainFirstSetup,
  });
  const socket = new TLSSocket(new Socket());
  try {
    const response = await app.request(
      "https://box.test/setup-api/first-setup/resolution/start-again",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...startAgain.ids,
          confirmRecoveryDiscard: { shown: startAgain.shown },
        }),
      },
      { incoming: { socket } },
    );
    expect(await response.json()).toEqual({ restarting: true });
    expect(response.status).toBe(200);
  } finally {
    socket.destroy();
  }
  expect((await f.workspace.readChain()).at(-1)!.phase).toBe("abandoned");
});

it("in the held state, the Start again route answers a refusal HTTP 409 with its cause, and nothing changes", async () => {
  const f = await heldSetup({ invoices: 1 });
  const { ids } = await f.signIn();
  const actions = createFirstSetupResolutionActions({
    ...f.roots,
    host: f.host,
    ...(f.service === undefined ? {} : { backupRecovery: f.service }),
  });
  // The summary is refused here, so this is the one a page would last have shown.
  const shown = {
    reached: "fiscal-finished",
    recovery: {
      startedAt: "2026-10-24T13:50:12.000Z",
      lastActiveAt: "2026-10-24T13:51:12.000Z",
      lastActiveSource: "memory",
      failed: false,
      cloud: false,
    },
  };
  const app = new Hono();
  mountFirstSetupResolutionApi(app, f.host, () => {}, {
    startAgain: actions.startAgainFirstSetup,
  });
  const before = await snapshot(f);
  const socket = new TLSSocket(new Socket());
  try {
    const response = await app.request(
      "https://box.test/setup-api/first-setup/resolution/start-again",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...ids,
          confirmRecoveryDiscard: { shown },
        }),
      },
      { incoming: { socket } },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "setup.start_again_refused", params: { cause: "kept-records" } },
    });
  } finally {
    socket.destroy();
  }
  expect(await snapshot(f)).toEqual(before);
});
