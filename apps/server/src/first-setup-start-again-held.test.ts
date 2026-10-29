import { heldSetup } from "../test/held-setup-database.js";
import { createHash } from "node:crypto";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { Hono } from "hono";
import { access, lstat, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getTableName, sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { openVenueDatabase } from "@waitron/db";
import { applyMigrationSet } from "@waitron/db/testing/venue-db.js";
import { manifestSets } from "@waitron/migrations";
import {
  START_AGAIN_CONFIRMATIONS_DIR,
  readStartAgainMarker,
  type StartAgainSummary,
} from "@waitron/provisioning";
import { registrosFacturacion } from "@waitron/fiscal-verifactu/src/schema/registros.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import {
  createFirstSetupResolutionActions,
  type StartAgainFirstSetupRequest,
} from "./first-setup-resolution.js";
import { mountFirstSetupResolutionApi } from "./setup-first-fiscal-api.js";

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
    readSetupDatabaseHoldings: (...args: Parameters<typeof actual.readSetupDatabaseHoldings>) => {
      holdingsRead.calls += 1;
      return actual.readSetupDatabaseHoldings(...args);
    },
  };
});

type WithRecovery = Awaited<ReturnType<typeof heldSetup>>;
type Held = Omit<WithRecovery, "service"> & { service: WithRecovery["service"] | undefined };

// The rows a real activation stopped at `committed` leaves with the helper's module set.
const ACTIVATION_ROWS = 105;

async function tree(dir: string, prefix = ""): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of (await readdir(join(dir, prefix))).sort()) {
    const relative = prefix === "" ? name : `${prefix}/${name}`;
    // Every exclusive turn rewrites the anchor's own lock pair.
    if (prefix === "" && /^venue\.(lock|holder)/.test(name)) continue;
    if ((await lstat(join(dir, relative))).isDirectory()) {
      result[`${relative}/`] = "";
      Object.assign(result, await tree(dir, relative));
    } else
      result[relative] = createHash("sha256")
        .update(await readFile(join(dir, relative)))
        .digest("hex");
  }
  return result;
}
const snapshot = async (f: Pick<Held, "roots">) => ({
  venue: await tree(f.roots.venueDir),
  state: await tree(f.roots.stateDir),
});

/**
 * Signs the setup owner in, then answers a call that asks for the summary. A setup whose
 * publication completed cannot be signed into again, so with `signIn: false` it asks without an
 * owner.
 */
async function signedIn(f: Held, host: Held["host"] = f.host, signIn = true) {
  const request = signIn
    ? await f.signIn().then(({ owner, ids }) => ({ ...ids, owner }))
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

it("a legitimate held setup database beside a stopped recovery answers the summary with what it holds", async () => {
  const f = await heldSetup();
  const shown = await summary(f);
  expect(shown).toEqual({
    reached: "fiscal-finished",
    lastName: f.installationName,
    recovery: {
      startedAt: expect.any(String),
      lastActiveAt: expect.any(String),
      lastActiveSource: expect.any(String),
      lastName: expect.toBeOneOf([null, expect.any(String)]),
      failed: false,
      cloud: false,
    },
    held: { rows: ACTIVATION_ROWS, kept: 0, records: 0, accepted: 0 },
  });
});

it("a held setup database with an invoice record still answers the summary, counting it", async () => {
  const f = await heldSetup({ invoices: 1 });
  const shown = await summary(f);
  expect(shown.held).toMatchObject({ records: 1, accepted: 0 });
  expect(shown.held!.kept).toBeGreaterThanOrEqual(1);
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

it("a held setup database with no recovery started is still refused setup.not_ready, and nothing changes", async () => {
  await expectRefused(await heldSetup({ recovery: false }), { code: "setup.not_ready" });
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
  ["saved trading settings", { recovery: false, tradingSettings: true }, true],
  ["a complete attempt", { recovery: false, status: "complete" }, false],
] as const)(
  "%s with no recovery started is refused setup.not_ready, not start_again_refused, and nothing changes",
  async (_label, options, signIn) => {
    await expectRefused(await heldSetup(options), { code: "setup.not_ready" }, { signIn });
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
  const { owner, ids } = await f.signIn();
  const actions = createFirstSetupResolutionActions({
    ...f.roots,
    host,
    ...(f.service === undefined ? {} : { backupRecovery: f.service }),
  });
  const shown = await actions.startAgainSummary({ ...ids, owner });
  return {
    shown,
    owner,
    ids,
    actions,
    run: (extra: Partial<StartAgainFirstSetupRequest> = { confirmRecoveryDiscard: { shown } }) =>
      actions.startAgainFirstSetup({ ...ids, owner, ...extra }),
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

it("in the held state, Start again confirming the summary deletes the setup, and keeps who chose it", async () => {
  const f = await heldSetup();
  const startAgain = await askStartAgain(f);
  expect(startAgain.shown.held).toBeDefined();
  await expect(startAgain.run()).resolves.toBeUndefined();
  const left = await snapshot(f);
  expect(Object.keys(left.venue).filter((name) => !LEFT_VENUE.test(name))).toEqual([]);
  expect(Object.keys(left.state).filter((name) => !LEFT_STATE.test(name))).toEqual([]);
  const records = await confirmations(f.roots.stateDir);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ database: "present", shown: startAgain.shown });
  expect((records[0]!.shown as StartAgainSummary).held).toEqual(startAgain.shown.held);
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
  expect(startAgain.shown).toMatchObject({ recoveryRecordDamaged: true, held: expect.any(Object) });
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
  // The summary the page would have shown had the counts been read: nothing.
  const shown = { ...before.shown, held: { rows: 0, kept: 0, records: 0, accepted: 0 } };
  const { owner, ids } = await f.signIn();
  await expectStartAgainRefused(
    f,
    () => before.actions.startAgainFirstSetup({ ...ids, owner, confirmRecoveryDiscard: { shown } }),
    { code: "setup.not_ready" },
  );
});

it("in the held state, an invoice record refuses Start again kept-records even when the fiscal module lists its invoice table, and every other append-only table, as deletable, and nothing changes", async () => {
  // A sale also writes append-only rows outside the invoice table; listing them all leaves kept 0.
  const every = manifestSets().flatMap((set) => set.appendOnlyTables);
  expect(every).toContain(getTableName(registrosFacturacion));
  extraDeletable.set("fiscal-verifactu", every);
  const f = await heldSetup({ invoices: 1 });
  const startAgain = await askStartAgain(f);
  expect(startAgain.shown.held).toMatchObject({ kept: 0, records: 1 });
  await expectStartAgainRefused(f, () => startAgain.run(), {
    code: "setup.start_again_refused",
    params: { cause: "kept-records" },
  });
});

it("in the held state, an invoice record refuses Start again kept-records, and nothing changes", async () => {
  const f = await heldSetup({ invoices: 1 });
  const startAgain = await askStartAgain(f);
  await expectStartAgainRefused(f, () => startAgain.run(), {
    code: "setup.start_again_refused",
    params: { cause: "kept-records" },
  });
});

/** A request for a setup whose summary is refused, so `shown` is the one a page would last have. */
async function handMade(f: Held, signIn: boolean, confirm = true) {
  const ids = signIn
    ? await f.signIn()
    : {
        owner: undefined,
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
  const shown: StartAgainSummary = {
    reached: "fiscal-finished",
    lastName: f.installationName,
    held: { rows: ACTIVATION_ROWS, kept: 0, records: 0, accepted: 0 },
  };
  return () =>
    actions.startAgainFirstSetup({
      ...ids.ids,
      ...(ids.owner === undefined ? {} : { owner: ids.owner }),
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

it("in the held state, a confirmation whose summary has no held counts is refused setup.attempt_conflict, and nothing changes", async () => {
  const f = await heldSetup();
  const startAgain = await askStartAgain(f);
  const withoutHeld = { ...startAgain.shown };
  delete withoutHeld.held;
  await expectStartAgainRefused(
    f,
    () => startAgain.run({ confirmRecoveryDiscard: { shown: withoutHeld } }),
    { code: "setup.attempt_conflict" },
  );
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

it("a held setup database with no recovery started still refuses Start again setup.not_ready, and nothing changes", async () => {
  const f = await heldSetup({ recovery: false });
  // With no recovery, a confirmRecoveryDiscard is refused setup.attempt_conflict before this check.
  await expectStartAgainRefused(f, await handMade(f, true, false), { code: "setup.not_ready" });
});

it("in the held state, the Start again route passes the shown held counts on, so confirming the summary over HTTPS starts again", async () => {
  const f = await heldSetup();
  const startAgain = await askStartAgain(f);
  expect(startAgain.shown.held).toBeDefined();
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
          "X-Waitron-Setup-Owner": startAgain.owner.capability,
          "X-Waitron-Setup-Attempt": startAgain.owner.attemptId,
          "X-Waitron-Setup-Revision": String(startAgain.owner.revision),
          "X-Waitron-Setup-Generation": String(startAgain.owner.ownerGeneration),
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
  const startAgain = await askStartAgain(f);
  const app = new Hono();
  mountFirstSetupResolutionApi(app, f.host, () => {}, {
    startAgain: startAgain.actions.startAgainFirstSetup,
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
          "X-Waitron-Setup-Owner": startAgain.owner.capability,
          "X-Waitron-Setup-Attempt": startAgain.owner.attemptId,
          "X-Waitron-Setup-Revision": String(startAgain.owner.revision),
          "X-Waitron-Setup-Generation": String(startAgain.owner.ownerGeneration),
        },
        body: JSON.stringify({
          ...startAgain.ids,
          confirmRecoveryDiscard: { shown: startAgain.shown },
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
