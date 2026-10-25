import { randomBytes } from "node:crypto";
import { access, mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ALL_MODULES } from "@waitron/composition";
import {
  raiseStartAgainNote,
  readModulePreparationHistory,
  readStartAgainNote,
  type FirstSetupChange,
} from "@waitron/provisioning";
import {
  EPOCH_MS,
  MINUTE_MS,
  decodeMinuteIdentity,
} from "@waitron/fiscal-verifactu/src/hour-identity.js";
import { publicHourSelectionHistory } from "@waitron/fiscal-verifactu/src/hour-selection.js";
import { hourFirstFiscalFixture } from "../test/hour-first-fiscal.js";
import { PASSWORD, request } from "../test/first-fiscal.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";
import { firstSetupModuleContext } from "./first-fiscal-evidence.js";
import { createFakeTimersHourClock, selectPastWaits } from "./testing/hour-test-clock.js";
import { mountFirstSetupResolutionApi } from "./setup-first-fiscal-api.js";

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
  const binding = await actions.startAgainFirstSetup(startRequest);
  const next = createFirstSetupModuleHost({
    ...binding,
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
  return { f, clock, name, floorMs, binding, next, owner };
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
  const { f, name, floorMs, binding, next, owner } = await startedAgain();
  expect(await readStartAgainNote(binding.anchorStateDir)).toEqual({
    version: 1,
    floorMs,
    lastName: name,
    module: "fiscal-verifactu",
  });
  await expect(
    access(join(binding.anchorStateDir, "module-preparation-state.json")),
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
  const history = await readModulePreparationHistory(binding, f.module);
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
  const binding = await createFirstSetupResolutionActions({
    ...folders,
    host,
  }).startAgainFirstSetup(startRequest);
  expect(await readStartAgainNote(binding.anchorStateDir)).toBeNull();
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
  expect(refusal?.reason).toMatchObject({ code: "setup.attempt_uncertain" });
  expect(vi.mocked(raiseStartAgainNote)).toHaveBeenCalledTimes(1);
  expect(await readStartAgainNote(f.stateDir)).toEqual({
    version: 1,
    floorMs,
    lastName: name,
    module: "fiscal-verifactu",
  });
});

const CONFIRMATIONS = "first-setup-start-again-confirmations";

async function missingDatabase(changes: readonly FirstSetupChange[] = []) {
  const base = await abandonedAttempt();
  const { f } = base;
  let state = (await f.store.read())!;
  for (const change of changes)
    state = await f.store.update(state.frozen.attemptId, state.revision, change);
  await rm(join(f.venueDir, "venue.db"));
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  const recovered = await f.host.owner.recoverFirstSetupOwner({
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    password: PASSWORD,
  });
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
  const binding = await actions.startAgainFirstSetup({
    ...request,
    confirmMissingDatabase: { nothingFiledOrSold: true, shown },
  });
  expect(await readStartAgainNote(binding.anchorStateDir)).toMatchObject({ lastName: name });
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

it("the confirmation record is on disk before the kept picks file is deleted", async () => {
  const { f, name, request } = await missingDatabase();
  const actions = createFirstSetupResolutionActions({
    ...f,
    host: f.host,
    remove: async () => {
      throw new Error("removal refused");
    },
  });
  await expect(
    actions.startAgainFirstSetup({
      ...request,
      confirmMissingDatabase: {
        nothingFiledOrSold: true,
        shown: { reached: "named", lastName: name },
      },
    }),
  ).rejects.toThrow("removal refused");
  expect(await readdir(join(f.stateDir, CONFIRMATIONS))).toHaveLength(1);
  await expect(access(join(f.stateDir, "module-preparation-state.json"))).resolves.toBeUndefined();
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
