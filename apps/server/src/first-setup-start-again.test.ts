import { readSetupFlowRecord, updateSetupFlowSection } from "@waitron/provisioning";
import { dirname, join } from "node:path";
import { modulesWithSets } from "@waitron/module";
import { createHash } from "node:crypto";
import {
  access,
  lstat,
  utimes,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { TLSSocket } from "node:tls";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { AppError } from "@waitron/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { openVenueDatabase } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ALL_MODULES } from "@waitron/composition";
import {
  START_AGAIN_MARKER_FILE,
  finishStartAgainDeletion,
  readStartAgainMarker,
  startAgainMarkerFor,
  writeStartAgainMarker,
  writeStartAgainChoice,
  firstSetupFrozenDigest,
  assertOtherFirstSetupAllowed,
  type FirstSetupChange,
  type StartAgainSummary,
} from "@waitron/provisioning";
import {
  EPOCH_MS,
  MINUTE_MS,
  decodeMinuteIdentity,
} from "@waitron/fiscal-verifactu/src/hour-identity.js";
import { hourFirstFiscalFixture } from "../test/hour-first-fiscal.js";
import { expectStartAgainDeleted } from "../test/start-again-deleted.js";
import { PASSWORD, request } from "../test/first-fiscal.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { createFirstSetupResolutionActions, markerRefusal } from "./first-setup-resolution.js";
import { createFirstSetupResolutionInspection } from "./first-setup-resolution-inspection.js";
import { firstSetupModuleContext } from "./first-fiscal-evidence.js";
import { createFakeTimersHourClock, selectPastWaits } from "./testing/hour-test-clock.js";
import {
  mountFirstSetupResolutionApi,
  mountSetupFirstFiscalApi,
} from "./setup-first-fiscal-api.js";
import { createLogger } from "./logger.js";
import { writeValidated } from "./restore.js";
import { runStagedRestore, stageRestoreRequest } from "./restore-request.js";
import { runRestore } from "./restore-command.js";
import { runStagedReset, stageResetRequest } from "./reset-request.js";
import { createSetupOperationStore } from "./setup-operation.js";
import { startServerOrFirstSetupResolution } from "./first-setup-launch.js";
import { mountSetup } from "./setup-api.js";
import { createRecoveryEntryRunner } from "./recovery-entry.js";
import { readSetupDatabase } from "./first-setup-database-holdings.js";

vi.mock("@waitron/provisioning", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/provisioning")>();
  return {
    ...actual,
    writeStartAgainMarker: vi.fn(actual.writeStartAgainMarker),
  };
});
vi.mock("./first-setup-database-holdings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./first-setup-database-holdings.js")>();
  return { ...actual, readSetupDatabase: vi.fn(actual.readSetupDatabase) };
});
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 500,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }),
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime("2026-10-16T11:40:00Z");
});
const fixtures: Awaited<ReturnType<typeof hourFirstFiscalFixture>>[] = [];
const roots: string[] = [];
const sockets: TLSSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(fixtures.splice(0).map((f) => f.dispose()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

type Host = ReturnType<typeof createFirstSetupModuleHost>;

async function abandonedAttempt() {
  const clock = createFakeTimersHourClock();
  const f = await hourFirstFiscalFixture({ clock, database: () => suite.db });
  fixtures.push(f);
  await suite.db.archiveTo(join(f.venueDir, "venue.db"));
  await (await openVenueDatabase(f.venueDir)).close();
  const abandoned = (await f.store.read())!;
  const name = (firstSetupModuleContext(abandoned, f.module).request as { identity: string })
    .identity;
  const actions = createFirstSetupResolutionActions({ ...f, host: f.host });
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  const startRequest = {
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
    register: {
      kind: "current-master" as const,
      status: "Consumed" as const,
      custodian: "Elena",
      reference: f.staged.ref.bindingDigest,
      consultedAt: "2026-10-16T12:20:00.000Z",
    },
  };
  return { f, clock, name, actions, startRequest };
}

async function startedAgain() {
  const { f, clock, name, actions, startRequest } = await abandonedAttempt();
  await actions.startAgainFirstSetup(startRequest);
  const folders = { stateDir: f.stateDir, venueDir: f.venueDir };
  const next = createFirstSetupModuleHost({
    ...folders,
    modules: f.modules,
    environment: {},
    database: () => suite.db,
  });
  const claim = await next.owner.claimFirstSetup({
    environment: "production",
    request: {
      ...request,
      seriesCode: "B",
      fullSeriesCode: "FULL",
      rectificativeSeriesCode: "RECT",
    },
  });
  const owner = { ...claim.state, capability: claim.capability };
  return { f, clock, name, folders, next, owner };
}

async function compareAndSelect(host: Host, owner: Parameters<Host["preparation"]["select"]>[0]) {
  const compared = (await host.preparation.prepare(
    owner,
    "fiscal-verifactu",
    { action: "compare-clocks", browser: null },
    { onBox: true },
  )) as { id: string };
  return host.preparation.select(
    owner,
    "fiscal-verifactu",
    { comparisonId: compared.id },
    await host.owner.reconfirm(owner, PASSWORD, "block-use"),
  );
}

async function chosenName(host: Host) {
  const state = (await host.store.read())!;
  return (firstSetupModuleContext(state, "fiscal-verifactu").request as { identity: string })
    .identity;
}

it("a new setup beside a leftover start-again note file names its minute as if there were none", async () => {
  const { clock, name, folders, next, owner } = await startedAgain();
  const nowMs = Date.now();
  await writeFile(
    join(folders.stateDir, "first-setup-start-again.json"),
    JSON.stringify({
      version: 1,
      floorMs: nowMs + 10 * MINUTE_MS,
      lastName: name,
      module: "fiscal-verifactu",
    }),
  );
  await selectPastWaits(clock, () => compareAndSelect(next, owner));
  expect(decodeMinuteIdentity(await chosenName(next))).toBeLessThan(
    Math.floor((nowMs + 10 * MINUTE_MS - EPOCH_MS) / MINUTE_MS),
  );
});

it("at the abandoned name's own minute, setup waits and then chooses a later name", async () => {
  const { clock, name, next, owner } = await startedAgain();
  vi.setSystemTime(EPOCH_MS + decodeMinuteIdentity(name) * MINUTE_MS);
  await selectPastWaits(clock, () => compareAndSelect(next, owner));
  expect(decodeMinuteIdentity(await chosenName(next))).toBeGreaterThan(decodeMinuteIdentity(name));
});

it("a clock past the abandoned name chooses a later name at once", async () => {
  const { clock, name, next, owner } = await startedAgain();
  vi.setSystemTime(EPOCH_MS + (decodeMinuteIdentity(name) + 6) * MINUTE_MS);
  // One move only: production setup's own 90 to 150 second wait.
  await selectPastWaits(clock, () => compareAndSelect(next, owner), 1);
  expect(decodeMinuteIdentity(await chosenName(next))).toBeGreaterThan(decodeMinuteIdentity(name));
});

async function claimedWithoutName() {
  const root = await mkdtemp(join(tmpdir(), "start-again-"));
  roots.push(root);
  const folders = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  await mkdir(folders.venueDir, { recursive: true });
  const host = createFirstSetupModuleHost({
    ...folders,
    modules: ALL_MODULES,
    environment: {},
    database: () => suite.db,
  });
  await host.owner.claimFirstSetup({ environment: "production", request });
  await suite.db.archiveTo(join(folders.venueDir, "venue.db"));
  const inspected = await host.resolution.inspectFirstSetupResolution();
  const startRequest = {
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
    register: { kind: "no-current-master" as const, confirmed: true as const },
  };
  return { folders, host, startRequest };
}

it("an attempt whose module never chose a name starts again", async () => {
  const { folders, host, startRequest } = await claimedWithoutName();
  await createFirstSetupResolutionActions({
    ...folders,
    host,
  }).startAgainFirstSetup(startRequest);
  await expectStartAgainDeleted(folders);
});

it("an attempt naming a module is refused when the host was given no modules to ask", async () => {
  const { folders, host, startRequest } = await claimedWithoutName();
  const withoutModules: Partial<typeof host> & Omit<typeof host, "modules"> = { ...host };
  delete withoutModules.modules;
  await expect(
    createFirstSetupResolutionActions({ ...folders, host: withoutModules }).startAgainFirstSetup(
      startRequest,
    ),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
});

it("two Start again requests at once delete the attempt once", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  const exclusion = f.host.resolution.withVenueExclusion.bind(f.host.resolution);
  let arrived = 0;
  let releaseBoth!: () => void;
  const bothArrived = new Promise<void>((resolve) => (releaseBoth = resolve));
  vi.spyOn(f.host.resolution, "withVenueExclusion").mockImplementation(async (run) => {
    arrived += 1;
    if (arrived === 2) releaseBoth();
    await bothArrived;
    return exclusion(run);
  });
  vi.mocked(writeStartAgainMarker).mockClear();
  const results = await Promise.allSettled([
    actions.startAgainFirstSetup(startRequest),
    actions.startAgainFirstSetup(startRequest),
  ]);
  expect(arrived).toBe(2);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const refusal = results.find((result) => result.status === "rejected");
  expect(refusal?.reason).toMatchObject({ code: "setup.attempt_conflict" });
  expect(vi.mocked(writeStartAgainMarker)).toHaveBeenCalledTimes(1);
  await expectAttemptGone(f);
});

it("Start again writes no start-again note", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  await actions.startAgainFirstSetup(startRequest);
  expect(await exists(join(f.stateDir, "first-setup-start-again.json"))).toBe(false);
});

it("Start again leaves a leftover note file byte for byte", async () => {
  const { f, name, actions, startRequest } = await abandonedAttempt();
  const path = join(f.stateDir, "first-setup-start-again.json");
  const leftover = Buffer.from(
    `{ "version": 1, "floorMs": ${EPOCH_MS}, "lastName": "${name}", "module": "fiscal-verifactu" }\n`,
  );
  await writeFile(path, leftover);
  await actions.startAgainFirstSetup(startRequest);
  expect(await readFile(path)).toEqual(leftover);
});

const CONFIRMATIONS = "records/choices";

async function missingDatabase(
  changes: readonly FirstSetupChange[] = [],
  afterRemove?: (f: Awaited<ReturnType<typeof abandonedAttempt>>["f"]) => Promise<void>,
) {
  const base = await abandonedAttempt();
  const { f } = base;
  let state = (await f.store.read())!;
  for (const change of changes)
    state = await f.store.update(state.frozen.attemptId, state.revision, change);
  await rm(join(f.venueDir, "venue.db"));
  await afterRemove?.(f);
  const current = await f.host.resolution.inspectFirstSetupResolution();
  const ids = {
    inspectionId: current.inspectionId,
    revision: current.revision!,
    ownerGeneration: current.ownerGeneration!,
  };
  return { ...base, ids, request: { ...ids, register: base.startRequest.register } };
}

function tls() {
  const socket = new TLSSocket(new Socket());
  sockets.push(socket);
  return { incoming: { socket } };
}

function routes(
  f: Awaited<ReturnType<typeof abandonedAttempt>>["f"],
  actions: ReturnType<typeof createFirstSetupResolutionActions>,
) {
  const app = new Hono();
  mountFirstSetupResolutionApi(app, f.host, () => {}, {
    startAgain: actions.startAgainFirstSetup,
    summary: actions.startAgainSummary,
  });
  return app;
}

async function postSummary(
  app: Hono,
  body: unknown,
  headers: Record<string, string>,
  env: object = tls(),
) {
  return app.request(
    "https://box.test/setup-api/first-setup/resolution/start-again/summary",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
    env,
  );
}

async function attemptFiles(f: Awaited<ReturnType<typeof abandonedAttempt>>["f"]) {
  return Promise.all(
    [
      join(f.stateDir, "flows/setup/record.json"),
      join(f.stateDir, "module-preparation-state.json"),
    ].map((path) => readFile(path)),
  );
}

it("a missing database: Start again without the confirmation is refused, and nothing changes", async () => {
  const { f, actions, request } = await missingDatabase();
  const before = await attemptFiles(f);
  await expect(actions.startAgainFirstSetup(request)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  expect(await attemptFiles(f)).toEqual(before);
  await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
});

it("with venue.db missing, a damaged node.db refuses the summary and Start again setup.not_ready, and nothing changes", async () => {
  const { f, actions, request } = await missingDatabase();
  await writeFile(join(f.venueDir, "node.db"), "not a database");
  const current = await f.host.resolution.inspectFirstSetupResolution();
  const ids = {
    inspectionId: current.inspectionId,
    revision: current.revision!,
    ownerGeneration: current.ownerGeneration!,
  };
  const before = await attemptFiles(f);
  const refusal = {
    code: "setup.not_ready",
    params: { cause: "unreadable" },
    reason: "node.db unreadable",
  };
  await expect(actions.startAgainSummary(ids)).rejects.toMatchObject(refusal);
  await expect(
    actions.startAgainFirstSetup({
      ...ids,
      register: request.register,
      confirmMissingDatabase: { nothingFiledOrSold: true, shown: { reached: "named" } },
    }),
  ).rejects.toMatchObject(refusal);
  expect(await attemptFiles(f)).toEqual(before);
  await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
});

it("a confirmation whose summary differs from the box's own is refused, and nothing is written", async () => {
  const { f, actions, request } = await missingDatabase();
  const before = await attemptFiles(f);
  for (const shown of [{ reached: "claimed" as const }]) {
    await expect(
      actions.startAgainFirstSetup({
        ...request,
        confirmMissingDatabase: { nothingFiledOrSold: true, shown },
      }),
    ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  }
  expect(await attemptFiles(f)).toEqual(before);
  await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
});

it("Start again writes no confirmation record", async () => {
  const { f, actions, request } = await missingDatabase();
  await actions.startAgainFirstSetup({
    ...request,
    confirmMissingDatabase: { nothingFiledOrSold: true, shown: { reached: "named" } },
  });
  await expectStartAgainDeleted(f);
  await expect(
    access(join(f.stateDir, "first-setup-start-again-confirmations")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(join(f.stateDir, "records"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("an attempt that finished activation shows it and can be started again on confirmation", async () => {
  const { f, actions, ids, request } = await missingDatabase([
    { kind: "activation-started" },
    { kind: "committed", result: {} },
  ]);
  const answered = await postSummary(routes(f, actions), ids, {});
  expect(answered.status, await answered.clone().text()).toBe(200);
  const shown = await answered.json();
  expect(shown).toEqual({ reached: "fiscal-finished" });
  await actions.startAgainFirstSetup({
    ...request,
    confirmMissingDatabase: { nothingFiledOrSold: true, shown },
  });
  await expectStartAgainDeleted(f);
});

it("the summary route answers when the database is present", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  const { inspectionId, revision, ownerGeneration } = startRequest;
  const response = await postSummary(
    routes(f, actions),
    { inspectionId, revision, ownerGeneration },
    {},
  );
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toEqual({ reached: "named" });
});

it("the summary route answers without the owner headers", async () => {
  const { f, actions, ids } = await missingDatabase();
  const response = await postSummary(routes(f, actions), ids, {});
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toEqual({ reached: "named" });
});

it("the summary route refuses over plain HTTP", async () => {
  const { f, actions, ids } = await missingDatabase();
  const response = await postSummary(
    routes(f, actions),
    ids,
    {},
    {
      incoming: { socket: new Socket() },
    },
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: { code: "setup.connection_insecure", params: {} },
  });
});

it("the summary answers with no owner, for a missing database", async () => {
  const { actions, ids } = await missingDatabase();
  await expect(actions.startAgainSummary(ids)).resolves.toEqual({ reached: "named" });
});

it("Start again over HTTPS with no owner headers starts again", async () => {
  const { f, actions, ids, startRequest } = await missingDatabase();
  const response = await routes(f, actions).request(
    "https://box.test/setup-api/first-setup/resolution/start-again",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...ids,
        register: startRequest.register,
        confirmMissingDatabase: { nothingFiledOrSold: true, shown: { reached: "named" } },
      }),
    },
    tls(),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toEqual({ restarting: true });
  await expectStartAgainDeleted(f);
});

it("a plain-HTTP request to the Start again route is refused, and nothing changes", async () => {
  const { f, actions, ids, startRequest } = await missingDatabase();
  const before = await attemptFiles(f);
  const response = await routes(f, actions).request(
    "https://box.test/setup-api/first-setup/resolution/start-again",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...ids,
        register: startRequest.register,
        confirmMissingDatabase: { nothingFiledOrSold: true, shown: { reached: "named" } },
      }),
    },
    { incoming: { socket: new Socket() } },
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: { code: "setup.connection_insecure", params: {} },
  });
  expect(await attemptFiles(f)).toEqual(before);
  await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
});

it("a summary with a deletion already marked answers setup.start_again_incomplete and asks for a restart", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  const state = (await f.store.read())!;
  await writeStartAgainMarker(
    f,
    await startAgainMarkerFor(f, {
      attemptId: state.frozen.attemptId,
      frozenDigest: firstSetupFrozenDigest(state),
    }),
  );
  const restarts: number[] = [];
  const app = new Hono();
  mountFirstSetupResolutionApi(app, f.host, () => {}, {
    summary: actions.startAgainSummary,
    requestRestart: () => restarts.push(1),
  });
  const { inspectionId, revision, ownerGeneration } = startRequest;
  const response = await postSummary(app, { inspectionId, revision, ownerGeneration }, {});
  expect(response.status, await response.clone().text()).toBe(409);
  expect(await response.json()).toEqual({
    error: { code: "setup.start_again_incomplete", params: {} },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(restarts).toHaveLength(1);
});

it("a confirmation sent while the database is present is refused", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  const before = await attemptFiles(f);
  await expect(
    actions.startAgainFirstSetup({
      ...startRequest,
      confirmMissingDatabase: {
        nothingFiledOrSold: true,
        shown: { reached: "named" },
      },
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await attemptFiles(f)).toEqual(before);
  await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
});

it("with the database missing, a finished setup is refused setup-finished by the summary and by Start again, and nothing changes", async () => {
  const { f, actions, request } = await missingDatabase([
    { kind: "activation-started" },
    { kind: "committed", result: {} },
  ]);
  let state = (await f.store.read())!;
  for (const change of [{ kind: "publication" }, { kind: "complete" }] as const)
    state = await f.store.update(state.frozen.attemptId, state.revision, change);
  const current = await f.host.resolution.inspectFirstSetupResolution();
  const ids = {
    inspectionId: current.inspectionId,
    revision: current.revision!,
    ownerGeneration: current.ownerGeneration!,
  };
  const before = await attemptFiles(f);
  const finished = { code: "setup.start_again_refused", params: { cause: "setup-finished" } };
  await expect(actions.startAgainSummary(ids)).rejects.toMatchObject(finished);
  await expect(
    actions.startAgainFirstSetup({
      ...ids,
      register: request.register,
      confirmMissingDatabase: {
        nothingFiledOrSold: true,
        shown: { reached: "fiscal-finished" },
      },
    }),
  ).rejects.toMatchObject(finished);
  expect(await attemptFiles(f)).toEqual(before);
  await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
});

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  );

it("on a missing database, the marker is on disk before the first deletion", async () => {
  const { f, request } = await missingDatabase();
  const confirmations = join(f.stateDir, CONFIRMATIONS);
  const marker = join(f.venueDir, START_AGAIN_MARKER_FILE);
  const atMarker: boolean[] = [];
  const actual = vi.mocked(writeStartAgainMarker).getMockImplementation()!;
  vi.mocked(writeStartAgainMarker).mockImplementationOnce(async (...args) => {
    atMarker.push(await exists(confirmations), await exists(marker));
    return actual(...args);
  });
  const atDeletion: boolean[] = [];
  const actions = createFirstSetupResolutionActions({
    ...f,
    host: f.host,
    remove: async () => {
      atDeletion.push(await exists(confirmations), await exists(marker));
      throw new Error("removal refused");
    },
  });
  const before = await attemptFiles(f);
  await expect(
    actions.startAgainFirstSetup({
      ...request,
      confirmMissingDatabase: {
        nothingFiledOrSold: true,
        shown: { reached: "named" },
      },
    }),
  ).rejects.toMatchObject({ code: "setup.start_again_incomplete" });
  expect(atMarker).toEqual([false, false]);
  expect(atDeletion).toEqual([false, true]);
  await expect(readdir(confirmations)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readStartAgainMarker(f.venueDir)).not.toBeNull();
  expect(await attemptFiles(f)).toEqual(before);
});

it("the Start again route takes the confirmation only in its exact shape", async () => {
  const { f, name, actions, ids, request } = await missingDatabase();
  const app = routes(f, actions);
  const send = (confirmMissingDatabase: unknown) =>
    app.request(
      "https://box.test/setup-api/first-setup/resolution/start-again",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...ids, register: request.register, confirmMissingDatabase }),
      },
      tls(),
    );
  const shown = { reached: "named" };
  for (const malformed of [
    { nothingFiledOrSold: false, shown },
    { nothingFiledOrSold: "true", shown },
    { nothingFiledOrSold: true, shown, extra: 1 },
    { nothingFiledOrSold: true },
    { nothingFiledOrSold: true, shown: { ...shown, extra: 1 } },
    { nothingFiledOrSold: true, shown: { ...shown, reached: "complete" } },
    { nothingFiledOrSold: true, shown: { ...shown, lastName: name } },
  ]) {
    const refused = await send(malformed);
    expect(await refused.json(), JSON.stringify(malformed)).toEqual({
      error: { code: "setup.request_invalid", params: { field: "body" } },
    });
  }
  await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
  const accepted = await send({ nothingFiledOrSold: true, shown });
  expect(accepted.status, await accepted.clone().text()).toBe(200);
  await expect(readdir(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
});

it("the Start again route refuses a shown summary carrying recovery as setup.request_invalid 400", async () => {
  const { f, actions, ids, request } = await missingDatabase();
  const app = routes(f, actions);
  const recovery = {
    startedAt: "2026-10-16T11:40:00.000Z",
    lastActiveAt: "2026-10-16T11:44:00.000Z",
    lastActiveSource: "saved-step",
    failed: false,
    cloud: false,
  };
  const before = await attemptFiles(f);
  for (const value of [recovery, null, { ...recovery, extra: 1 }]) {
    const refused = await sendStartAgain(app, {
      ...ids,
      register: request.register,
      confirmMissingDatabase: {
        nothingFiledOrSold: true,
        shown: { reached: "named", recovery: value },
      },
    });
    expect(refused.status, JSON.stringify(value)).toBe(400);
    expect(await refused.json(), JSON.stringify(value)).toEqual({
      error: { code: "setup.request_invalid", params: { field: "body" } },
    });
  }
  expect(await attemptFiles(f)).toEqual(before);
  await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
});

it("the Start again route refuses a body carrying confirmRecoveryDiscard as setup.request_invalid 400, and nothing changes", async () => {
  const { f, actions, ids, request } = await missingDatabase();
  const reached: unknown[] = [];
  const app = routes(f, {
    ...actions,
    startAgainFirstSetup: async (body) => {
      reached.push(body);
      return actions.startAgainFirstSetup(body);
    },
  });
  const recovery = {
    startedAt: "2026-10-16T11:40:00.000Z",
    lastActiveAt: "2026-10-16T11:44:00.000Z",
    lastActiveSource: "memory",
    failed: false,
    cloud: false,
  };
  const shown = { reached: "named", recovery };
  const confirmMissingDatabase = { nothingFiledOrSold: true, shown: { reached: "named" } };
  const before = await attemptFiles(f);
  for (const body of [
    { confirmRecoveryDiscard: { shown } },
    { confirmRecoveryDiscard: { shown: { reached: "named" } } },
    { confirmMissingDatabase, confirmRecoveryDiscard: { shown } },
  ]) {
    const refused = await sendStartAgain(app, { ...ids, register: request.register, ...body });
    expect(refused.status, JSON.stringify(body)).toBe(400);
    expect(await refused.json(), JSON.stringify(body)).toEqual({
      error: { code: "setup.request_invalid", params: { field: "body" } },
    });
  }
  expect(reached).toEqual([]);
  expect(await attemptFiles(f)).toEqual(before);
  await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readStartAgainMarker(f.venueDir)).toBeNull();
});

it.each([
  ["damaged", "{damaged"],
  ["intact", JSON.stringify({ version: 1, modules: {}, history: [] })],
] as const)(
  "with the database present and empty, a %s public fiscal record refuses the summary and Start again setup.not_ready, and nothing is written",
  async (_label, bytes) => {
    const { f, actions } = await abandonedAttempt();
    await updateSetupFlowSection(f.stateDir, "publicEvidence", () =>
      _label === "damaged" ? bytes : JSON.parse(bytes),
    );
    const current = await f.host.resolution.inspectFirstSetupResolution();
    expect(current.database).toBe("no-venue-rows");
    const ids = {
      inspectionId: current.inspectionId,
      revision: current.revision!,
      ownerGeneration: current.ownerGeneration!,
    };
    const before = await folderTrees(f);
    const refusal = { code: "setup.not_ready", params: { cause: "may-have-filed" } };
    await expect(actions.startAgainSummary(ids)).rejects.toMatchObject(refusal);
    await expect(actions.startAgainFirstSetup(ids)).rejects.toMatchObject(refusal);
    expect(await folderTrees(f)).toEqual(before);
    expect(await readStartAgainMarker(f.venueDir)).toBeNull();
  },
);

function recoveryRecord(f: Awaited<ReturnType<typeof abandonedAttempt>>["f"]) {
  return join(f.stateDir, "flows/setup/record.json");
}

async function damageRecoveryRecord(f: Awaited<ReturnType<typeof abandonedAttempt>>["f"]) {
  await expect(lstat(recoveryRecord(f))).resolves.toMatchObject({ size: expect.any(Number) });
  await updateSetupFlowSection(f.stateDir, "recoveryManifests", (current) => ({
    ...current,
    [f.module]: "{damaged",
  }));
}

function sendStartAgain(app: Hono, body: unknown) {
  return app.request(
    "https://box.test/setup-api/first-setup/resolution/start-again",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    tls(),
  );
}

it("with the database missing, a damaged recovery record reaches the confirmation: the summary route answers it, never setup.not_ready", async () => {
  const { f, actions, ids } = await missingDatabase([], damageRecoveryRecord);
  const answered = await postSummary(routes(f, actions), ids, {});
  expect(answered.status, await answered.clone().text()).toBe(200);
  expect(await answered.json()).toEqual({
    reached: "named",
    recoveryRecordDamaged: true,
  });
});

it("Start again past a damaged recovery record goes ahead once the summary showing it is confirmed", async () => {
  const { f, actions, ids, request } = await missingDatabase([], damageRecoveryRecord);
  const app = routes(f, actions);
  const shown = await (await postSummary(app, ids, {})).json();
  const accepted = await sendStartAgain(app, {
    ...ids,
    register: request.register,
    confirmMissingDatabase: { nothingFiledOrSold: true, shown },
  });
  expect(accepted.status, await accepted.clone().text()).toBe(200);
  await expectStartAgainDeleted(f);
});

it("a confirmation that did not show the damaged recovery record is refused, and nothing is written", async () => {
  const { f, actions, request } = await missingDatabase([], damageRecoveryRecord);
  const before = await attemptFiles(f);
  await expect(
    actions.startAgainFirstSetup({
      ...request,
      confirmMissingDatabase: {
        nothingFiledOrSold: true,
        shown: { reached: "named" },
      },
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await attemptFiles(f)).toEqual(before);
  await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
});

it("a confirmation that shows a damaged recovery record the box does not find is refused", async () => {
  const { f, actions, request } = await missingDatabase();
  await expect(lstat(recoveryRecord(f))).resolves.toMatchObject({ size: expect.any(Number) });
  const before = await attemptFiles(f);
  await expect(
    actions.startAgainFirstSetup({
      ...request,
      confirmMissingDatabase: {
        nothingFiledOrSold: true,
        shown: { reached: "named", recoveryRecordDamaged: true },
      },
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await attemptFiles(f)).toEqual(before);
});

it("with the database missing, a setup naming a module the box's software does not include is refused module.operation_invalid by the summary and by Start again, and nothing is written", async () => {
  const { f, ids, request } = await missingDatabase();
  await expect(lstat(recoveryRecord(f))).resolves.toMatchObject({ size: expect.any(Number) });
  const actions = createFirstSetupResolutionActions({ ...f, host: { ...f.host, modules: [] } });
  const refusal = {
    code: "module.operation_invalid",
    params: { module: (await f.store.read())!.frozen.modules[0]!.module },
  };
  const before = await attemptFiles(f);
  await expect(actions.startAgainSummary(ids)).rejects.toMatchObject(refusal);
  for (const shown of [
    { reached: "named" as const },
    { reached: "named" as const, recoveryRecordDamaged: true as const },
  ])
    await expect(
      actions.startAgainFirstSetup({
        ...request,
        confirmMissingDatabase: { nothingFiledOrSold: true, shown },
      }),
    ).rejects.toMatchObject(refusal);
  expect(await attemptFiles(f)).toEqual(before);
  await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
});

it("the Start again route takes recoveryRecordDamaged only as true", async () => {
  const { f, actions, ids, request } = await missingDatabase();
  const app = routes(f, actions);
  for (const recoveryRecordDamaged of [false, "true", 1]) {
    const refused = await sendStartAgain(app, {
      ...ids,
      register: request.register,
      confirmMissingDatabase: {
        nothingFiledOrSold: true,
        shown: { reached: "named", recoveryRecordDamaged },
      },
    });
    expect(await refused.json(), JSON.stringify(recoveryRecordDamaged)).toEqual({
      error: { code: "setup.request_invalid", params: { field: "body" } },
    });
  }
  await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
});

it("the Start again route takes recoveryRecordDamagedShown only as true", async () => {
  const { f, actions, ids, request } = await missingDatabase();
  const app = routes(f, actions);
  for (const recoveryRecordDamagedShown of [false, "true", 1]) {
    const refused = await sendStartAgain(app, {
      ...ids,
      register: request.register,
      recoveryRecordDamagedShown,
    });
    expect(refused.status).toBe(400);
    expect(await refused.json(), JSON.stringify(recoveryRecordDamagedShown)).toEqual({
      error: { code: "setup.request_invalid", params: { field: "body" } },
    });
  }
});

function picksFile(f: Awaited<ReturnType<typeof abandonedAttempt>>["f"]) {
  return join(f.stateDir, "module-preparation-state.json");
}

async function damagePicks(f: Awaited<ReturnType<typeof abandonedAttempt>>["f"]) {
  await expect(lstat(picksFile(f))).resolves.toMatchObject({ size: expect.any(Number) });
  await writeFile(picksFile(f), "{damaged");
}

it("with the database missing, a damaged picks file adds nothing to the summary, and Start again with that summary goes ahead", async () => {
  const { f, actions, ids, request } = await missingDatabase([], damagePicks);
  const shown = await actions.startAgainSummary(ids);
  expect(shown).toEqual({ reached: "named" });
  await actions.startAgainFirstSetup({
    ...request,
    confirmMissingDatabase: { nothingFiledOrSold: true, shown },
  });
  await expectStartAgainDeleted(f);
});

it("with the database present, a damaged picks file asks for no password: Start again goes ahead and deletes the attempt", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  await damagePicks(f);
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  expect(inspected.database).not.toBe("missing");
  await actions.startAgainFirstSetup({
    ...startRequest,
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
  });
  await expectStartAgainDeleted(f);
});

async function stampTree(path: string, at: Date) {
  const found = await lstat(path).catch(() => null);
  if (found === null) return;
  if (found.isDirectory())
    for (const entry of await readdir(path)) await stampTree(join(path, entry), at);
  await utimes(path, at, at);
}

const PICKS_AFTER_NAME_MS = 120 * MINUTE_MS;

/** Every listed item a minute after the attempt's name, the picks file two hours after it. */
async function stampAfterName(f: Awaited<ReturnType<typeof abandonedAttempt>>["f"]) {
  const state = (await f.store.read())!;
  const name = (firstSetupModuleContext(state, f.module).request as { identity: string }).identity;
  const nameMs = EPOCH_MS + decodeMinuteIdentity(name) * MINUTE_MS;
  const listed = new Date(nameMs + MINUTE_MS);
  await stampTree(f.stateDir, listed);
  const picks = new Date(nameMs + PICKS_AFTER_NAME_MS);
  await utimes(picksFile(f), picks, picks);
}

async function createDamaged(path: string) {
  await mkdir(dirname(path), { recursive: true });
  await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
  await writeFile(path, "{damaged");
}

async function expectRefusedUnchanged(
  f: Awaited<ReturnType<typeof abandonedAttempt>>["f"],
  run: () => Promise<unknown>,
  code: string,
) {
  const before = await attemptFiles(f);
  await expect(run()).rejects.toMatchObject({ code });
  expect(await attemptFiles(f)).toEqual(before);
  await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readStartAgainMarker(f.venueDir)).toBeNull();
}

it.each(["flows/setup/record.json"])(
  "with the database present, a damaged %s beside a damaged picks file leaves the box reading no revision, so Start again is refused setup.attempt_conflict for the revision it sends, and nothing changes",
  async (file) => {
    const { f, actions, startRequest } = await abandonedAttempt();
    await damagePicks(f);
    await mkdir(dirname(join(file === "flows/setup/record.json" ? f.stateDir : f.venueDir, file)), {
      recursive: true,
    });
    await writeFile(
      join(file === "flows/setup/record.json" ? f.stateDir : f.venueDir, file),
      "{damaged",
    );
    const inspected = await f.host.resolution.inspectFirstSetupResolution();
    expect(inspected.revision).toBeNull();
    await expectRefusedUnchanged(
      f,
      () =>
        actions.startAgainFirstSetup({
          ...startRequest,
          inspectionId: inspected.inspectionId,
          revision: startRequest.revision,
          ownerGeneration: startRequest.ownerGeneration,
        }),
      "setup.attempt_conflict",
    );
  },
);

/** Start again sent with the page's confirmation of the summary: the setup is deleted. */
async function expectUnreadableDeleted(
  f: Awaited<ReturnType<typeof abandonedAttempt>>["f"],
  send: (shown: StartAgainSummary) => Promise<void>,
  shown: StartAgainSummary,
) {
  await send(shown);
  await expectStartAgainDeleted(f);
}

it("a corrupt venue database beside a damaged picks file is refused setup.attempt_conflict without the page's confirmation, and nothing changes; with it, it is deleted", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  await damagePicks(f);
  await writeFile(join(f.venueDir, "venue.db"), "not a database");
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  expect(inspected.database).not.toBe("missing");
  const ids = {
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
  };
  await expectRefusedUnchanged(
    f,
    () => actions.startAgainFirstSetup({ ...startRequest, ...ids }),
    "setup.attempt_conflict",
  );
  const shown = await actions.startAgainSummary(ids);
  expect(shown).toMatchObject({ databaseUnreadable: true });
  await expectUnreadableDeleted(
    f,
    (confirmed) =>
      actions.startAgainFirstSetup({
        ...startRequest,
        ...ids,
        confirmUnreadableDatabase: { shown: confirmed },
      }),
    shown,
  );
});

it("an unused attempt whose database cannot be read: the summary says so, Start again refuses until the page confirms it, and with that confirmation deletes it", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  await writeFile(join(f.venueDir, "venue.db"), "not a database");
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  expect(inspected.database).toBe("corrupt");
  const ids = {
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
  };
  const shown = await actions.startAgainSummary(ids);
  expect(shown).toMatchObject({ databaseUnreadable: true });
  await expectRefusedUnchanged(
    f,
    () => actions.startAgainFirstSetup({ ...startRequest, ...ids }),
    "setup.attempt_conflict",
  );
  await expectUnreadableDeleted(
    f,
    (confirmed) =>
      actions.startAgainFirstSetup({
        ...startRequest,
        ...ids,
        confirmUnreadableDatabase: { shown: confirmed },
      }),
    shown,
  );
});

it("an unused attempt whose database cannot be read, beside saved trading settings, is refused setup.not_ready before the database is read, and nothing changes", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  await writeFile(join(f.venueDir, "venue.db"), "not a database");
  await writeFile(join(f.stateDir, "trading.env"), "WAITRON_ENV=preproduction\n");
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  expect(inspected.database).toBe("corrupt");
  const ids = {
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
  };
  vi.mocked(readSetupDatabase).mockClear();
  await expect(actions.startAgainSummary(ids)).rejects.toMatchObject({ code: "setup.not_ready" });
  await expectRefusedUnchanged(
    f,
    () => actions.startAgainFirstSetup({ ...startRequest, ...ids }),
    "setup.not_ready",
  );
  expect(vi.mocked(readSetupDatabase)).not.toHaveBeenCalled();
});

it("an unused attempt whose database cannot be read, beside a public record, is refused setup.not_ready before the database is read, and nothing changes", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  await writeFile(join(f.venueDir, "venue.db"), "not a database");
  await updateSetupFlowSection(f.stateDir, "publicEvidence", () => "{damaged");
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  expect(inspected.database).toBe("corrupt");
  const ids = {
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
  };
  vi.mocked(readSetupDatabase).mockClear();
  await expect(actions.startAgainSummary(ids)).rejects.toMatchObject({ code: "setup.not_ready" });
  await expectRefusedUnchanged(
    f,
    () => actions.startAgainFirstSetup({ ...startRequest, ...ids }),
    "setup.not_ready",
  );
  expect(vi.mocked(readSetupDatabase)).not.toHaveBeenCalled();
});

it("an unused attempt whose database the inspection could not show empty, read whole and found not empty, is refused setup.not_ready unexpected, and nothing changes", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  await writeFile(join(f.venueDir, "venue.db"), "not a database");
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  expect(inspected.database).toBe("corrupt");
  const ids = {
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
  };
  const read = { kind: "read", holdings: { rows: 1, kept: 0, records: 0, accepted: 0 } } as const;
  vi.mocked(readSetupDatabase).mockResolvedValueOnce(read).mockResolvedValueOnce(read);
  const refusal = { code: "setup.not_ready", params: { cause: "unexpected" } };
  await expect(actions.startAgainSummary(ids)).rejects.toMatchObject(refusal);
  const before = await attemptFiles(f);
  await expect(actions.startAgainFirstSetup({ ...startRequest, ...ids })).rejects.toMatchObject(
    refusal,
  );
  expect(await attemptFiles(f)).toEqual(before);
  expect(await readStartAgainMarker(f.venueDir)).toBeNull();
});

it.each(["publicEvidence", "flows/setup/documents/stray.json"])(
  "with the database present, a damaged %s still refuses Start again setup.not_ready, and nothing changes",
  async (file) => {
    const { f, actions, startRequest } = await abandonedAttempt();
    if (file === "publicEvidence")
      await updateSetupFlowSection(f.stateDir, "publicEvidence", () => "{damaged");
    else await createDamaged(join(f.stateDir, file));
    const inspected = await f.host.resolution.inspectFirstSetupResolution();
    await expectRefusedUnchanged(
      f,
      () =>
        actions.startAgainFirstSetup({
          ...startRequest,
          inspectionId: inspected.inspectionId,
          revision: inspected.revision!,
          ownerGeneration: inspected.ownerGeneration!,
        }),
      "setup.not_ready",
    );
  },
);

it("with the database missing, an outside evidence file configured beside a damaged picks file is refused setup.not_ready, and nothing changes", async () => {
  const base = await missingDatabase([], async (f) => {
    await damagePicks(f);
    await stampAfterName(f);
  });
  const { f, request: startAgain } = base;
  const outsidePath = join(f.root, "outside-history.json");
  await writeFile(outsidePath, "{}");
  const resolution = createFirstSetupResolutionInspection({
    modules: ALL_MODULES,
    stateDir: f.stateDir,
    venueDir: f.venueDir,
    store: f.store,
    expectedMigrationSets: modulesWithSets(f.modules).map((module) => module.migrations.name),
    publicEvidencePaths: [outsidePath],
  });
  const actions = createFirstSetupResolutionActions({ ...f, host: { ...f.host, resolution } });
  const current = await resolution.inspectFirstSetupResolution();
  const ids = {
    inspectionId: current.inspectionId,
    revision: current.revision!,
    ownerGeneration: current.ownerGeneration!,
  };
  await expectRefusedUnchanged(f, () => actions.startAgainSummary(ids), "setup.not_ready");
  const shown = { reached: "named" as const };
  await expectRefusedUnchanged(
    f,
    () =>
      actions.startAgainFirstSetup({
        ...startAgain,
        ...ids,
        confirmMissingDatabase: { nothingFiledOrSold: true, shown },
      }),
    "setup.not_ready",
  );
});

it("with an empty database and a damaged recovery-key record, the summary carries recoveryRecordDamaged; Start again without the flag is refused setup.attempt_conflict, and with it deletes the setup", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  await damageRecoveryRecord(f);
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  const ids = {
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
  };
  expect(await actions.startAgainSummary(ids)).toEqual({
    reached: "named",
    recoveryRecordDamaged: true,
  });
  const before = await folderTrees(f);
  await expect(
    actions.startAgainFirstSetup({ ...ids, register: startRequest.register }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await folderTrees(f)).toEqual(before);
  await actions.startAgainFirstSetup({
    ...ids,
    register: startRequest.register,
    recoveryRecordDamagedShown: true,
  });
  await expectStartAgainDeleted(f);
});

it("a damaged record with no owner still refuses for a marker over its limit, and nothing changes", async () => {
  const { f, startRequest } = await abandonedAttempt();
  await damageRecoveryRecord(f);
  const actions = createFirstSetupResolutionActions({ ...f, host: f.host, markerLimit: 1 });
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  const before = await folderTrees(f);
  await expect(
    actions.startAgainFirstSetup({
      ...startRequest,
      inspectionId: inspected.inspectionId,
      revision: inspected.revision!,
      ownerGeneration: inspected.ownerGeneration!,
    }),
  ).rejects.toMatchObject({ code: "setup.not_ready", params: { cause: "too-large" } });
  expect(await folderTrees(f)).toEqual(before);
  expect(await readStartAgainMarker(f.venueDir)).toBeNull();
});

it("the Start again route passes recoveryRecordDamagedShown on: with a damaged record it starts again over HTTPS", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  await damageRecoveryRecord(f);
  const current = await f.host.resolution.inspectFirstSetupResolution();
  const accepted = await sendStartAgain(routes(f, actions), {
    inspectionId: current.inspectionId,
    revision: current.revision,
    ownerGeneration: current.ownerGeneration,
    register: startRequest.register,
    recoveryRecordDamagedShown: true,
  });
  expect(accepted.status, await accepted.clone().text()).toBe(200);
  expect(await accepted.json()).toEqual({ restarting: true });
  await expectStartAgainDeleted(f);
});

it("an attempt that never chose a name is summarised as claimed, with no name", async () => {
  const { folders, host } = await claimedWithoutName();
  await rm(join(folders.venueDir, "venue.db"));
  const current = await host.resolution.inspectFirstSetupResolution();
  await expect(
    createFirstSetupResolutionActions({ ...folders, host }).startAgainSummary({
      inspectionId: current.inspectionId,
      revision: current.revision!,
      ownerGeneration: current.ownerGeneration!,
    }),
  ).resolves.toEqual({ reached: "claimed" });
});

const LOCKS = /^venue\.(lock|holder)/;
async function tree(dir: string, prefix = ""): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  let names: string[];
  try {
    names = await readdir(join(dir, prefix));
  } catch {
    return result;
  }
  for (const name of names.sort()) {
    const relative = prefix === "" ? name : `${prefix}/${name}`;
    if (prefix === "" && LOCKS.test(name)) continue;
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
const folderTrees = async (f: { stateDir: string; venueDir: string }) => ({
  venue: await tree(f.venueDir),
  state: await tree(f.stateDir),
});
const ATTEMPT_STATE = [
  "flows/setup/record.json",
  "module-preparation-state.json",
  "flows/setup/documents/",
  "first-setup-resolutions/",
  "first-setup-workspaces/",
];

async function expectAttemptGone(f: { stateDir: string; venueDir: string }) {
  const { venue, state } = await folderTrees(f);
  expect(venue).toEqual({});
  for (const name of ATTEMPT_STATE) expect(state[name], name).toBeUndefined();
}

it("start again leaves no workspace and none of the attempt's files, node.db included", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  await expect(access(join(f.venueDir, "node.db"))).resolves.toBeUndefined();
  expect((await readSetupFlowRecord(f.stateDir))?.recoveryManifests?.[f.module]).toBeDefined();
  await actions.startAgainFirstSetup(startRequest);
  await expectAttemptGone(f);
});

it("start again is refused when node.db holds a table", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  const node = new DatabaseSync(join(f.venueDir, "node.db"));
  node.exec("create table t(x)");
  node.close();
  const before = await folderTrees(f);
  await expect(actions.startAgainFirstSetup(startRequest)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  expect(await folderTrees(f)).toEqual(before);
});

it("start again with no node.db does not create one and succeeds", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  for (const name of ["node.db", "node.db-wal", "node.db-shm"])
    await rm(join(f.venueDir, name), { force: true });
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  await actions.startAgainFirstSetup({ ...startRequest, inspectionId: inspected.inspectionId });
  await expectAttemptGone(f);
});

it.each<[string, (f: { stateDir: string; venueDir: string }) => Promise<unknown>]>([
  ...[
    "trading.env",
    "flows/setup/operation.json",
    "flows/restore/record.json",
    "reset-request.json",
    "modules.json",
    "cloud/replacement.json",
  ].map((name): [string, (f: { stateDir: string; venueDir: string }) => Promise<unknown>] => [
    `state/${name}`,
    async (f) => {
      await mkdir(join(f.stateDir, "cloud"), { recursive: true });
      await mkdir(join(f.stateDir, "flows/restore"), { recursive: true });
      await writeFile(
        join(f.stateDir, name),
        name === "flows/restore/record.json"
          ? JSON.stringify({ version: 1, phase: "staged", request: {} })
          : "X=1\n",
      );
    },
  ]),
  ["venue/.venue.db-litestream/", (f) => mkdir(join(f.venueDir, ".venue.db-litestream"))],
])(
  "on a missing database, Start again beside %s is refused, and nothing is written",
  async (_name, place) => {
    const { f, actions, request } = await missingDatabase();
    await place(f);
    const inspected = await f.host.resolution.inspectFirstSetupResolution();
    const before = await folderTrees(f);
    await expect(
      actions.startAgainFirstSetup({
        ...request,
        inspectionId: inspected.inspectionId,
        confirmMissingDatabase: {
          nothingFiledOrSold: true,
          shown: { reached: "named" },
        },
      }),
    ).rejects.toMatchObject({ code: "setup.not_ready" });
    expect(await folderTrees(f)).toEqual(before);
    expect(before.venue[START_AGAIN_MARKER_FILE]).toBeUndefined();
  },
);

it("on a missing database, the summary and Start again with outside evidence configured are refused, and nothing is written", async () => {
  const { f, actions, request, ids } = await missingDatabase();
  const inspect = f.host.resolution.inspectFirstSetupResolution.bind(f.host.resolution);
  vi.spyOn(f.host.resolution, "inspectFirstSetupResolution").mockImplementation(async () => {
    const inspection = await inspect();
    return {
      ...inspection,
      artifacts: [...inspection.artifacts, { name: "outside-evidence-0", status: "missing" }],
    };
  });
  const before = await folderTrees(f);
  const refusal = { code: "setup.not_ready", params: { cause: "may-have-filed" } };
  await expect(actions.startAgainSummary(ids)).rejects.toMatchObject(refusal);
  await expect(
    actions.startAgainFirstSetup({
      ...request,
      confirmMissingDatabase: {
        nothingFiledOrSold: true,
        shown: { reached: "named" },
      },
    }),
  ).rejects.toMatchObject(refusal);
  expect(await folderTrees(f)).toEqual(before);
});

it("start again is refused while a deletion marker exists, and the marker is unchanged", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  const state = (await f.store.read())!;
  await writeStartAgainMarker(
    f,
    await startAgainMarkerFor(f, {
      attemptId: state.frozen.attemptId,
      frozenDigest: firstSetupFrozenDigest(state),
    }),
  );
  const before = await folderTrees(f);
  await expect(actions.startAgainFirstSetup(startRequest)).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
  });
  expect(await folderTrees(f)).toEqual(before);
});

function cutAt(cut: number, before?: (call: number) => Promise<void>) {
  let calls = 0;
  return async (path: string, kind: "file" | "folder") => {
    calls += 1;
    await before?.(calls);
    if (calls === cut)
      throw Object.assign(new Error("power cut"), { code: "EIO", path: `${path}\nforged` });
    await (kind === "file" ? rm(path) : rmdir(path));
  };
}

it("a deletion that throws part-way answers 409 setup.start_again_incomplete and requests a restart, and the restart finishes it", async () => {
  const { f, startRequest } = await abandonedAttempt();
  const actions = createFirstSetupResolutionActions({ ...f, host: f.host, remove: cutAt(3) });
  const lines: string[] = [];
  const app = new Hono();
  const restarts: number[] = [];
  mountFirstSetupResolutionApi(
    app,
    f.host,
    createLogger(
      (line) => lines.push(line),
      () => new Date(),
    ),
    {
      startAgain: actions.startAgainFirstSetup,
      requestRestart: () => restarts.push(1),
    },
  );
  const response = await app.request(
    "https://box.test/setup-api/first-setup/resolution/start-again",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(startRequest),
    },
    tls(),
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: { code: "setup.start_again_incomplete", params: {} },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(restarts).toHaveLength(1);
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) expect(line.indexOf("\n")).toBe(line.length - 1);
  expect(lines.join("")).toContain("deletion failed: EIO");
  expect(await readStartAgainMarker(f.venueDir)).not.toBeNull();
  await finishStartAgainDeletion(f);
  await expectAttemptGone(f);
  expect(await readStartAgainMarker(f.venueDir)).toBeNull();
});

it("a successful Start again answers only that the box is restarting", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  const restarts: number[] = [];
  const app = new Hono();
  mountFirstSetupResolutionApi(app, f.host, () => {}, {
    startAgain: actions.startAgainFirstSetup,
    requestRestart: () => restarts.push(1),
  });
  const response = await app.request(
    "https://box.test/setup-api/first-setup/resolution/start-again",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(startRequest),
    },
    tls(),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toEqual({ restarting: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(restarts).toHaveLength(1);
});

it("the start-again route is not served by ordinary setup", async () => {
  const { f, startRequest } = await abandonedAttempt();
  const app = new Hono();
  mountSetupFirstFiscalApi(
    app,
    f.host,
    () => {},
    () => {
      throw new Error("unused");
    },
    "production",
    {} as Parameters<typeof mountSetupFirstFiscalApi>[5],
  );
  const before = await folderTrees(f);
  const response = await app.request(
    "https://box.test/setup-api/first-setup/resolution/start-again",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(startRequest),
    },
    tls(),
  );
  expect(response.status).toBe(404);
  const control = await app.request("https://box.test/setup-api/first-setup/resolution");
  expect(control.status, await control.clone().text()).toBe(200);
  expect(await control.json()).toMatchObject({ inspectionId: startRequest.inspectionId });
  expect(await folderTrees(f)).toEqual(before);
});

it("a repair-page inspection read between deletions, then a cut, still lets the next start finish", async () => {
  const { f, startRequest } = await abandonedAttempt();
  const routed: { app?: Hono } = {};
  const reads: [number, number, string][] = [];
  const actions = createFirstSetupResolutionActions({
    ...f,
    host: f.host,
    remove: cutAt(5, async (call) => {
      if (call !== 1 && call !== 4) return;
      const read = await routed.app!.request("https://box.test/setup-api/first-setup/resolution");
      reads.push([call, read.status, ((await read.json()) as { database: string }).database]);
    }),
  });
  routed.app = routes(f, actions);
  await expect(actions.startAgainFirstSetup(startRequest)).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
  });
  // The first read opens venue.db before its deletion; the second finds it gone.
  expect(reads).toEqual([
    [1, 200, "no-venue-rows"],
    [4, 200, "missing"],
  ]);
  await finishStartAgainDeletion(f);
  await expectAttemptGone(f);
});

it("Start again leaves the choice folder in place", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  await mkdir(join(f.stateDir, CONFIRMATIONS), { recursive: true });
  await writeFile(join(f.stateDir, CONFIRMATIONS, "1-earlier.json"), "{}");
  const kept = async () => ({
    confirmations: await tree(join(f.stateDir, CONFIRMATIONS)),
  });
  const before = await kept();
  await actions.startAgainFirstSetup(startRequest);
  await expectAttemptGone(f);
  expect(await kept()).toEqual(before);
});

it("a marker over its limit refuses Start again before anything is written", async () => {
  const { f, request } = await missingDatabase();
  const actions = createFirstSetupResolutionActions({ ...f, host: f.host, markerLimit: 1 });
  const before = await folderTrees(f);
  await expect(
    actions.startAgainFirstSetup({
      ...request,
      confirmMissingDatabase: {
        nothingFiledOrSold: true,
        shown: { reached: "named" },
      },
    }),
  ).rejects.toMatchObject({ code: "setup.not_ready", params: { cause: "too-large" } });
  expect(await folderTrees(f)).toEqual(before);
  expect(before.state[`${CONFIRMATIONS}/`]).toBeUndefined();
  expect(before.venue[START_AGAIN_MARKER_FILE]).toBeUndefined();
});

async function pendingDeletion() {
  const base = await abandonedAttempt();
  const state = (await base.f.store.read())!;
  await writeStartAgainMarker(
    base.f,
    await startAgainMarkerFor(base.f, {
      attemptId: state.frozen.attemptId,
      frozenDigest: firstSetupFrozenDigest(state),
    }),
  );
  return base;
}

const incomplete = { code: "setup.start_again_incomplete" };

type Pending = Awaited<ReturnType<typeof pendingDeletion>>;
const restoreStaging = async ({ f }: Pending) => {
  await mkdir(join(f.stateDir, "flows/restore"), { recursive: true });
  await writeFile(
    join(f.stateDir, "flows/restore/record.json"),
    JSON.stringify({ version: 1, phase: "staged", request: { version: 1, kind: "stream" } }),
  );
  const restore = vi.fn(async () => {});
  await expect(
    runStagedRestore(
      { stateDir: f.stateDir, venueDir: f.venueDir, migrationsRoot: null, log: () => {} },
      restore,
      restore,
    ),
  ).rejects.toMatchObject(incomplete);
  expect(restore).not.toHaveBeenCalled();
  await rm(join(f.stateDir, "flows/restore"), { recursive: true });
};
const restoreCommand = async ({ f }: Pending) => {
  const source = join(f.stateDir, "..", "archive");
  await writeFile(source, "unopened archive");
  const out: string[] = [];
  const restore = vi.fn(async () => {});
  expect(
    await runRestore({
      argv: ["restore", source],
      env: {
        WAITRON_VENUE_DIR: f.venueDir,
        WAITRON_STATE_DIR: f.stateDir,
        WAITRON_BACKUP_RECOVERY_KEY: "synthetic",
      },
      out: (line) => out.push(line),
      restore,
    }),
  ).toBe(1);
  expect(restore).not.toHaveBeenCalled();
  expect(out.join("\n")).toContain("setup.start_again_incomplete");
};

it.each<[string, (p: Pending) => Promise<void>]>([
  [
    "restore placement",
    async ({ f }) => {
      await expect(
        writeValidated({} as never, {
          venueDir: f.venueDir,
          stateDir: f.stateDir,
          stagingDir: join(f.stateDir, "staging"),
          migrationsRoot: null,
          environment: "production",
          modules: [],
          log: () => {},
        }),
      ).rejects.toMatchObject(incomplete);
    },
  ],
  ["restore staging", restoreStaging],
  ["the restore command", restoreCommand],
  [
    "reset",
    async ({ f }) => {
      await writeFile(join(f.stateDir, "reset-request.json"), "{}");
      await expect(
        runStagedReset({ stateDir: f.stateDir, venueDir: f.venueDir, log: () => {} }),
      ).rejects.toMatchObject(incomplete);
      await rm(join(f.stateDir, "reset-request.json"));
    },
  ],
  [
    "adopt",
    async ({ f }) => {
      const app = new Hono();
      mountSetup(
        app,
        {
          environment: "production",
          firstSetup: {
            coordinator: f.host.coordinator,
            assertOtherAllowed: () => assertOtherFirstSetupAllowed(f.venueDir, f.store),
          },
          adopt: async () => {
            throw new Error("adopt must not run");
          },
        },
        () => {},
      );
      const response = await app.request("http://box.test/setup-api/adopt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primaryUrl: "https://primary.example",
          credential: { personId: "88888888-8888-4888-8888-888888888888", password: "x" },
        }),
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: { code: "setup.start_again_incomplete", params: {} },
      });
    },
  ],
  [
    "the recovery entry",
    async ({ f }) => {
      await expect(
        createRecoveryEntryRunner({
          stateDir: f.stateDir,
          venueDir: f.venueDir,
          migrationsRoot: null,
          modules: ALL_MODULES,
          copy: {} as never,
          operation: {} as never,
          secret: null,
          context: { selectedSourceId: "source", oldBoxGone: true, soleRecovery: true },
        }),
      ).rejects.toMatchObject(incomplete);
    },
  ],
])(
  "while a deletion is pending, %s is refused setup.start_again_incomplete and the marked files are unchanged",
  async (_name, act) => {
    const pending = await pendingDeletion();
    const before = await folderTrees(pending.f);
    await act(pending);
    expect(await folderTrees(pending.f)).toEqual(before);
  },
);

it.each([
  ["restore staging", restoreStaging],
  ["the restore command", restoreCommand],
])(
  "once the deletion has removed the setup record, %s is still refused and the remaining files are unchanged",
  async (_name, act) => {
    const pending = await pendingDeletion();
    await rm(join(pending.f.stateDir, "flows/setup/record.json"));
    const before = await folderTrees(pending.f);
    await act(pending);
    expect(await folderTrees(pending.f)).toEqual(before);
  },
);

const KEPT_ATTEMPT = "11111111-1111-4111-8111-111111111111";

/** One earlier choice from another attempt. */
async function seedKept(stateDir: string) {
  const record = await writeStartAgainChoice(stateDir, {
    at: "2026-10-01T00:00:00.000Z",
    attemptId: KEPT_ATTEMPT,
    frozenDigest: "a".repeat(64),
    markerSha256: "b".repeat(64),
    choice: "keep",
    administrator: {
      administratorId: KEPT_ATTEMPT,
      displayName: "Elena",
      email: "elena@example.test",
    },
    ownerGeneration: 1,
    listed: { digest: "c".repeat(64), units: [] },
    setAside: null,
  });
  const path = join(stateDir, CONFIRMATIONS, `${record}.json`);
  const bytes = () => readFile(path);
  return { before: await bytes(), bytes };
}

async function emptyFolders() {
  const root = await mkdtemp(join(tmpdir(), "start-again-kept-"));
  roots.push(root);
  const folders = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  await mkdir(folders.stateDir);
  await mkdir(folders.venueDir);
  return folders;
}

it("lifetime: Start again with the database present leaves the choice record unchanged", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  const kept = await seedKept(f.stateDir);
  await actions.startAgainFirstSetup(startRequest);
  await expectAttemptGone(f);
  expect(await kept.bytes()).toEqual(kept.before);
});

it("lifetime: a start that finishes an interrupted deletion leaves the choice record unchanged", async () => {
  const { f } = await pendingDeletion();
  const kept = await seedKept(f.stateDir);
  await finishStartAgainDeletion(f);
  await expectAttemptGone(f);
  expect(await readStartAgainMarker(f.venueDir)).toBeNull();
  expect(await kept.bytes()).toEqual(kept.before);
});

it.each([
  ["placed", async () => {}, true],
  [
    "refused",
    async () => {
      throw new Error("refused placement");
    },
    false,
  ],
] as const)(
  "lifetime: a staged restore %s, with placement stubbed, leaves the choice record unchanged",
  async (_name, placement, placed) => {
    const folders = await emptyFolders();
    const kept = await seedKept(folders.stateDir);
    await stageRestoreRequest(folders.stateDir, {
      artifact: new Uint8Array([1, 2, 3]),
      recoveryKey: "key",
      environment: "production",
    });
    const restore = vi.fn(placement);
    const run = runStagedRestore(
      { ...folders, migrationsRoot: null, log: () => {} },
      restore,
      restore,
    );
    if (placed) await expect(run).resolves.toBe(true);
    else await expect(run).rejects.toThrow("refused placement");
    expect(restore).toHaveBeenCalledOnce();
    if (placed)
      expect(
        JSON.parse(await readFile(join(folders.stateDir, "flows/restore/record.json"), "utf8")),
      ).not.toHaveProperty("request");
    else
      expect(
        JSON.parse(await readFile(join(folders.stateDir, "flows/restore/record.json"), "utf8")),
      ).toMatchObject({ phase: "staged", request: { environment: "production" } });
    expect(await kept.bytes()).toEqual(kept.before);
  },
);

it("lifetime: the in-app reset leaves the choice record unchanged", async () => {
  const folders = await emptyFolders();
  const kept = await seedKept(folders.stateDir);
  const operations = createSetupOperationStore(folders.stateDir);
  await operations
    .run("adopt", "a-request", async (operation) => {
      await operation.advance("venue_committed", { resetProof: {} });
      throw new Error("stopped partway");
    })
    .catch(() => {});
  await stageResetRequest(folders.stateDir, (await operations.read())!.id);
  expect(await runStagedReset({ ...folders, log: () => {} })).toBe(true);
  expect(await operations.read()).toBeNull();
  expect(await kept.bytes()).toEqual(kept.before);
});

it("lifetime: a restart of the repair listener leaves the choice record unchanged", async () => {
  const { f } = await abandonedAttempt();
  await rm(join(f.venueDir, "venue.db"));
  const kept = await seedKept(f.stateDir);
  const served: { app: Hono; onRepaired?: () => Promise<void> }[] = [];
  const closes: number[] = [];
  const server = await startServerOrFirstSetupResolution(
    { WAITRON_STATE_DIR: f.stateDir, WAITRON_VENUE_DIR: f.venueDir },
    {},
    {
      startServer: async () => {
        throw new Error("ordinary boot reached");
      },
      serveResolution: async (app, options) => {
        served.push({ app, onRepaired: options.onRepaired });
        return { close: async () => void closes.push(1) };
      },
    },
  );
  try {
    await served[0]!.onRepaired!();
  } finally {
    await server.close();
  }
  expect(served).toHaveLength(2);
  expect(closes).toHaveLength(2);
  for (const { app } of served)
    expect((await app.request("/setup-api/first-setup/resolution")).status).toBe(200);
  expect(await kept.bytes()).toEqual(kept.before);
});

it.each([
  ["a file or folder it does not expect", "layout unexpected: /venue/stray", "unexpected"],
  ["a listed file it cannot hash", "check failed: EACCES /state/modules.json", "unreadable"],
] as const)(
  "a deletion marker refused for %s (%s) is setup.not_ready with cause %s, keeping the reason",
  (_label, reason, cause) => {
    const refused = new AppError("setup.start_again_incomplete", {}, { reason });
    expect(markerRefusal(refused)).toMatchObject({
      code: "setup.not_ready",
      params: { cause },
      reason,
    });
  },
);

it("any other failure building the deletion marker passes through unchanged", () => {
  const other = new AppError("setup.start_again_files_found", {});
  expect(markerRefusal(other)).toBe(other);
});
