import { heldSetup } from "../test/held-setup-database.js";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { Hono } from "hono";
import { access, readFile, readdir, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getTableName, sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { openVenueDatabase } from "@waitron/db";
import { applyMigrationSet } from "@waitron/db/testing/venue-db.js";
import { manifestSets } from "@waitron/migrations";
import {
  START_AGAIN_CONFIRMATIONS_DIR,
  assertStartAgainAllowedOnDisk,
  finishStartAgainDeletion,
  firstSetupFrozenDigest,
  startAgainMarkerFor,
  writeStartAgainMarker,
  readStartAgainMarker,
  resolveFirstSetupBackupWorkspace,
  type StartAgainSummary,
} from "@waitron/provisioning";
import { registrosFacturacion } from "@waitron/fiscal-verifactu/src/schema/registros.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import {
  createFirstSetupResolutionActions,
  type StartAgainFirstSetupRequest,
} from "./first-setup-resolution.js";
import { mountFirstSetupResolutionApi } from "./setup-first-fiscal-api.js";
import { diskSnapshot, expectStartAgainDeleted } from "../test/start-again-deleted.js";
import { foreignHotJournal } from "../test/foreign-journal.js";
import { agreeInternet, archiveForm, clock, restoreApp } from "../test/hour-recovery-host.js";
import { createSelectedRecoveryPreparation } from "./recovery-preparation.js";
import { recoverySelectPastWaits } from "./testing/hour-test-clock.js";
import { runStagedRestore, stageRestoreRequest } from "./restore-request.js";

// Tables a test adds to a module's `startAgainDeletable`, as the holdings reader sees it.
const extraDeletable = vi.hoisted(() => new Map<string, readonly string[]>());
vi.mock("./modules.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./modules.js")>();
  return {
    ...actual,
    ALL_MODULES: actual.ALL_MODULES.map((module) => ({
      ...module,
      get startAgainDeletable() {
        const extra = extraDeletable.get(module.name);
        return extra === undefined
          ? module.startAgainDeletable
          : [...(module.startAgainDeletable ?? []), ...extra];
      },
    })),
  };
});
afterEach(() => extraDeletable.clear());
const holdingsRead = vi.hoisted(() => ({ calls: 0 }));
vi.mock("./first-setup-database-holdings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./first-setup-database-holdings.js")>();
  return {
    ...actual,
    readSetupDatabase: (...args: Parameters<typeof actual.readSetupDatabase>) => {
      holdingsRead.calls += 1;
      return actual.readSetupDatabase(...args);
    },
  };
});

type WithRecovery = Awaited<ReturnType<typeof heldSetup>>;
type Held = Omit<WithRecovery, "service"> & { service: WithRecovery["service"] | undefined };

const snapshot = (f: Pick<Held, "roots">) => diskSnapshot(f.roots);

/**
 * Signs the setup owner in, then answers a call that asks for the summary. A setup whose
 * publication completed cannot be signed into again, so with `signIn: false` it asks without
 * signing in.
 */
async function signedIn(f: Held, host: Held["host"] = f.host, signIn = true) {
  const request = signIn
    ? await f.signIn().then(({ ids }) => ids)
    : await host.resolution.inspectFirstSetupResolution().then((current) => ({
        inspectionId: current.inspectionId,
        revision: current.revision!,
        ownerGeneration: current.ownerGeneration!,
      }));
  const actions = createFirstSetupResolutionActions({
    ...f.roots,
    host,
    ...(f.service === undefined ? {} : { backupRecovery: f.service }),
  });
  return () => actions.startAgainSummary(request);
}
const summary = async (f: Held) => (await signedIn(f))();

/** Asks for the summary, and checks the refusal changed nothing on disk. */
async function expectRefused(
  f: Held,
  refusal: object,
  { host, signIn = true }: { host?: Held["host"]; signIn?: boolean } = {},
) {
  const ask = await signedIn(f, host, signIn);
  const before = await snapshot(f);
  await expect(ask()).rejects.toMatchObject(refusal);
  expect(await snapshot(f)).toEqual(before);
}

it("a legitimate held setup database beside a stopped recovery answers the summary", async () => {
  const f = await heldSetup();
  const shown = await summary(f);
  expect(shown).toEqual({
    reached: "fiscal-finished",
    recovery: {
      startedAt: expect.any(String),
      lastActiveAt: expect.any(String),
      lastActiveSource: expect.any(String),
      failed: false,
      cloud: false,
    },
  });
});

it("a held setup database with an invoice record refuses the summary kept-records, and nothing changes", async () => {
  await expectRefused(await heldSetup({ invoices: 1 }), {
    code: "setup.start_again_refused",
    params: { cause: "kept-records" },
  });
});

it("the summary's kept-records refusal logs the counts, not the answer", async () => {
  const f = await heldSetup({ invoices: 1 });
  const { ids } = await f.signIn();
  const actions = createFirstSetupResolutionActions({
    ...f.roots,
    host: f.host,
    ...(f.service === undefined ? {} : { backupRecovery: f.service }),
  });
  const lines: { level: string; event: string; fields?: Record<string, unknown> }[] = [];
  const app = new Hono();
  mountFirstSetupResolutionApi(
    app,
    f.host,
    (level, event, fields) => lines.push({ level, event, fields }),
    {
      summary: actions.startAgainSummary,
    },
  );
  const socket = new TLSSocket(new Socket());
  try {
    const response = await app.request(
      "https://box.test/setup-api/first-setup/resolution/start-again/summary",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(ids),
      },
      { incoming: { socket } },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "setup.start_again_refused", params: { cause: "kept-records" } },
    });
  } finally {
    socket.destroy();
  }
  const refusal = lines.find((line) => line.event === "setup.start_again_refused");
  expect(refusal?.level).toBe("warn");
  expect(refusal?.fields?.logReason).toMatch(/^rows=\d+ kept=\d+ records=1 accepted=0$/);
});

it.each([
  ["committed", { tradingSettings: true }, true],
  ["complete", { status: "complete", tradingSettings: true }, false],
] as const)(
  "saved trading settings beside a held database (attempt %s) refuse setup.start_again_refused trading-settings, and nothing changes",
  async (_label, options, signIn) => {
    await expectRefused(
      await heldSetup(options),
      { code: "setup.start_again_refused", params: { cause: "trading-settings" } },
      { signIn },
    );
  },
);

it("a complete attempt with no saved trading settings refuses setup.start_again_refused setup-finished, and nothing changes", async () => {
  await expectRefused(
    await heldSetup({ status: "complete" }),
    { code: "setup.start_again_refused", params: { cause: "setup-finished" } },
    { signIn: false },
  );
});

it("a held summary the disk check refuses is refused before what the setup database holds is read, and nothing changes", async () => {
  const f = await heldSetup();
  const node = new DatabaseSync(join(f.roots.venueDir, "node.db"));
  node.exec("create table t(x)");
  node.close();
  holdingsRead.calls = 0;
  await expectRefused(f, { code: "setup.not_ready", reason: "node.db holds a table" });
  expect(holdingsRead.calls).toBe(0);
});

it.each([
  ["saved trading settings", "trading-settings", { recovery: false, tradingSettings: true }, true],
  ["a complete attempt", "setup-finished", { recovery: false, status: "complete" }, false],
  ["an invoice record", "kept-records", { recovery: false, invoices: 1 }, true],
] as const)(
  "%s with no recovery started refuses the summary and Start again setup.start_again_refused %s, and nothing changes",
  async (_label, cause, options, signIn) => {
    const f = await heldSetup(options);
    const refusal = { code: "setup.start_again_refused", params: { cause } };
    await expectRefused(f, refusal, { signIn });
    await expectStartAgainRefused(f, await handMade(f, signIn, false), refusal);
  },
);

it.each([
  ["unknown", {}],
  ["partial", {}],
  ["unknown", { tradingSettings: true }],
  ["partial", { tradingSettings: true }],
] as const)(
  "a database read as %s beside a stopped recovery (%o) is still refused setup.not_ready, and nothing changes",
  async (database, options) => {
    const f = await heldSetup(options);
    const inspect = f.host.resolution.inspectFirstSetupResolution;
    const host = {
      ...f.host,
      resolution: {
        ...f.host.resolution,
        inspectFirstSetupResolution: async () => ({ ...(await inspect()), database }),
      },
    } as Held["host"];
    await expectRefused(f, { code: "setup.not_ready" }, { host });
  },
);

/** Signs the owner in and asks for the summary; `run` sends Start again confirming it. */
async function askStartAgain(f: Held, host: Held["host"] = f.host) {
  const { ids } = await f.signIn();
  const actions = createFirstSetupResolutionActions({
    ...f.roots,
    host,
    ...(f.service === undefined ? {} : { backupRecovery: f.service }),
  });
  const shown = await actions.startAgainSummary({ ...ids });
  return {
    shown,
    ids,
    actions,
    run: (extra: Partial<StartAgainFirstSetupRequest> = { confirmRecoveryDiscard: { shown } }) =>
      actions.startAgainFirstSetup({ ...ids, ...extra }),
  };
}

async function confirmations(stateDir: string) {
  const folder = join(stateDir, START_AGAIN_CONFIRMATIONS_DIR);
  return Promise.all(
    (await readdir(folder)).map(
      async (name) =>
        JSON.parse(await readFile(join(folder, name), "utf8")) as {
          database: string;
          shown: unknown;
        },
    ),
  );
}

/** Sends Start again, and checks the refusal changed nothing: files, journal, records. */
async function expectStartAgainRefused(f: Held, send: () => Promise<void>, refusal: object) {
  const before = await snapshot(f);
  const last = (await f.workspace.readChain()).at(-1);
  await expect(send()).rejects.toMatchObject(refusal);
  expect(await snapshot(f)).toEqual(before);
  expect((await f.workspace.readChain()).at(-1)).toEqual(last);
  expect(await readStartAgainMarker(f.roots.venueDir)).toBeNull();
  await expect(access(join(f.roots.stateDir, START_AGAIN_CONFIRMATIONS_DIR))).rejects.toMatchObject(
    { code: "ENOENT" },
  );
}

// What Start again leaves: the anchor's lock files, the confirmation record, and the discarded
// recovery's journal pointer, records and its target's lock files.
const LEFT_VENUE = /^(venue|recovery|migrations)\.lock(-journal)?$|^venue\.holder\.json$/;
const LEFT_STATE =
  /^(first-setup-start-again-confirmations\/(\w|[-.])*|first-setup-resolutions\/|first-setup-resolutions\/backup-recovery\/(current\.json)?|first-setup-resolutions\/backup-recovery\/[^/]+\/(\d{6}\.json|target\/|target\/(venue|state)\/|target\/(venue|state)\/((venue|migrations|recovery)\.lock(-journal)?|venue\.holder\.json))?)$/;

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

/** Leaves the fiscal module's recovery-key record unreadable, as a damaged disk would. */
const damageRecoveryRecord = (f: Held) =>
  writeFile(
    join(f.roots.stateDir, "first-fiscal-documents", "fiscal-verifactu.recovery.json"),
    "{}",
  );

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

/** A request for a setup whose summary is refused, so `shown` is the one a page would last have. */
async function handMade(f: Held, signIn: boolean, confirm = true) {
  const ids = signIn
    ? await f.signIn()
    : {
        ids: await f.host.resolution.inspectFirstSetupResolution().then((current) => ({
          inspectionId: current.inspectionId,
          revision: current.revision!,
          ownerGeneration: current.ownerGeneration!,
        })),
      };
  const actions = createFirstSetupResolutionActions({
    ...f.roots,
    host: f.host,
    ...(f.service === undefined ? {} : { backupRecovery: f.service }),
  });
  const shown: StartAgainSummary = { reached: "fiscal-finished" };
  return () =>
    actions.startAgainFirstSetup({
      ...ids.ids,
      ...(confirm && { confirmRecoveryDiscard: { shown } }),
    });
}

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

/** The ids a page holds after reading the inspection, with nobody signed in. */
async function withoutSignIn(f: Held, host: Held["host"] = f.host) {
  const current = await host.resolution.inspectFirstSetupResolution();
  const ids = {
    inspectionId: current.inspectionId,
    revision: current.revision!,
    ownerGeneration: current.ownerGeneration!,
  };
  const actions = createFirstSetupResolutionActions({ ...f.roots, host });
  return { ids, actions };
}

const noConfirmations = (f: Held) =>
  expect(access(join(f.roots.stateDir, START_AGAIN_CONFIRMATIONS_DIR))).rejects.toMatchObject({
    code: "ENOENT",
  });

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

/** A held setup with its venue.db gone, and the modules.json activation wrote, which the missing path refuses. */
async function missingHeldDatabase() {
  const f = await heldSetup({ recovery: false });
  for (const name of ["venue.db", "venue.db-wal", "venue.db-shm"])
    await rm(join(f.roots.venueDir, name), { force: true });
  await rm(join(f.roots.stateDir, "modules.json"));
  expect((await f.host.resolution.inspectFirstSetupResolution()).database).toBe("missing");
  return f;
}
async function startAgainMissing(f: Held) {
  const { ids, actions } = await withoutSignIn(f);
  const shown = await actions.startAgainSummary(ids);
  await actions.startAgainFirstSetup({
    ...ids,
    confirmMissingDatabase: { nothingFiledOrSold: true, shown },
  });
  await expect(access(join(f.roots.stateDir, "first-setup.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
}

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

async function stageFreshRestore(f: Held, archive: Held["archive"] = f.archive) {
  const app = restoreApp({
    stageRestore: (request) => stageRestoreRequest(f.roots.stateDir, request),
  });
  const response = await app.request("https://box.test/setup-api/restore", {
    method: "POST",
    body: archiveForm(archive, {
      selectedSourceId: archive.options.selected.sourceId,
      oldBoxGone: true,
      soleRecovery: true,
    }),
  });
  expect(response.status).toBe(202);
  agreeInternet();
}
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

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
