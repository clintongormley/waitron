import { createHash, randomBytes, randomUUID } from "node:crypto";
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
import * as fsPromises from "node:fs/promises";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { openVenueDatabase } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ALL_MODULES } from "@waitron/composition";
import { AppError } from "@waitron/shared";
import {
  START_AGAIN_MARKER_FILE,
  finishStartAgainDeletion,
  raiseStartAgainNote,
  readModulePreparationHistory,
  readStartAgainMarker,
  readStartAgainNote,
  startAgainMarkerFor,
  writeStartAgainMarker,
  writeStartAgainConfirmation,
  firstSetupFrozenDigest,
  assertOtherFirstSetupAllowed,
  createFirstSetupBackupWorkspace,
  type FirstSetupChange,
  type StartAgainSummary,
} from "@waitron/provisioning";
import {
  EPOCH_MS,
  MINUTE_MS,
  decodeMinuteIdentity,
} from "@waitron/fiscal-verifactu/src/hour-identity.js";
import { publicHourSelectionHistory } from "@waitron/fiscal-verifactu/src/hour-selection.js";
import { hourFirstFiscalFixture } from "../test/hour-first-fiscal.js";
import { expectStartAgainDeleted } from "../test/start-again-deleted.js";
import { PASSWORD, request } from "../test/first-fiscal.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";
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
import { createFirstSetupBackupRecovery } from "./first-setup-backup-recovery.js";
import { mountFirstSetupBackupApi } from "./setup-first-backup-api.js";

vi.mock("@waitron/provisioning", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/provisioning")>();
  return { ...actual, raiseStartAgainNote: vi.fn(actual.raiseStartAgainNote) };
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
  const floorMs = EPOCH_MS + (decodeMinuteIdentity(name) + 1) * MINUTE_MS;
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
  return { f, clock, name, floorMs, actions, startRequest };
}

async function startedAgain() {
  const { f, clock, name, floorMs, actions, startRequest } = await abandonedAttempt();
  await actions.startAgainFirstSetup(startRequest);
  const folders = { stateDir: f.stateDir, venueDir: f.venueDir };
  const next = createFirstSetupModuleHost({
    ...folders,
    modules: f.modules,
    environment: {},
    database: () => suite.db,
  });
  const claim = await next.owner.claimFirstSetup(
    {
      environment: "production",
      request: {
        ...request,
        seriesCode: "B",
        fullSeriesCode: "FULL",
        rectificativeSeriesCode: "RECT",
      },
    },
    randomBytes(32).toString("base64url"),
  );
  const owner = { ...claim.state, capability: claim.capability };
  return { f, clock, name, floorMs, folders, next, owner };
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

it("a start-again with the clock set back behind the abandoned attempt's name is refused, not given a repeated name", async () => {
  const { f, name, floorMs, folders, next, owner } = await startedAgain();
  expect(await readStartAgainNote(folders.stateDir)).toEqual({
    version: 1,
    floorMs,
    lastName: name,
    module: "fiscal-verifactu",
  });
  await expect(
    access(join(folders.stateDir, "module-preparation-state.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  vi.setSystemTime(floorMs - MINUTE_MS - 10 * MINUTE_MS);
  await expect(compareAndSelect(next, owner)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "minute_not_later", allowedFromMs: floorMs },
  });
  const state = (await next.store.read())!;
  const context = firstSetupModuleContext(state, f.module);
  expect(context.request).toBeNull();
  expect(state.consumptionIntent).toBe(false);
  const history = await readModulePreparationHistory(folders, f.module);
  expect(
    publicHourSelectionHistory(history).records.filter(
      (record) =>
        (record as { reference: string }).reference ===
        `intent/${f.module}/${context.binding.eventId}`,
    ),
  ).toEqual([]);
});

it("at the abandoned name's own minute, setup waits and then chooses a later name", async () => {
  const { clock, name, floorMs, next, owner } = await startedAgain();
  vi.setSystemTime(floorMs - MINUTE_MS);
  await selectPastWaits(clock, () => compareAndSelect(next, owner));
  expect(decodeMinuteIdentity(await chosenName(next))).toBeGreaterThan(decodeMinuteIdentity(name));
});

it("a clock past the note chooses a later name at once", async () => {
  const { clock, name, floorMs, next, owner } = await startedAgain();
  vi.setSystemTime(floorMs + 5 * MINUTE_MS);
  // One move only: production setup's own 90 to 150 second wait, never a wait for the note.
  await selectPastWaits(clock, () => compareAndSelect(next, owner), 1);
  expect(decodeMinuteIdentity(await chosenName(next))).toBeGreaterThan(decodeMinuteIdentity(name));
});

async function claimedWithoutName() {
  const root = await mkdtemp(join(tmpdir(), "start-again-note-"));
  roots.push(root);
  const folders = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  await mkdir(folders.venueDir, { recursive: true });
  const host = createFirstSetupModuleHost({
    ...folders,
    modules: ALL_MODULES,
    environment: {},
    database: () => suite.db,
  });
  await host.owner.claimFirstSetup(
    { environment: "production", request },
    randomBytes(32).toString("base64url"),
  );
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

it("an attempt whose module never chose a name starts again without a note", async () => {
  const { folders, host, startRequest } = await claimedWithoutName();
  await createFirstSetupResolutionActions({
    ...folders,
    host,
  }).startAgainFirstSetup(startRequest);
  expect(await readStartAgainNote(folders.stateDir)).toBeNull();
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
  expect(await readStartAgainNote(folders.stateDir)).toBeNull();
});

it("two Start again requests at once raise the note once", async () => {
  const { f, name, floorMs, actions, startRequest } = await abandonedAttempt();
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
  vi.mocked(raiseStartAgainNote).mockClear();
  const results = await Promise.allSettled([
    actions.startAgainFirstSetup(startRequest),
    actions.startAgainFirstSetup(startRequest),
  ]);
  expect(arrived).toBe(2);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const refusal = results.find((result) => result.status === "rejected");
  expect(refusal?.reason).toMatchObject({ code: "setup.attempt_conflict" });
  expect(vi.mocked(raiseStartAgainNote)).toHaveBeenCalledTimes(1);
  expect(await readStartAgainNote(f.stateDir)).toEqual({
    version: 1,
    floorMs,
    lastName: name,
    module: "fiscal-verifactu",
  });
});

const CONFIRMATIONS = "first-setup-start-again-confirmations";

async function missingDatabase(
  changes: readonly FirstSetupChange[] = [],
  afterRemove?: (f: Awaited<ReturnType<typeof abandonedAttempt>>["f"]) => Promise<void>,
  stamp?: (f: Awaited<ReturnType<typeof abandonedAttempt>>["f"]) => Promise<void>,
) {
  const base = await abandonedAttempt();
  const { f } = base;
  let state = (await f.store.read())!;
  for (const change of changes)
    state = await f.store.update(state.frozen.attemptId, state.revision, change);
  await rm(join(f.venueDir, "venue.db"));
  await afterRemove?.(f);
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  const recovered = await f.host.owner.recoverFirstSetupOwner({
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    password: PASSWORD,
  });
  await stamp?.(f);
  const current = await f.host.resolution.inspectFirstSetupResolution();
  const owner = {
    attemptId: recovered.state.attemptId,
    revision: recovered.state.revision,
    ownerGeneration: recovered.state.ownerGeneration,
    capability: recovered.capability,
  };
  const ids = {
    inspectionId: current.inspectionId,
    revision: current.revision!,
    ownerGeneration: current.ownerGeneration!,
  };
  return { ...base, owner, ids, request: { ...ids, owner, register: base.startRequest.register } };
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

function ownerHeaders(owner: Awaited<ReturnType<typeof missingDatabase>>["owner"]) {
  return {
    "X-Waitron-Setup-Owner": owner.capability,
    "X-Waitron-Setup-Attempt": owner.attemptId,
    "X-Waitron-Setup-Revision": String(owner.revision),
    "X-Waitron-Setup-Generation": String(owner.ownerGeneration),
  };
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
      join(f.stateDir, "first-setup.json"),
      join(f.venueDir, "first-setup-claim.json"),
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
  expect(await readStartAgainNote(f.stateDir)).toBeNull();
});

it("a confirmation whose summary differs from the box's own is refused, and nothing is written", async () => {
  const { f, name, actions, request } = await missingDatabase();
  const before = await attemptFiles(f);
  for (const shown of [
    { reached: "claimed" as const, lastName: name },
    { reached: "named" as const, lastName: "00000" },
  ]) {
    await expect(
      actions.startAgainFirstSetup({
        ...request,
        confirmMissingDatabase: { nothingFiledOrSold: true, shown },
      }),
    ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  }
  expect(await attemptFiles(f)).toEqual(before);
  await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readStartAgainNote(f.stateDir)).toBeNull();
});

it("a confirmed Start again writes the confirmation record with who, when and what the record showed", async () => {
  const { f, name, actions, owner, ids, request } = await missingDatabase();
  const app = routes(f, actions);
  const answered = await postSummary(app, ids, ownerHeaders(owner));
  expect(answered.status, await answered.clone().text()).toBe(200);
  const shown = await answered.json();
  expect(shown).toEqual({ reached: "named", lastName: name });
  const state = (await f.store.read())!;
  const at = new Date().toISOString();
  await actions.startAgainFirstSetup({
    ...request,
    confirmMissingDatabase: { nothingFiledOrSold: true, shown },
  });
  const files = await readdir(join(f.stateDir, CONFIRMATIONS));
  expect(files).toEqual([`${Date.parse(at)}-${state.frozen.attemptId}.json`]);
  expect(JSON.parse(await readFile(join(f.stateDir, CONFIRMATIONS, files[0]!), "utf8"))).toEqual({
    version: 1,
    at,
    attemptId: state.frozen.attemptId,
    database: "missing",
    administrator: {
      displayName: state.frozen.request.admin.displayName,
      email: state.frozen.request.admin.email,
    },
    ownerGeneration: owner.ownerGeneration,
    shown,
  });
});

it("an attempt that finished activation shows it and can be started again on confirmation, and the note holds its name", async () => {
  const { f, name, actions, owner, ids, request } = await missingDatabase([
    { kind: "activation-started" },
    { kind: "committed", result: {} },
  ]);
  const answered = await postSummary(routes(f, actions), ids, ownerHeaders(owner));
  expect(answered.status, await answered.clone().text()).toBe(200);
  const shown = await answered.json();
  expect(shown).toEqual({ reached: "fiscal-finished", lastName: name });
  await actions.startAgainFirstSetup({
    ...request,
    confirmMissingDatabase: { nothingFiledOrSold: true, shown },
  });
  expect(await readStartAgainNote(f.stateDir)).toMatchObject({ lastName: name });
});

it("the summary route refuses when the database is present", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  const { inspectionId, revision, ownerGeneration } = startRequest;
  const response = await postSummary(
    routes(f, actions),
    { inspectionId, revision, ownerGeneration },
    ownerHeaders(f.ownerAttempt),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: { code: "setup.not_ready", params: {} } });
});

it("the summary route refuses without the owner headers", async () => {
  const { f, actions, ids } = await missingDatabase();
  const response = await postSummary(routes(f, actions), ids, {});
  expect(await response.json()).toEqual({ error: { code: "setup.owner_required", params: {} } });
});

it("the summary route refuses over plain HTTP", async () => {
  const { f, actions, owner, ids } = await missingDatabase();
  const response = await postSummary(routes(f, actions), ids, ownerHeaders(owner), {
    incoming: { socket: new Socket() },
  });
  expect(await response.json()).toEqual({ error: { code: "setup.owner_required", params: {} } });
});

it("a confirmation sent while the database is present is refused", async () => {
  const { f, name, actions, startRequest } = await abandonedAttempt();
  const before = await attemptFiles(f);
  await expect(
    actions.startAgainFirstSetup({
      ...startRequest,
      confirmMissingDatabase: {
        nothingFiledOrSold: true,
        shown: { reached: "named", lastName: name },
      },
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await attemptFiles(f)).toEqual(before);
  await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
});

it("a complete attempt is still refused", async () => {
  const { f, name, actions, request } = await missingDatabase([
    { kind: "activation-started" },
    { kind: "committed", result: {} },
  ]);
  // The setup password cannot be proved on a complete attempt, so it completes after the proof.
  let state = (await f.store.read())!;
  for (const change of [{ kind: "publication" }, { kind: "complete" }] as const)
    state = await f.store.update(state.frozen.attemptId, state.revision, change);
  const current = await f.host.resolution.inspectFirstSetupResolution();
  await expect(
    actions.startAgainFirstSetup({
      ...request,
      inspectionId: current.inspectionId,
      revision: current.revision!,
      ownerGeneration: current.ownerGeneration!,
      confirmMissingDatabase: {
        nothingFiledOrSold: true,
        shown: { reached: "fiscal-finished", lastName: name },
      },
    }),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
});

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  );

it("on a missing database, the confirmation record is on disk before the note, the note before the marker, and all three before the first deletion", async () => {
  const { f, name, request } = await missingDatabase();
  const confirmations = join(f.stateDir, CONFIRMATIONS);
  const marker = join(f.venueDir, START_AGAIN_MARKER_FILE);
  const atNote: boolean[] = [];
  const actual = vi.mocked(raiseStartAgainNote).getMockImplementation()!;
  vi.mocked(raiseStartAgainNote).mockImplementation(async (...args) => {
    atNote.push(await exists(confirmations), await exists(marker));
    return actual(...args);
  });
  const atDeletion: boolean[] = [];
  const actions = createFirstSetupResolutionActions({
    ...f,
    host: f.host,
    remove: async () => {
      atDeletion.push(
        await exists(confirmations),
        await exists(join(f.stateDir, "first-setup-start-again.json")),
        await exists(marker),
      );
      throw new Error("removal refused");
    },
  });
  const before = await attemptFiles(f);
  await expect(
    actions.startAgainFirstSetup({
      ...request,
      confirmMissingDatabase: {
        nothingFiledOrSold: true,
        shown: { reached: "named", lastName: name },
      },
    }),
  ).rejects.toMatchObject({ code: "setup.start_again_incomplete" });
  expect(atNote).toEqual([true, false]);
  expect(atDeletion).toEqual([true, true, true]);
  expect(await readdir(confirmations)).toHaveLength(1);
  expect(await readStartAgainMarker(f.venueDir)).not.toBeNull();
  expect(await attemptFiles(f)).toEqual(before);
});

it("the Start again route takes the confirmation only in its exact shape", async () => {
  const { f, name, actions, owner, ids, request } = await missingDatabase();
  const app = routes(f, actions);
  const send = (confirmMissingDatabase: unknown) =>
    app.request(
      "https://box.test/setup-api/first-setup/resolution/start-again",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...ownerHeaders(owner) },
        body: JSON.stringify({ ...ids, register: request.register, confirmMissingDatabase }),
      },
      tls(),
    );
  const shown = { reached: "named", lastName: name };
  for (const malformed of [
    { nothingFiledOrSold: false, shown },
    { nothingFiledOrSold: "true", shown },
    { nothingFiledOrSold: true, shown, extra: 1 },
    { nothingFiledOrSold: true },
    { nothingFiledOrSold: true, shown: { ...shown, extra: 1 } },
    { nothingFiledOrSold: true, shown: { reached: "named" } },
    { nothingFiledOrSold: true, shown: { ...shown, reached: "complete" } },
    { nothingFiledOrSold: true, shown: { ...shown, lastName: "" } },
    { nothingFiledOrSold: true, shown: { ...shown, lastName: "A".repeat(65) } },
    { nothingFiledOrSold: true, shown: { ...shown, lastName: 5 } },
  ]) {
    const refused = await send(malformed);
    expect(await refused.json(), JSON.stringify(malformed)).toEqual({
      error: { code: "setup.request_invalid", params: { field: "body" } },
    });
  }
  await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
  const accepted = await send({ nothingFiledOrSold: true, shown });
  expect(accepted.status, await accepted.clone().text()).toBe(200);
  expect(await readdir(join(f.stateDir, CONFIRMATIONS))).toHaveLength(1);
});

it("the Start again route takes a shown backup recovery only in its exact shape", async () => {
  const { f, name, actions, owner, ids, request } = await missingDatabase();
  const app = routes(f, actions);
  const recovery = {
    startedAt: "2026-10-16T11:40:00.000Z",
    lastActiveAt: "2026-10-16T11:44:00.000Z",
    lastActiveSource: "saved-step",
    lastName: name,
    failed: false,
    cloud: false,
  };
  const send = (value: unknown) =>
    sendStartAgain(app, owner, {
      ...ids,
      register: request.register,
      confirmMissingDatabase: {
        nothingFiledOrSold: true,
        shown: { reached: "named", lastName: name, recovery: value },
      },
    });
  for (const malformed of [
    null,
    { ...recovery, extra: 1 },
    { ...recovery, startedAt: undefined },
    { ...recovery, startedAt: "yesterday" },
    { ...recovery, lastActiveAt: 5 },
    { ...recovery, lastActiveSource: "disk" },
    { ...recovery, lastName: undefined },
    { ...recovery, lastName: 5 },
    { ...recovery, lastName: "" },
    { ...recovery, lastName: "A".repeat(65) },
    { ...recovery, failed: "false" },
    { ...recovery, cloud: 0 },
  ]) {
    const refused = await send(malformed);
    expect(await refused.json(), JSON.stringify(malformed)).toEqual({
      error: { code: "setup.request_invalid", params: { field: "body" } },
    });
  }
  // A well-formed recovery, with a name or with none, reaches the action, which finds none here.
  for (const shown of [recovery, { ...recovery, lastName: null }]) {
    const passed = await send(shown);
    expect(passed.status).toBe(409);
    expect(await passed.json()).toEqual({ error: { code: "setup.attempt_conflict", params: {} } });
  }
  await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readStartAgainNote(f.stateDir)).toBeNull();
});

it("the Start again route takes confirmRecoveryDiscard only in its exact shape, with a shown recovery", async () => {
  const { f, name, actions, owner, ids, request } = await missingDatabase();
  const reached: unknown[] = [];
  const app = routes(f, {
    ...actions,
    startAgainFirstSetup: async (body) => {
      reached.push(body.confirmRecoveryDiscard);
    },
  });
  const recovery = {
    startedAt: "2026-10-16T11:40:00.000Z",
    lastActiveAt: "2026-10-16T11:44:00.000Z",
    lastActiveSource: "memory",
    lastName: name,
    failed: false,
    cloud: false,
  };
  const shown = { reached: "named", lastName: name, recovery };
  const send = (confirmRecoveryDiscard: unknown) =>
    sendStartAgain(app, owner, { ...ids, register: request.register, confirmRecoveryDiscard });
  for (const malformed of [
    null,
    {},
    { shown, extra: 1 },
    { nothingFiledOrSold: true, shown },
    { shown: { reached: "named", lastName: name } },
    { shown: { ...shown, extra: 1 } },
    { shown: { ...shown, recovery: { ...recovery, extra: 1 } } },
    { shown: { ...shown, recovery: { ...recovery, cloud: 0 } } },
    { shown: { ...shown, recoveryRecordDamaged: false } },
    { shown: { ...shown, reached: "complete" } },
  ]) {
    const refused = await send(malformed);
    expect(await refused.json(), JSON.stringify(malformed)).toEqual({
      error: { code: "setup.request_invalid", params: { field: "body" } },
    });
  }
  expect(reached).toEqual([]);
  const damaged = { ...shown, recoveryRecordDamaged: true };
  for (const value of [shown, damaged]) {
    const passed = await send({ shown: value });
    expect(passed.status, await passed.clone().text()).toBe(200);
  }
  expect(reached).toEqual([{ shown }, { shown: damaged }]);
});

it("the Start again route takes confirmUnreadable only in its exact shape, with a shown unreadable", async () => {
  const { f, name, actions, owner, ids, request } = await missingDatabase();
  const reached: unknown[] = [];
  const app = routes(f, {
    ...actions,
    startAgainFirstSetup: async (body) => {
      reached.push(body.confirmUnreadable);
    },
  });
  const unreadable = { records: ["series-picks"], floorMs: 1_792_162_020_000 };
  const shown = { reached: "named", lastName: name, unreadable };
  const send = (confirmUnreadable: unknown) =>
    sendStartAgain(app, owner, { ...ids, register: request.register, confirmUnreadable });
  for (const malformed of [
    null,
    "yes",
    [],
    {},
    { shown, extra: 1 },
    { nothingFiledOrSold: true, shown },
    { shown: { reached: "named", lastName: name } },
    { shown: { ...shown, extra: 1 } },
    { shown: { ...shown, unreadable: { ...unreadable, extra: 1 } } },
    { shown: { ...shown, unreadable: { records: [], floorMs: unreadable.floorMs } } },
    { shown: { ...shown, unreadable: { ...unreadable, floorMs: 1.5 } } },
    { shown: { ...shown, unreadable: null } },
  ]) {
    const refused = await send(malformed);
    expect(await refused.json(), JSON.stringify(malformed)).toEqual({
      error: { code: "setup.request_invalid", params: { field: "body" } },
    });
  }
  expect(reached).toEqual([]);
  const passed = await send({ shown });
  expect(passed.status, await passed.clone().text()).toBe(200);
  expect(reached).toEqual([{ shown }]);
});

it("the Start again route takes a shown unreadable only in its exact shape, and passes it on", async () => {
  const { f, name, actions, owner, ids, request } = await missingDatabase();
  const reached: unknown[] = [];
  const app = routes(f, {
    ...actions,
    startAgainFirstSetup: async (body) => {
      reached.push(body.confirmMissingDatabase?.shown);
    },
  });
  const unreadable = { records: ["series-picks", "public-record"], floorMs: 1_792_162_020_000 };
  const send = (value: unknown) =>
    sendStartAgain(app, owner, {
      ...ids,
      register: request.register,
      confirmMissingDatabase: {
        nothingFiledOrSold: true,
        shown: { reached: "named", lastName: name, unreadable: value },
      },
    });
  for (const malformed of [
    { floorMs: unreadable.floorMs },
    { records: [], floorMs: unreadable.floorMs },
    { records: ["node-key"], floorMs: unreadable.floorMs },
    { records: ["series-picks", "series-picks"], floorMs: unreadable.floorMs },
    { records: ["public-record", "series-picks"], floorMs: unreadable.floorMs },
    { records: "series-picks", floorMs: unreadable.floorMs },
    { ...unreadable, extra: 1 },
    { records: unreadable.records },
    { ...unreadable, floorMs: String(unreadable.floorMs) },
    { ...unreadable, floorMs: 1.5 },
    null,
  ]) {
    const refused = await send(malformed);
    expect(await refused.json(), JSON.stringify(malformed)).toEqual({
      error: { code: "setup.request_invalid", params: { field: "body" } },
    });
  }
  expect(reached).toEqual([]);
  const all = {
    records: ["series-picks", "public-record", "fiscal-documents"],
    floorMs: unreadable.floorMs,
  };
  for (const value of [unreadable, all]) {
    const passed = await send(value);
    expect(passed.status, await passed.clone().text()).toBe(200);
  }
  expect(reached).toEqual([
    { reached: "named", lastName: name, unreadable },
    { reached: "named", lastName: name, unreadable: all },
  ]);
});

function recoveryRecord(f: Awaited<ReturnType<typeof abandonedAttempt>>["f"]) {
  return join(f.stateDir, "first-fiscal-documents", `${f.module}.recovery.json`);
}

async function damageRecoveryRecord(f: Awaited<ReturnType<typeof abandonedAttempt>>["f"]) {
  await expect(lstat(recoveryRecord(f))).resolves.toMatchObject({ size: expect.any(Number) });
  await writeFile(recoveryRecord(f), "{damaged");
}

function sendStartAgain(
  app: Hono,
  owner: Awaited<ReturnType<typeof missingDatabase>>["owner"],
  body: unknown,
) {
  return app.request(
    "https://box.test/setup-api/first-setup/resolution/start-again",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ownerHeaders(owner) },
      body: JSON.stringify(body),
    },
    tls(),
  );
}

it("with the database missing, a damaged recovery record reaches the confirmation: the summary route answers it, never setup.not_ready", async () => {
  const { f, name, actions, owner, ids } = await missingDatabase([], damageRecoveryRecord);
  const answered = await postSummary(routes(f, actions), ids, ownerHeaders(owner));
  expect(answered.status, await answered.clone().text()).toBe(200);
  expect(await answered.json()).toEqual({
    reached: "named",
    lastName: name,
    recoveryRecordDamaged: true,
  });
});

it("Start again past a damaged recovery record goes ahead once the summary showing it is confirmed", async () => {
  const { f, name, actions, owner, ids, request } = await missingDatabase([], damageRecoveryRecord);
  const app = routes(f, actions);
  const shown = await (await postSummary(app, ids, ownerHeaders(owner))).json();
  const accepted = await sendStartAgain(app, owner, {
    ...ids,
    register: request.register,
    confirmMissingDatabase: { nothingFiledOrSold: true, shown },
  });
  expect(accepted.status, await accepted.clone().text()).toBe(200);
  const files = await readdir(join(f.stateDir, CONFIRMATIONS));
  expect(files).toHaveLength(1);
  expect(
    JSON.parse(await readFile(join(f.stateDir, CONFIRMATIONS, files[0]!), "utf8")).shown,
  ).toEqual({ reached: "named", lastName: name, recoveryRecordDamaged: true });
  expect((await readStartAgainNote(f.stateDir))?.lastName).toBe(name);
  await expectStartAgainDeleted(f);
});

it("a confirmation that did not show the damaged recovery record is refused, and nothing is written", async () => {
  const { f, name, actions, request } = await missingDatabase([], damageRecoveryRecord);
  const before = await attemptFiles(f);
  await expect(
    actions.startAgainFirstSetup({
      ...request,
      confirmMissingDatabase: {
        nothingFiledOrSold: true,
        shown: { reached: "named", lastName: name },
      },
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await attemptFiles(f)).toEqual(before);
  await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readStartAgainNote(f.stateDir)).toBeNull();
});

it("a confirmation that shows a damaged recovery record the box does not find is refused", async () => {
  const { f, name, actions, request } = await missingDatabase();
  await expect(lstat(recoveryRecord(f))).resolves.toMatchObject({ size: expect.any(Number) });
  const before = await attemptFiles(f);
  await expect(
    actions.startAgainFirstSetup({
      ...request,
      confirmMissingDatabase: {
        nothingFiledOrSold: true,
        shown: { reached: "named", lastName: name, recoveryRecordDamaged: true },
      },
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await attemptFiles(f)).toEqual(before);
  expect(await readStartAgainNote(f.stateDir)).toBeNull();
});

it("the Start again route takes recoveryRecordDamaged only as true", async () => {
  const { f, name, actions, owner, ids, request } = await missingDatabase();
  const app = routes(f, actions);
  for (const recoveryRecordDamaged of [false, "true", 1]) {
    const refused = await sendStartAgain(app, owner, {
      ...ids,
      register: request.register,
      confirmMissingDatabase: {
        nothingFiledOrSold: true,
        shown: { reached: "named", lastName: name, recoveryRecordDamaged },
      },
    });
    expect(await refused.json(), JSON.stringify(recoveryRecordDamaged)).toEqual({
      error: { code: "setup.request_invalid", params: { field: "body" } },
    });
  }
  await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
});

it("the Start again route takes recoveryRecordDamagedShown only as true", async () => {
  const { f, actions, owner, ids, request } = await missingDatabase();
  const app = routes(f, actions);
  for (const recoveryRecordDamagedShown of [false, "true", 1]) {
    const refused = await sendStartAgain(app, owner, {
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
  await stampTree(join(f.venueDir, "first-setup-claim.json"), listed);
  const picks = new Date(nameMs + PICKS_AFTER_NAME_MS);
  await utimes(picksFile(f), picks, picks);
}

async function damagedPicksAttempt(options: { picks: boolean; recoveryRecord: boolean }) {
  const base = await missingDatabase(
    [],
    async (f) => {
      if (options.picks) await damagePicks(f);
      if (options.recoveryRecord) await damageRecoveryRecord(f);
    },
    stampAfterName,
  );
  const picksMs = EPOCH_MS + decodeMinuteIdentity(base.name) * MINUTE_MS + PICKS_AFTER_NAME_MS;
  const timeFloorMs = (Math.floor((picksMs + 150_000) / MINUTE_MS) + 1) * MINUTE_MS;
  return { ...base, timeFloorMs };
}

async function summaryThenStartAgain(base: Awaited<ReturnType<typeof missingDatabase>>) {
  const { f, actions, owner, ids, request } = base;
  const answered = await postSummary(routes(f, actions), ids, ownerHeaders(owner));
  expect(answered.status, await answered.clone().text()).toBe(200);
  const shown = await answered.json();
  await actions.startAgainFirstSetup({
    ...request,
    confirmMissingDatabase: { nothingFiledOrSold: true, shown },
  });
  return shown;
}

it("with the database missing, a damaged kept picks file reaches the confirmation, and the note keeps a time floor with no name", async () => {
  const base = await damagedPicksAttempt({ picks: true, recoveryRecord: false });
  expect(base.timeFloorMs).toBeGreaterThan(base.floorMs);
  const shown = await summaryThenStartAgain(base);
  expect(shown).toEqual({
    reached: "named",
    lastName: base.name,
    unreadable: { records: ["series-picks"], floorMs: base.timeFloorMs },
  });
  expect(await readStartAgainNote(base.f.stateDir)).toEqual({
    version: 1,
    floorMs: base.timeFloorMs,
    lastName: null,
    module: "fiscal-verifactu",
  });
  await expectStartAgainDeleted(base.f);
});

/** A Start again past a damaged picks file stamped after every other listed item, then a new claim. */
async function startedAgainPastDamagedPicks() {
  const base = await damagedPicksAttempt({ picks: true, recoveryRecord: false });
  const { f, clock, name, timeFloorMs } = base;
  await summaryThenStartAgain(base);
  expect(await readStartAgainNote(f.stateDir)).toEqual({
    version: 1,
    floorMs: timeFloorMs,
    lastName: null,
    module: "fiscal-verifactu",
  });
  const next = createFirstSetupModuleHost({
    stateDir: f.stateDir,
    venueDir: f.venueDir,
    modules: f.modules,
    environment: {},
    database: () => suite.db,
  });
  const claim = await next.owner.claimFirstSetup(
    {
      environment: "production",
      request: {
        ...request,
        seriesCode: "B",
        fullSeriesCode: "FULL",
        rectificativeSeriesCode: "RECT",
      },
    },
    randomBytes(32).toString("base64url"),
  );
  const owner = { ...claim.state, capability: claim.capability };
  const picksMinute = decodeMinuteIdentity(name) + PICKS_AFTER_NAME_MS / MINUTE_MS;
  return { f, clock, timeFloorMs, picksMinute, next, owner };
}

it("after a Start again past a damaged picks file, a clock before the note's time floor is refused, not given a name", async () => {
  const { f, timeFloorMs, next, owner } = await startedAgainPastDamagedPicks();
  vi.setSystemTime(timeFloorMs - 3 * MINUTE_MS);
  await expect(compareAndSelect(next, owner)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "minute_not_later", allowedFromMs: timeFloorMs },
  });
  const state = (await next.store.read())!;
  const context = firstSetupModuleContext(state, f.module);
  expect(context.request).toBeNull();
  expect(state.consumptionIntent).toBe(false);
  const history = await readModulePreparationHistory(f, f.module);
  expect(
    publicHourSelectionHistory(history).records.filter(
      (record) =>
        (record as { reference: string }).reference ===
        `intent/${f.module}/${context.binding.eventId}`,
    ),
  ).toEqual([]);
});

it("after a Start again past a damaged picks file, a clock a minute before the time floor waits, then chooses a name no earlier than the floor", async () => {
  const { clock, timeFloorMs, picksMinute, next, owner } = await startedAgainPastDamagedPicks();
  vi.setSystemTime(timeFloorMs - MINUTE_MS);
  await selectPastWaits(clock, () => compareAndSelect(next, owner));
  const chosen = decodeMinuteIdentity(await chosenName(next));
  expect(chosen).toBeGreaterThan(picksMinute);
  expect(EPOCH_MS + chosen * MINUTE_MS).toBeGreaterThanOrEqual(timeFloorMs);
});

it("after a Start again past a damaged picks file, a clock past the time floor chooses a later name at once", async () => {
  const { clock, timeFloorMs, picksMinute, next, owner } = await startedAgainPastDamagedPicks();
  vi.setSystemTime(timeFloorMs + 5 * MINUTE_MS);
  // One move only: production setup's own 90 to 150 second wait, never a wait for the note.
  await selectPastWaits(clock, () => compareAndSelect(next, owner), 1);
  expect(decodeMinuteIdentity(await chosenName(next))).toBeGreaterThan(picksMinute);
});

it("with the database missing, the same file times on an intact picks file leave the summary and the note as they were", async () => {
  const base = await damagedPicksAttempt({ picks: false, recoveryRecord: false });
  const shown = await summaryThenStartAgain(base);
  expect(shown).toEqual({ reached: "named", lastName: base.name });
  expect(await readStartAgainNote(base.f.stateDir)).toEqual({
    version: 1,
    floorMs: base.floorMs,
    lastName: base.name,
    module: "fiscal-verifactu",
  });
});

it("with the database missing, a damaged recovery record beside a damaged picks file shows both", async () => {
  const base = await damagedPicksAttempt({ picks: true, recoveryRecord: true });
  const shown = await summaryThenStartAgain(base);
  expect(shown).toEqual({
    reached: "named",
    lastName: base.name,
    recoveryRecordDamaged: true,
    unreadable: { records: ["series-picks"], floorMs: base.timeFloorMs },
  });
  expect(await readStartAgainNote(base.f.stateDir)).toEqual({
    version: 1,
    floorMs: base.timeFloorMs,
    lastName: null,
    module: "fiscal-verifactu",
  });
});

it("with the database present and no password, a damaged kept picks file asks for the password, and nothing changes", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  await damagePicks(f);
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  const before = await folderTrees(f);
  await expect(
    actions.startAgainFirstSetup({
      ...startRequest,
      inspectionId: inspected.inspectionId,
      revision: inspected.revision!,
      ownerGeneration: inspected.ownerGeneration!,
    }),
  ).rejects.toMatchObject({
    code: "setup.start_again_password_required",
    params: { seriesPicksUnreadable: true },
  });
  expect(await folderTrees(f)).toEqual(before);
  expect(await readStartAgainNote(f.stateDir)).toBeNull();
  expect(await readStartAgainMarker(f.venueDir)).toBeNull();
});

it("with the database present and the setup password, a damaged kept picks file without confirmUnreadable is refused setup.attempt_conflict, and nothing changes", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  await damagePicks(f);
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  const recovered = await f.host.owner.recoverFirstSetupOwner({
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    password: PASSWORD,
  });
  const current = await f.host.resolution.inspectFirstSetupResolution();
  const before = await folderTrees(f);
  await expect(
    actions.startAgainFirstSetup({
      inspectionId: current.inspectionId,
      revision: current.revision!,
      ownerGeneration: current.ownerGeneration!,
      owner: {
        attemptId: recovered.state.attemptId,
        revision: recovered.state.revision,
        ownerGeneration: recovered.state.ownerGeneration,
        capability: recovered.capability,
      },
      register: startRequest.register,
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await folderTrees(f)).toEqual(before);
  expect(await readStartAgainNote(f.stateDir)).toBeNull();
  expect(await readStartAgainMarker(f.venueDir)).toBeNull();
});

/** `extraSeat` installs a copy of the frozen module, seat and all, under a name the attempt never froze. */
async function presentDamagedPicks(
  options: { seat?: boolean; extraSeat?: boolean; damaged?: boolean } = {},
) {
  const base = await abandonedAttempt();
  const { f } = base;
  if (options.damaged !== false) await damagePicks(f);
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  const recovered = await f.host.owner.recoverFirstSetupOwner({
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    password: PASSWORD,
  });
  await stampAfterName(f);
  const current = await f.host.resolution.inspectFirstSetupResolution();
  const owner = {
    attemptId: recovered.state.attemptId,
    revision: recovered.state.revision,
    ownerGeneration: recovered.state.ownerGeneration,
    capability: recovered.capability,
  };
  const ids = {
    inspectionId: current.inspectionId,
    revision: current.revision!,
    ownerGeneration: current.ownerGeneration!,
  };
  const modules =
    options.seat === false
      ? f.host.modules!.map((module) =>
          module.name !== f.module
            ? module
            : {
                ...module,
                provisioning: {
                  ...module.provisioning,
                  initialSetup: {
                    ...module.provisioning!.initialSetup!,
                    startAgainFloor: undefined,
                  },
                },
              },
        )
      : f.host.modules!;
  const installed = options.extraSeat
    ? [
        ...modules,
        { ...f.host.modules!.find((module) => module.name === f.module)!, name: "probe-extra" },
      ]
    : modules;
  const actions = createFirstSetupResolutionActions({
    ...f,
    host: { ...f.host, modules: installed },
  });
  const picksMs = EPOCH_MS + decodeMinuteIdentity(base.name) * MINUTE_MS + PICKS_AFTER_NAME_MS;
  const timeFloorMs = (Math.floor((picksMs + 150_000) / MINUTE_MS) + 1) * MINUTE_MS;
  return { ...base, actions, owner, ids, timeFloorMs };
}

it("with the database present and the setup password, a damaged kept picks file gets a summary naming it, and Start again without confirming it is refused setup.attempt_conflict", async () => {
  const { f, name, actions, owner, ids, startRequest, timeFloorMs } = await presentDamagedPicks();
  const answered = await postSummary(routes(f, actions), ids, ownerHeaders(owner));
  expect(answered.status, await answered.clone().text()).toBe(200);
  expect(await answered.json()).toEqual({
    reached: "named",
    lastName: name,
    unreadable: { records: ["series-picks"], floorMs: timeFloorMs },
  });
  const before = await folderTrees(f);
  await expect(
    actions.startAgainFirstSetup({ ...ids, owner, register: startRequest.register }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await folderTrees(f)).toEqual(before);
  expect(await readStartAgainNote(f.stateDir)).toBeNull();
});

async function expectPresentNothingWritten(
  f: Awaited<ReturnType<typeof abandonedAttempt>>["f"],
  before: Awaited<ReturnType<typeof folderTrees>>,
) {
  expect(await folderTrees(f)).toEqual(before);
  await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readStartAgainNote(f.stateDir)).toBeNull();
  expect(await readStartAgainMarker(f.venueDir)).toBeNull();
}

it("with the database present, the exact shown summary past a damaged kept picks file starts again, the note keeps a time floor with no name, and the confirmation record holds it", async () => {
  const { f, name, actions, owner, ids, startRequest, timeFloorMs } = await presentDamagedPicks();
  const app = routes(f, actions);
  const shown = (await (
    await postSummary(app, ids, ownerHeaders(owner))
  ).json()) as StartAgainSummary;
  expect(timeFloorMs).toBeGreaterThan(EPOCH_MS + (decodeMinuteIdentity(name) + 1) * MINUTE_MS);
  const accepted = await sendStartAgain(app, owner, {
    ...ids,
    register: startRequest.register,
    confirmUnreadable: { shown },
  });
  expect(accepted.status, await accepted.clone().text()).toBe(200);
  expect(await readStartAgainNote(f.stateDir)).toEqual({
    version: 1,
    floorMs: timeFloorMs,
    lastName: null,
    module: "fiscal-verifactu",
  });
  const files = await readdir(join(f.stateDir, CONFIRMATIONS));
  expect(files).toHaveLength(1);
  const record = JSON.parse(await readFile(join(f.stateDir, CONFIRMATIONS, files[0]!), "utf8"));
  expect(record).toMatchObject({ database: "present" });
  expect(record.shown).toEqual(shown);
  expect(record.shown).toEqual({
    reached: "named",
    lastName: name,
    unreadable: { records: ["series-picks"], floorMs: timeFloorMs },
  });
  await expectStartAgainDeleted(f);
});

it.each([
  [
    "lacks the unreadable records",
    (shown: StartAgainSummary) =>
      Object.fromEntries(
        Object.entries(shown).filter(([key]) => key !== "unreadable"),
      ) as StartAgainSummary,
  ],
  [
    "shows a floor one minute earlier",
    (shown: StartAgainSummary) => ({
      ...shown,
      unreadable: { ...shown.unreadable!, floorMs: shown.unreadable!.floorMs - MINUTE_MS },
    }),
  ],
  [
    "shows a floor one minute later",
    (shown: StartAgainSummary) => ({
      ...shown,
      unreadable: { ...shown.unreadable!, floorMs: shown.unreadable!.floorMs + MINUTE_MS },
    }),
  ],
])(
  "with the database present, a Start again whose confirmUnreadable summary %s is refused setup.attempt_conflict, and nothing is written",
  async (_label, change) => {
    const { f, actions, owner, ids, startRequest } = await presentDamagedPicks();
    const shown = await actions.startAgainSummary({ ...ids, owner });
    expect(shown.unreadable).toBeDefined();
    const before = await folderTrees(f);
    await expect(
      actions.startAgainFirstSetup({
        ...ids,
        owner,
        register: startRequest.register,
        confirmUnreadable: { shown: change(shown) },
      }),
    ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    await expectPresentNothingWritten(f, before);
  },
);

it("with the database present, the same file times on an intact picks file leave the summary refused and Start again password-free, and the note keeps the name", async () => {
  const { f, name, floorMs, actions, startRequest } = await abandonedAttempt();
  await stampAfterName(f);
  const current = await f.host.resolution.inspectFirstSetupResolution();
  expect(current.inspectionId).toBe(startRequest.inspectionId);
  const ids = {
    inspectionId: current.inspectionId,
    revision: current.revision!,
    ownerGeneration: current.ownerGeneration!,
  };
  await expect(actions.startAgainSummary({ ...ids, owner: f.ownerAttempt })).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  await actions.startAgainFirstSetup({ ...startRequest, ...ids });
  expect(await readStartAgainNote(f.stateDir)).toEqual({
    version: 1,
    floorMs,
    lastName: name,
    module: "fiscal-verifactu",
  });
  await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
  await expectStartAgainDeleted(f);
});

it("with the database present, a venue.db-shm time moved between the summary and Start again leaves the floor as shown, and Start again goes ahead", async () => {
  const { f, actions, owner, ids, startRequest, timeFloorMs } = await presentDamagedPicks();
  const shown = await actions.startAgainSummary({ ...ids, owner });
  const shm = join(f.venueDir, "venue.db-shm");
  if ((await lstat(shm).catch(() => null)) === null) await writeFile(shm, "");
  const later = new Date((await lstat(shm)).mtimeMs + 60 * MINUTE_MS);
  await utimes(shm, later, later);
  await actions.startAgainFirstSetup({
    ...ids,
    owner,
    register: startRequest.register,
    confirmUnreadable: { shown },
  });
  expect(await readStartAgainNote(f.stateDir)).toEqual({
    version: 1,
    floorMs: shown.unreadable!.floorMs,
    lastName: null,
    module: "fiscal-verifactu",
  });
  expect(shown.unreadable?.floorMs).toBe(timeFloorMs);
  await expectStartAgainDeleted(f);
});

it("with the database present, a listed file's time moved later between the summary and Start again, bytes unchanged, is refused setup.attempt_conflict, and nothing is written", async () => {
  const { f, name, actions, owner, ids, startRequest, timeFloorMs } = await presentDamagedPicks();
  const shown = await actions.startAgainSummary({ ...ids, owner });
  expect(shown.unreadable?.floorMs).toBe(timeFloorMs);
  const key = join(f.stateDir, "first-setup-node-key.json");
  const bytes = await readFile(key);
  const later = new Date(EPOCH_MS + decodeMinuteIdentity(name) * MINUTE_MS + 3 * 60 * MINUTE_MS);
  await utimes(key, later, later);
  expect(await readFile(key)).toEqual(bytes);
  const current = await f.host.resolution.inspectFirstSetupResolution();
  expect(current.inspectionId).toBe(ids.inspectionId);
  const before = await folderTrees(f);
  await expect(
    actions.startAgainFirstSetup({
      ...ids,
      owner,
      register: startRequest.register,
      confirmUnreadable: { shown },
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await expectPresentNothingWritten(f, before);
});

it("with the database present and an intact picks file, confirmUnreadable is refused setup.attempt_conflict, and nothing is written", async () => {
  const { f, name, actions, owner, ids, startRequest, timeFloorMs } = await presentDamagedPicks({
    damaged: false,
  });
  const before = await folderTrees(f);
  await expect(
    actions.startAgainFirstSetup({
      ...ids,
      owner,
      register: startRequest.register,
      confirmUnreadable: {
        shown: {
          reached: "named",
          lastName: name,
          unreadable: { records: ["series-picks"], floorMs: timeFloorMs },
        },
      },
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await expectPresentNothingWritten(f, before);
});

it("with the database missing, confirmUnreadable beside the confirmation is refused setup.attempt_conflict, and nothing is written", async () => {
  const base = await damagedPicksAttempt({ picks: true, recoveryRecord: false });
  const { f, actions, owner, ids, request } = base;
  const shown = await actions.startAgainSummary({ ...ids, owner });
  expect(shown.unreadable).toBeDefined();
  const before = await folderTrees(f);
  await expect(
    actions.startAgainFirstSetup({
      ...request,
      confirmMissingDatabase: { nothingFiledOrSold: true, shown },
      confirmUnreadable: { shown },
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await folderTrees(f)).toEqual(before);
  await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readStartAgainNote(f.stateDir)).toBeNull();
  expect(await readStartAgainMarker(f.venueDir)).toBeNull();
});

it("with the database present, a summary whose attempt read throws is refused setup.not_ready, not the read's own error", async () => {
  const { f, actions, owner, ids } = await presentDamagedPicks();
  const { store, resolution } = f.host;
  const read = store.readForRepair.bind(store);
  const inspect = resolution.inspectFirstSetupResolution.bind(resolution);
  let armed = false;
  let faults = 0;
  vi.spyOn(resolution, "inspectFirstSetupResolution").mockImplementation(async () => {
    const inspection = await inspect();
    armed = true;
    return inspection;
  });
  vi.spyOn(store, "readForRepair").mockImplementation(async () => {
    if (!armed) return read();
    armed = false;
    faults += 1;
    throw new Error("read fault");
  });
  await expect(actions.startAgainSummary({ ...ids, owner })).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  expect(faults).toBe(1);
});

it("with the database present, picks the first read finds damaged but the gather reads as intact leave the summary refused setup.not_ready", async () => {
  const { f, owner, ids } = await presentDamagedPicks({ damaged: false });
  let picksReads = 0;
  const modules = f.host.modules!.map((module) => {
    const initialSetup = module.provisioning?.initialSetup;
    if (module.name !== f.module || initialSetup?.startAgainFloor === undefined) return module;
    const floor = initialSetup.startAgainFloor;
    return {
      ...module,
      provisioning: {
        ...module.provisioning!,
        initialSetup: {
          ...initialSetup,
          startAgainFloor: (input: Parameters<typeof floor>[0]) => {
            if (input.attempts.length === 0 && input.publicEvidence.length === 0) {
              picksReads += 1;
              if (picksReads === 1)
                throw new AppError("sif.allocation_invalid", { reason: "history_invalid" });
            }
            return floor(input);
          },
        },
      },
    };
  });
  const actions = createFirstSetupResolutionActions({ ...f, host: { ...f.host, modules } });
  await expect(actions.startAgainSummary({ ...ids, owner })).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  expect(picksReads).toBe(2);
});

it("with the database present, a damaged kept picks file still needs the recovered owner before the summary answers", async () => {
  const { f, actions, ids } = await presentDamagedPicks();
  const response = await postSummary(routes(f, actions), ids, ownerHeaders(f.ownerAttempt));
  expect(await response.json()).toEqual({ error: { code: "setup.owner_required", params: {} } });
});

it("with the database present, a damaged kept picks file of a frozen module with no start-again seat leaves the summary refused", async () => {
  const { f, actions, owner, ids } = await presentDamagedPicks({ seat: false });
  const response = await postSummary(routes(f, actions), ids, ownerHeaders(owner));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: { code: "setup.not_ready", params: {} } });
});

it("with the database present, a damaged kept picks file read only by a module the attempt never froze leaves the summary refused before the password", async () => {
  const { f, actions, ids } = await presentDamagedPicks({ seat: false, extraSeat: true });
  const response = await postSummary(routes(f, actions), ids, ownerHeaders(f.ownerAttempt));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: { code: "setup.not_ready", params: {} } });
});

it.each([
  [
    "lacks the unreadable records",
    (shown: StartAgainSummary) => ({ ...shown, unreadable: undefined }),
  ],
  [
    "shows a floor one minute earlier",
    (shown: StartAgainSummary) => ({
      ...shown,
      unreadable: { ...shown.unreadable!, floorMs: shown.unreadable!.floorMs - MINUTE_MS },
    }),
  ],
  [
    "shows a floor one minute later",
    (shown: StartAgainSummary) => ({
      ...shown,
      unreadable: { ...shown.unreadable!, floorMs: shown.unreadable!.floorMs + MINUTE_MS },
    }),
  ],
])(
  "with the database missing, a Start again whose shown summary %s is refused setup.attempt_conflict, and nothing is written",
  async (_label, change) => {
    const base = await damagedPicksAttempt({ picks: true, recoveryRecord: false });
    const { f, actions, owner, ids, request } = base;
    const app = routes(f, actions);
    const shown = (await (
      await postSummary(app, ids, ownerHeaders(owner))
    ).json()) as StartAgainSummary;
    expect(shown.unreadable).toEqual({ records: ["series-picks"], floorMs: base.timeFloorMs });
    const before = await folderTrees(f);
    const refused = await sendStartAgain(app, owner, {
      ...ids,
      register: request.register,
      confirmMissingDatabase: { nothingFiledOrSold: true, shown: change(shown) },
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: { code: "setup.attempt_conflict", params: {} } });
    expect(await folderTrees(f)).toEqual(before);
    await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readStartAgainNote(f.stateDir)).toBeNull();
    expect(await readStartAgainMarker(f.venueDir)).toBeNull();
  },
);

it("with the database missing, the exact shown summary with unreadable records starts again over the route, and the confirmation record holds it", async () => {
  const base = await damagedPicksAttempt({ picks: true, recoveryRecord: true });
  const { f, actions, owner, ids, request } = base;
  const app = routes(f, actions);
  const shown = (await (
    await postSummary(app, ids, ownerHeaders(owner))
  ).json()) as StartAgainSummary;
  const accepted = await sendStartAgain(app, owner, {
    ...ids,
    register: request.register,
    confirmMissingDatabase: { nothingFiledOrSold: true, shown },
  });
  expect(accepted.status, await accepted.clone().text()).toBe(200);
  const files = await readdir(join(f.stateDir, CONFIRMATIONS));
  expect(files).toHaveLength(1);
  expect(
    JSON.parse(await readFile(join(f.stateDir, CONFIRMATIONS, files[0]!), "utf8")).shown,
  ).toEqual({
    reached: "named",
    lastName: base.name,
    recoveryRecordDamaged: true,
    unreadable: { records: ["series-picks"], floorMs: base.timeFloorMs },
  });
  expect(await readStartAgainNote(f.stateDir)).toEqual({
    version: 1,
    floorMs: base.timeFloorMs,
    lastName: null,
    module: "fiscal-verifactu",
  });
  await expectStartAgainDeleted(f);
});

function publicRecordFile(f: Awaited<ReturnType<typeof abandonedAttempt>>["f"]) {
  return join(f.stateDir, "module-operation-public.json");
}

function documentsFile(f: Awaited<ReturnType<typeof abandonedAttempt>>["f"], name: string) {
  return join(f.stateDir, "first-fiscal-documents", name);
}

async function createDamaged(path: string) {
  await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
  await writeFile(path, "{damaged");
}

async function damagedRecordsAttempt(
  damage: (f: Awaited<ReturnType<typeof abandonedAttempt>>["f"]) => Promise<void>,
) {
  const base = await missingDatabase([], damage, stampAfterName);
  const picksMs = EPOCH_MS + decodeMinuteIdentity(base.name) * MINUTE_MS + PICKS_AFTER_NAME_MS;
  const timeFloorMs = (Math.floor((picksMs + 150_000) / MINUTE_MS) + 1) * MINUTE_MS;
  return { ...base, timeFloorMs };
}

it.each([
  {
    which: "a damaged public record",
    records: ["public-record"],
    damage: async (f: Awaited<ReturnType<typeof abandonedAttempt>>["f"]) =>
      createDamaged(publicRecordFile(f)),
  },
  {
    which: "a public record holding evidence the module cannot use",
    records: ["public-record"],
    damage: async (f: Awaited<ReturnType<typeof abandonedAttempt>>["f"]) => {
      const state = (await f.store.read())!;
      await writeFile(
        publicRecordFile(f),
        JSON.stringify({
          version: 1,
          modules: {},
          history: [
            {
              attemptId: state.frozen.attemptId,
              revision: state.revision,
              ownerGeneration: state.ownerGeneration,
              module: f.module,
              current: { unusable: true },
            },
          ],
        }),
      );
    },
  },
  {
    which: "a damaged documents file with the recovery record removed",
    records: ["fiscal-documents"],
    damage: async (f: Awaited<ReturnType<typeof abandonedAttempt>>["f"]) => {
      await rm(recoveryRecord(f));
      await createDamaged(documentsFile(f, `${f.module}.json`));
    },
  },
  {
    which: "a stray documents file with the recovery record removed",
    records: ["fiscal-documents"],
    damage: async (f: Awaited<ReturnType<typeof abandonedAttempt>>["f"]) => {
      await rm(recoveryRecord(f));
      await writeFile(documentsFile(f, "stray.json"), "{}");
    },
  },
  {
    which: "a damaged picks file and a damaged public record",
    records: ["series-picks", "public-record"],
    damage: async (f: Awaited<ReturnType<typeof abandonedAttempt>>["f"]) => {
      await damagePicks(f);
      await createDamaged(publicRecordFile(f));
    },
  },
])(
  "with the database missing, $which reaches the confirmation, and the note keeps a time floor with no name",
  async ({ records, damage }) => {
    const base = await damagedRecordsAttempt(damage);
    expect(base.timeFloorMs).toBeGreaterThan(base.floorMs);
    const shown = await summaryThenStartAgain(base);
    expect(shown).toEqual({
      reached: "named",
      lastName: base.name,
      unreadable: { records, floorMs: base.timeFloorMs },
    });
    expect(await readStartAgainNote(base.f.stateDir)).toEqual({
      version: 1,
      floorMs: base.timeFloorMs,
      lastName: null,
      module: "fiscal-verifactu",
    });
    await expectStartAgainDeleted(base.f);
  },
);

it("with the database missing, a kept recovery statement the module cannot use is named as the fiscal documents, and the note keeps a time floor with no name", async () => {
  const base = await damagedRecordsAttempt(async () => {});
  const { statement } = JSON.parse(await readFile(recoveryRecord(base.f), "utf8")) as {
    statement: unknown;
  };
  await expect(access(publicRecordFile(base.f))).rejects.toMatchObject({ code: "ENOENT" });
  const refusedItems: unknown[] = [];
  const modules = base.f.host.modules!.map((module) => {
    const initialSetup = module.provisioning?.initialSetup;
    if (module.name !== base.f.module || initialSetup?.startAgainFloor === undefined) return module;
    const floor = initialSetup.startAgainFloor;
    return {
      ...module,
      provisioning: {
        ...module.provisioning!,
        initialSetup: {
          ...initialSetup,
          startAgainFloor: (input: Parameters<typeof floor>[0]) => {
            if (input.attempts.length === 0 && input.publicEvidence.length === 1) {
              refusedItems.push(input.publicEvidence[0]);
              throw new AppError("sif.allocation_invalid", { reason: "history_invalid" });
            }
            return floor(input);
          },
        },
      },
    };
  });
  const actions = createFirstSetupResolutionActions({
    ...base.f,
    host: { ...base.f.host, modules },
  });
  const shown = await summaryThenStartAgain({ ...base, actions });
  expect(refusedItems.length).toBeGreaterThan(0);
  for (const item of refusedItems) expect(item).toEqual(statement);
  expect(shown).toEqual({
    reached: "named",
    lastName: base.name,
    unreadable: { records: ["fiscal-documents"], floorMs: base.timeFloorMs },
  });
  expect(await readStartAgainNote(base.f.stateDir)).toEqual({
    version: 1,
    floorMs: base.timeFloorMs,
    lastName: null,
    module: "fiscal-verifactu",
  });
  await expectStartAgainDeleted(base.f);
});

async function expectRefusedUnchanged(
  f: Awaited<ReturnType<typeof abandonedAttempt>>["f"],
  run: () => Promise<unknown>,
  code: string,
) {
  const before = await attemptFiles(f);
  await expect(run()).rejects.toMatchObject({ code });
  expect(await attemptFiles(f)).toEqual(before);
  await expect(access(join(f.stateDir, CONFIRMATIONS))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readStartAgainNote(f.stateDir)).toBeNull();
  expect(await readStartAgainMarker(f.venueDir)).toBeNull();
}

it.each(["first-setup.json", "first-setup-claim.json"])(
  "with the database missing, a damaged %s beside a damaged picks file is refused setup.owner_required at the password step, and nothing changes",
  async (file) => {
    const { f } = await abandonedAttempt();
    await damagePicks(f);
    await rm(join(f.venueDir, "venue.db"));
    await writeFile(join(file === "first-setup.json" ? f.stateDir : f.venueDir, file), "{damaged");
    const inspected = await f.host.resolution.inspectFirstSetupResolution();
    await expectRefusedUnchanged(
      f,
      () =>
        f.host.owner.recoverFirstSetupOwner({
          inspectionId: inspected.inspectionId,
          revision: inspected.revision!,
          ownerGeneration: inspected.ownerGeneration!,
          clientClaimNonce: randomBytes(32).toString("base64url"),
          password: PASSWORD,
        }),
      "setup.owner_required",
    );
  },
);

it.each(["first-setup.json", "first-setup-claim.json"])(
  "with the database present, a damaged %s beside a damaged picks file leaves the box reading no revision, so Start again is refused setup.attempt_conflict for the revision it sends, and nothing changes",
  async (file) => {
    const { f, actions, startRequest } = await abandonedAttempt();
    await damagePicks(f);
    await writeFile(join(file === "first-setup.json" ? f.stateDir : f.venueDir, file), "{damaged");
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

it("a corrupt venue database beside a damaged picks file is refused setup.not_ready, and nothing changes", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  await damagePicks(f);
  await writeFile(join(f.venueDir, "venue.db"), "not a database");
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  expect(inspected.database).not.toBe("missing");
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
});

it.each(["module-operation-public.json", "first-fiscal-documents/stray.json"])(
  "with the database present, a damaged %s still refuses Start again setup.not_ready, and nothing changes",
  async (file) => {
    const { f, actions, startRequest } = await abandonedAttempt();
    await createDamaged(join(f.stateDir, file));
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
  const base = await missingDatabase([], damagePicks, stampAfterName);
  const { f, owner, request: startAgain } = base;
  const outsidePath = join(f.root, "outside-history.json");
  await writeFile(outsidePath, "{}");
  const resolution = createFirstSetupResolutionInspection({
    stateDir: f.stateDir,
    venueDir: f.venueDir,
    store: f.store,
    expectedMigrationSets: f.modules.map((module) => module.migrations.name),
    publicEvidencePaths: [outsidePath],
  });
  const actions = createFirstSetupResolutionActions({ ...f, host: { ...f.host, resolution } });
  const current = await resolution.inspectFirstSetupResolution();
  const ids = {
    inspectionId: current.inspectionId,
    revision: current.revision!,
    ownerGeneration: current.ownerGeneration!,
  };
  const shown = await actions.startAgainSummary({ ...ids, owner });
  expect(shown).toMatchObject({ unreadable: { records: ["series-picks"] } });
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

it("with the database missing, a damaged note beside a damaged picks file is shown, then Start again is refused setup.attempt_invalid after its confirmation record", async () => {
  const base = await missingDatabase(
    [],
    async (f) => {
      await damagePicks(f);
      await createDamaged(join(f.stateDir, NOTE));
    },
    stampAfterName,
  );
  const { f, actions, owner, ids, request: startAgain } = base;
  const answered = await postSummary(routes(f, actions), ids, ownerHeaders(owner));
  expect(answered.status, await answered.clone().text()).toBe(200);
  const shown = await answered.json();
  expect(shown).toMatchObject({ unreadable: { records: ["series-picks"] } });
  const before = await attemptFiles(f);
  const note = await readFile(join(f.stateDir, NOTE));
  await expect(
    actions.startAgainFirstSetup({
      ...startAgain,
      confirmMissingDatabase: { nothingFiledOrSold: true, shown },
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  // Start again writes its confirmation record before it raises the note (backlog entry (iii)).
  expect(await readdir(join(f.stateDir, CONFIRMATIONS))).toHaveLength(1);
  expect(await readFile(join(f.stateDir, NOTE))).toEqual(note);
  expect(await readStartAgainMarker(f.venueDir)).toBeNull();
  expect(await attemptFiles(f)).toEqual(before);
});

it("the password-required refusal answers 403 over HTTPS", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  await damageRecoveryRecord(f);
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  const refused = await routes(f, actions).request(
    "https://box.test/setup-api/first-setup/resolution/start-again",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspectionId: inspected.inspectionId,
        revision: inspected.revision,
        ownerGeneration: inspected.ownerGeneration,
        register: startRequest.register,
      }),
    },
    tls(),
  );
  expect(refused.status, await refused.clone().text()).toBe(403);
  expect(await refused.json()).toEqual({
    error: { code: "setup.start_again_password_required", params: {} },
  });
  expect(await readStartAgainMarker(f.venueDir)).toBeNull();
});

it("a damaged record with no owner still refuses for a marker over its limit, before asking for the password, and nothing changes", async () => {
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
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(await folderTrees(f)).toEqual(before);
  expect(await readStartAgainMarker(f.venueDir)).toBeNull();
});

it("the Start again route passes recoveryRecordDamagedShown on: with the owner and a damaged record it starts again over HTTPS", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  await damageRecoveryRecord(f);
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  const recovered = await f.host.owner.recoverFirstSetupOwner({
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    password: PASSWORD,
  });
  const current = await f.host.resolution.inspectFirstSetupResolution();
  const accepted = await sendStartAgain(
    routes(f, actions),
    {
      attemptId: recovered.state.attemptId,
      revision: recovered.state.revision,
      ownerGeneration: recovered.state.ownerGeneration,
      capability: recovered.capability,
    },
    {
      inspectionId: current.inspectionId,
      revision: current.revision,
      ownerGeneration: current.ownerGeneration,
      register: startRequest.register,
      recoveryRecordDamagedShown: true,
    },
  );
  expect(accepted.status, await accepted.clone().text()).toBe(200);
  expect(await accepted.json()).toEqual({ restarting: true });
  await expectStartAgainDeleted(f);
});

it("an attempt that never chose a name is summarised as claimed, with no name", async () => {
  const { folders, host } = await claimedWithoutName();
  await rm(join(folders.venueDir, "venue.db"));
  const inspected = await host.resolution.inspectFirstSetupResolution();
  const recovered = await host.owner.recoverFirstSetupOwner({
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    password: PASSWORD,
  });
  const current = await host.resolution.inspectFirstSetupResolution();
  await expect(
    createFirstSetupResolutionActions({ ...folders, host }).startAgainSummary({
      inspectionId: current.inspectionId,
      revision: current.revision!,
      ownerGeneration: current.ownerGeneration!,
      owner: {
        attemptId: recovered.state.attemptId,
        revision: recovered.state.revision,
        ownerGeneration: recovered.state.ownerGeneration,
        capability: recovered.capability,
      },
    }),
  ).resolves.toEqual({ reached: "claimed", lastName: null });
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
  "first-setup.json",
  "module-preparation-state.json",
  "first-fiscal-documents/",
  "first-setup-node-key.json",
  "module-operation-public.json",
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
  const before = await folderTrees(f);
  expect(before.state["first-fiscal-documents/"]).toBeDefined();
  await actions.startAgainFirstSetup(startRequest);
  await expectAttemptGone(f);
  expect(await readStartAgainNote(f.stateDir)).not.toBeNull();
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
    "setup-operation.json",
    "restore-request.json",
    "reset-request.json",
    "modules.json",
    "cloud-replacement.json",
  ].map((name): [string, (f: { stateDir: string; venueDir: string }) => Promise<unknown>] => [
    `state/${name}`,
    (f) => writeFile(join(f.stateDir, name), "X=1\n"),
  ]),
  ["venue/.venue.db-litestream/", (f) => mkdir(join(f.venueDir, ".venue.db-litestream"))],
])(
  "on a missing database, Start again beside %s is refused, and nothing is written",
  async (_name, place) => {
    const { f, name, actions, request } = await missingDatabase();
    await place(f);
    const inspected = await f.host.resolution.inspectFirstSetupResolution();
    const before = await folderTrees(f);
    await expect(
      actions.startAgainFirstSetup({
        ...request,
        inspectionId: inspected.inspectionId,
        confirmMissingDatabase: {
          nothingFiledOrSold: true,
          shown: { reached: "named", lastName: name },
        },
      }),
    ).rejects.toMatchObject({ code: "setup.not_ready" });
    expect(await folderTrees(f)).toEqual(before);
    expect(before.venue[START_AGAIN_MARKER_FILE]).toBeUndefined();
    expect(await readStartAgainNote(f.stateDir)).toBeNull();
  },
);

it("on a missing database, Start again with outside evidence configured is refused, and nothing is written", async () => {
  const { f, name, actions, request } = await missingDatabase();
  const inspect = f.host.resolution.inspectFirstSetupResolution.bind(f.host.resolution);
  vi.spyOn(f.host.resolution, "inspectFirstSetupResolution").mockImplementation(async () => {
    const inspection = await inspect();
    return {
      ...inspection,
      artifacts: [...inspection.artifacts, { name: "outside-evidence-0", status: "missing" }],
    };
  });
  const before = await folderTrees(f);
  await expect(
    actions.startAgainFirstSetup({
      ...request,
      confirmMissingDatabase: {
        nothingFiledOrSold: true,
        shown: { reached: "named", lastName: name },
      },
    }),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
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

it("an attempt whose owner recovered the password twice can start again, and the next start finds nothing left", async () => {
  const { f, actions } = await missingDatabase();
  const again = await f.host.resolution.inspectFirstSetupResolution();
  const recovered = await f.host.owner.recoverFirstSetupOwner({
    inspectionId: again.inspectionId,
    revision: again.revision!,
    ownerGeneration: again.ownerGeneration!,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    password: PASSWORD,
  });
  const steps = await readdir(join(f.stateDir, "first-setup-resolutions"), {
    recursive: true,
  });
  expect(steps.some((entry) => entry.endsWith("step-000003"))).toBe(true);
  const current = await f.host.resolution.inspectFirstSetupResolution();
  const owner = {
    attemptId: recovered.state.attemptId,
    revision: recovered.state.revision,
    ownerGeneration: recovered.state.ownerGeneration,
    capability: recovered.capability,
  };
  const ids = {
    inspectionId: current.inspectionId,
    revision: current.revision!,
    ownerGeneration: current.ownerGeneration!,
  };
  const shown = await actions.startAgainSummary({ ...ids, owner });
  await actions.startAgainFirstSetup({
    ...ids,
    owner,
    confirmMissingDatabase: { nothingFiledOrSold: true, shown },
  });
  await expectAttemptGone(f);
  await finishStartAgainDeletion(f);
  await expectAttemptGone(f);
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

it("Start again leaves the note and the confirmation folder in place", async () => {
  const { f, floorMs, actions, startRequest } = await abandonedAttempt();
  await raiseStartAgainNote(f.stateDir, {
    floorMs: floorMs + 60 * MINUTE_MS,
    lastName: "LATER",
    module: "fiscal-verifactu",
  });
  await mkdir(join(f.stateDir, CONFIRMATIONS));
  await writeFile(join(f.stateDir, CONFIRMATIONS, "1-earlier.json"), "{}");
  const kept = async () => ({
    note: await readFile(join(f.stateDir, "first-setup-start-again.json")),
    confirmations: await tree(join(f.stateDir, CONFIRMATIONS)),
  });
  const before = await kept();
  await actions.startAgainFirstSetup(startRequest);
  await expectAttemptGone(f);
  expect(await kept()).toEqual(before);
});

it("a marker over its limit refuses Start again before anything is written", async () => {
  const { f, name, request } = await missingDatabase();
  const actions = createFirstSetupResolutionActions({ ...f, host: f.host, markerLimit: 1 });
  const before = await folderTrees(f);
  await expect(
    actions.startAgainFirstSetup({
      ...request,
      confirmMissingDatabase: {
        nothingFiledOrSold: true,
        shown: { reached: "named", lastName: name },
      },
    }),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(await folderTrees(f)).toEqual(before);
  expect(before.state[`${CONFIRMATIONS}/`]).toBeUndefined();
  expect(before.venue[START_AGAIN_MARKER_FILE]).toBeUndefined();
  expect(await readStartAgainNote(f.stateDir)).toBeNull();
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

function backupRepair(f: Awaited<ReturnType<typeof abandonedAttempt>>["f"]) {
  const service = createFirstSetupBackupRecovery({
    stateDir: f.stateDir,
    venueDir: f.venueDir,
    host: f.host,
    workspace: createFirstSetupBackupWorkspace({ stateDir: f.stateDir, venueDir: f.venueDir }),
    modules: ALL_MODULES,
    environment: "production",
    sources: {} as never,
    log: () => {},
  });
  const app = new Hono();
  mountFirstSetupBackupApi(app, service, () => {});
  return { service, app };
}
const repairProof = {
  observation: { inspectionId: "inspection", revision: 1, ownerGeneration: 1 },
  nodeRecoverySecret: "node-recovery-secret",
  context: { oldBoxGone: true, soleRecovery: true },
};
const BACKUP = "https://box.test/setup-api/first-setup/resolution/backup";
const incomplete = { code: "setup.start_again_incomplete" };

type Pending = Awaited<ReturnType<typeof pendingDeletion>>;
const restoreStaging = async ({ f }: Pending) => {
  await writeFile(
    join(f.stateDir, "restore-request.json"),
    JSON.stringify({ version: 1, kind: "stream" }),
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
  await rm(join(f.stateDir, "restore-request.json"));
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
  [
    "A731's repair open",
    async ({ f }) => {
      const { service } = backupRepair(f);
      try {
        await expect(
          service.open(
            {
              ...repairProof,
              source: {
                kind: "archive",
                artifact: new Uint8Array([1]),
                recoveryKey: "key",
                environment: "production",
              },
            },
            { onBox: true },
          ),
        ).rejects.toMatchObject(incomplete);
      } finally {
        await service.dispose();
      }
    },
  ],
  [
    "A731's resume",
    async ({ f }) => {
      const { service } = backupRepair(f);
      try {
        await expect(
          service.resume({ ...repairProof, recoveryId: randomUUID() }, { onBox: true }),
        ).rejects.toMatchObject(incomplete);
      } finally {
        await service.dispose();
      }
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

it("A731's repair open while a deletion is pending answers 409", async () => {
  const { f } = await pendingDeletion();
  const { service, app } = backupRepair(f);
  try {
    const form = new FormData();
    form.set(
      "request",
      JSON.stringify({
        ...repairProof,
        source: { kind: "archive", recoveryKey: "key", environment: "production" },
      }),
    );
    form.set("artifact", new Blob([Uint8Array.from([1, 2, 3])]), "backup.wbk");
    const response = await app.request(`${BACKUP}/open`, { method: "POST", body: form }, tls());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "setup.start_again_incomplete", params: {} },
    });
  } finally {
    await service.dispose();
  }
});

it.each([
  ["restore staging", restoreStaging],
  ["the restore command", restoreCommand],
])(
  "once the deletion has removed the claim file, %s is still refused and the remaining files are unchanged",
  async (_name, act) => {
    const pending = await pendingDeletion();
    await rm(join(pending.f.venueDir, "first-setup-claim.json"));
    const before = await folderTrees(pending.f);
    await act(pending);
    expect(await folderTrees(pending.f)).toEqual(before);
  },
);

const NOTE = "first-setup-start-again.json";
const KEPT_ATTEMPT = "11111111-1111-4111-8111-111111111111";

/** A note far above any name these cases choose, and one earlier confirmation record. */
async function seedKept(stateDir: string) {
  await raiseStartAgainNote(stateDir, {
    floorMs: Date.parse("2026-12-01T00:00:00Z"),
    lastName: "LATER",
    module: "fiscal-verifactu",
  });
  const record = await writeStartAgainConfirmation(stateDir, {
    at: "2026-10-01T00:00:00.000Z",
    attemptId: KEPT_ATTEMPT,
    database: "missing",
    administrator: { displayName: "Elena", email: "elena@example.test" },
    ownerGeneration: 1,
    shown: { reached: "named", lastName: "0CNQT" },
  });
  const paths = [join(stateDir, NOTE), join(stateDir, CONFIRMATIONS, record)];
  const bytes = () => Promise.all(paths.map((path) => readFile(path)));
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

it("lifetime: Start again with the database present leaves the note and the confirmation record unchanged", async () => {
  const { f, actions, startRequest } = await abandonedAttempt();
  const kept = await seedKept(f.stateDir);
  await actions.startAgainFirstSetup(startRequest);
  await expectAttemptGone(f);
  expect(await kept.bytes()).toEqual(kept.before);
});

it("lifetime: a confirmed Start again on a missing database whose attempt chose no name does not rewrite the note", async () => {
  const { folders, host } = await claimedWithoutName();
  const kept = await seedKept(folders.stateDir);
  await rm(join(folders.venueDir, "venue.db"));
  const inspected = await host.resolution.inspectFirstSetupResolution();
  const recovered = await host.owner.recoverFirstSetupOwner({
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    password: PASSWORD,
  });
  const current = await host.resolution.inspectFirstSetupResolution();
  const ids = {
    inspectionId: current.inspectionId,
    revision: current.revision!,
    ownerGeneration: current.ownerGeneration!,
  };
  const owner = {
    attemptId: recovered.state.attemptId,
    revision: recovered.state.revision,
    ownerGeneration: recovered.state.ownerGeneration,
    capability: recovered.capability,
  };
  const actions = createFirstSetupResolutionActions({ ...folders, host });
  const shown = await actions.startAgainSummary({ ...ids, owner });
  expect(shown).toEqual({ reached: "claimed", lastName: null });
  vi.mocked(raiseStartAgainNote).mockClear();
  await actions.startAgainFirstSetup({
    ...ids,
    owner,
    confirmMissingDatabase: { nothingFiledOrSold: true, shown },
  });
  expect(vi.mocked(raiseStartAgainNote)).not.toHaveBeenCalled();
  expect(await readdir(join(folders.stateDir, CONFIRMATIONS))).toHaveLength(2);
  expect(await kept.bytes()).toEqual(kept.before);
});

it("lifetime: a start that finishes an interrupted deletion leaves the note and the confirmation record unchanged", async () => {
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
    "discarded",
    async () => {
      throw new Error("refused placement");
    },
    false,
  ],
] as const)(
  "lifetime: a staged restore %s, with placement stubbed, leaves the note and the confirmation record unchanged",
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
    await expect(access(join(folders.stateDir, "restore-request.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await kept.bytes()).toEqual(kept.before);
  },
);

it("lifetime: the in-app reset leaves the note and the confirmation record unchanged", async () => {
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

it("lifetime: a restart of the repair listener leaves the note and the confirmation record unchanged", async () => {
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

it("lifetime: a later name raises the note, and the old note is whole until the rename", async () => {
  const { f } = await abandonedAttempt();
  const kept = await seedKept(f.stateDir);
  const [oldNote] = kept.before;
  const seenAtRename: (Buffer | null)[] = [];
  const io = {
    ...fsPromises,
    rename: async (from: string, to: string) => {
      seenAtRename.push(await readFile(join(f.stateDir, NOTE)).catch(() => null));
      await fsPromises.rename(from, to);
    },
  };
  const later = Date.parse("2026-12-02T00:00:00Z");
  await raiseStartAgainNote(
    f.stateDir,
    { floorMs: later, lastName: "LATEST", module: "fiscal-verifactu" },
    io,
  );
  expect(seenAtRename).toEqual([oldNote]);
  const [note, confirmation] = await kept.bytes();
  expect(note).not.toEqual(oldNote);
  expect(confirmation).toEqual(kept.before[1]);
  expect(await readStartAgainNote(f.stateDir)).toEqual({
    version: 1,
    floorMs: later,
    lastName: "LATEST",
    module: "fiscal-verifactu",
  });
});
