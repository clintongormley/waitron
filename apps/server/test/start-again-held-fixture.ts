import { heldSetup } from "./held-setup-database.js";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { Hono } from "hono";
import { access, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getTableName } from "drizzle-orm";
import { afterEach, expect, vi } from "vitest";
import {
  START_AGAIN_CONFIRMATIONS_DIR,
  readStartAgainMarker,
  type StartAgainSummary,
} from "@waitron/provisioning";
import { registrosFacturacion } from "@waitron/fiscal-verifactu/src/schema/registros.js";
import {
  createFirstSetupResolutionActions,
  type StartAgainFirstSetupRequest,
} from "../src/first-setup-resolution.js";
import { mountFirstSetupResolutionApi } from "../src/setup-first-fiscal-api.js";
import { diskSnapshot, expectStartAgainDeleted } from "./start-again-deleted.js";
import { agreeInternet, archiveForm, restoreApp } from "./hour-recovery-host.js";
import { stageRestoreRequest } from "../src/restore-request.js";

// Tables a test adds to a module's `startAgainDeletable`, as the holdings reader sees it.
const extraDeletable = vi.hoisted(() => new Map<string, readonly string[]>());

vi.mock("../src/modules.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules.js")>();
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

vi.mock("../src/first-setup-database-holdings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/first-setup-database-holdings.js")>();
  return {
    ...actual,
    readSetupDatabase: (...args: Parameters<typeof actual.readSetupDatabase>) => {
      holdingsRead.calls += 1;
      return actual.readSetupDatabase(...args);
    },
  };
});

const copyFails = vi.hoisted(() => ({ on: false, calls: 0 }));

vi.mock("../src/venue-private-copy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/venue-private-copy.js")>();
  return {
    ...actual,
    copyVenueFiles: (...args: Parameters<typeof actual.copyVenueFiles>) => {
      if (!copyFails.on) return actual.copyVenueFiles(...args);
      copyFails.calls += 1;
      return Promise.reject(Object.assign(new Error("no space"), { code: "ENOSPC" }));
    },
  };
});

afterEach(() => {
  copyFails.on = false;
  copyFails.calls = 0;
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

/** Asks for the summary through its route; answers the kept-records refusal's log reason. */
async function keptRecordsLogReason(f: Held) {
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
  return refusal?.fields?.logReason;
}

const notReady = { code: "setup.not_ready" };

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
          at: string;
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

/** Leaves the fiscal module's recovery-key record unreadable, as a damaged disk would. */
const damageRecoveryRecord = (f: Held) =>
  writeFile(
    join(f.roots.stateDir, "first-fiscal-documents", "fiscal-verifactu.recovery.json"),
    "{}",
  );

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

/** A held setup with its venue.db gone, and the modules.json activation wrote, which the missing path refuses. */
async function missingHeldDatabase(): Promise<Held & { service: undefined }> {
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

const venueDb = (f: Pick<Held, "roots">) => join(f.roots.venueDir, "venue.db");

const invoiceTable = getTableName(registrosFacturacion);

const labelOf = async (f: Held) => (await f.host.resolution.inspectFirstSetupResolution()).database;

/** The summary with nobody signed in; Start again without the page's confirmation refuses. */
async function unreadableSummary(f: Held, host: Held["host"] = f.host) {
  const { ids, actions } = await withoutSignIn(f, host);
  const shown = await actions.startAgainSummary(ids);
  await expectStartAgainRefused(f, () => actions.startAgainFirstSetup(ids), {
    code: "setup.attempt_conflict",
  });
  return shown;
}

/** Start again sent as the page sends it after showing "cannot be read": the setup is deleted. */
async function expectUnreadableDeleted(
  f: Held,
  shown: StartAgainSummary,
  host: Held["host"] = f.host,
) {
  const { ids, actions } = await withoutSignIn(f, host);
  await expect(
    actions.startAgainFirstSetup({ ...ids, confirmUnreadableDatabase: { shown } }),
  ).resolves.toBeUndefined();
  await expectStartAgainDeleted(f.roots);
  const records = await confirmations(f.roots.stateDir);
  expect(records).toHaveLength(1);
  expect(records[0]!.database).toBe("unreadable");
  expect(records[0]!.shown).toEqual(shown);
}

async function expectHeldRefused(f: Held, refusal: object, host: Held["host"] = f.host) {
  const { ids, actions } = await withoutSignIn(f, host);
  await expectStartAgainRefused(f, () => actions.startAgainSummary(ids).then(() => {}), refusal);
  await expectStartAgainRefused(f, () => actions.startAgainFirstSetup(ids), refusal);
}

const keptRecords = { code: "setup.start_again_refused", params: { cause: "kept-records" } };

/** The modules, with the fiscal module's holdings seat recording what it answered. */
function recordingFiscalSeat(f: Held) {
  const answers: unknown[] = [];
  const modules = f.host.modules.map((module) => {
    const initialSetup = module.provisioning?.initialSetup;
    const seat = initialSetup?.startAgainHoldings;
    if (module.name !== "fiscal-verifactu" || seat === undefined) return module;
    return {
      ...module,
      provisioning: {
        ...module.provisioning,
        initialSetup: {
          ...initialSetup,
          startAgainHoldings: async (...args: Parameters<typeof seat>) => {
            try {
              const resolved = await seat(...args);
              answers.push({ resolved });
              return resolved;
            } catch (error) {
              answers.push({ rejected: true, errcode: (error as { errcode?: number }).errcode });
              throw error;
            }
          },
        },
      },
    };
  });
  expect(answers).toEqual([]);
  return { host: { ...f.host, modules } as Held["host"], answers };
}

/** The actions with the backup service, and a lock that refuses when `lockRefused` is set. */
function heldActions(f: Held, lockRefused = false) {
  return createFirstSetupResolutionActions({
    ...f.roots,
    host: f.host,
    ...(f.service === undefined ? {} : { backupRecovery: f.service }),
    ...(lockRefused && {
      lock: async () => {
        throw new Error("lock refused");
      },
    }),
  });
}

async function currentIds(f: Held) {
  const current = await f.host.resolution.inspectFirstSetupResolution();
  return {
    inspectionId: current.inspectionId,
    revision: current.revision!,
    ownerGeneration: current.ownerGeneration!,
  };
}

/** Start again discards the stopped recovery, then fails to empty it. */
async function abandonUnemptied(f: Held) {
  const ids = await currentIds(f);
  const failing = heldActions(f, true);
  const shown = await failing.startAgainSummary(ids);
  await expect(
    failing.startAgainFirstSetup({ ...ids, confirmRecoveryDiscard: { shown } }),
  ).rejects.toMatchObject({ code: "setup.start_again_incomplete" });
  expect((await f.workspace.readChain()).at(-1)!.phase).toBe("abandoned");
  return shown;
}

/** Drops tables beside the reader, with foreign keys off, as a part-applied setup leaves them. */
function dropTables(f: Pick<Held, "roots">, tables: readonly string[]) {
  const db = new DatabaseSync(venueDb(f));
  try {
    db.exec("pragma foreign_keys = off");
    for (const table of tables) db.exec(`drop table ${table}`);
  } finally {
    db.close();
  }
}
export {
  extraDeletable,
  holdingsRead,
  copyFails,
  snapshot,
  summary,
  expectRefused,
  keptRecordsLogReason,
  notReady,
  askStartAgain,
  confirmations,
  expectStartAgainRefused,
  LEFT_VENUE,
  LEFT_STATE,
  damageRecoveryRecord,
  handMade,
  withoutSignIn,
  noConfirmations,
  missingHeldDatabase,
  startAgainMissing,
  stageFreshRestore,
  exists,
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
  dropTables,
};

export type { Held };
