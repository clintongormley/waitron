import { createHash, randomBytes } from "node:crypto";
import {
  access,
  lstat,
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
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { openVenueDatabase } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ALL_MODULES } from "@waitron/composition";
import {
  START_AGAIN_MARKER_FILE,
  finishStartAgainDeletion,
  raiseStartAgainNote,
  readModulePreparationHistory,
  readStartAgainMarker,
  readStartAgainNote,
  startAgainMarkerFor,
  writeStartAgainMarker,
  firstSetupFrozenDigest,
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
import {
  mountFirstSetupResolutionApi,
  mountSetupFirstFiscalApi,
} from "./setup-first-fiscal-api.js";
import { createLogger } from "./logger.js";

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
  expect(await folderTrees(f)).toEqual(before);
});

it("a repair-page inspection read between deletions, then a cut, still lets the next start finish", async () => {
  const { f, startRequest } = await abandonedAttempt();
  const routed: { app?: Hono } = {};
  const reads: number[] = [];
  const actions = createFirstSetupResolutionActions({
    ...f,
    host: f.host,
    remove: cutAt(5, async (call) => {
      if (call !== 2 && call !== 4) return;
      const read = await routed.app!.request("https://box.test/setup-api/first-setup/resolution");
      reads.push(read.status);
    }),
  });
  routed.app = routes(f, actions);
  await expect(actions.startAgainFirstSetup(startRequest)).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
  });
  expect(reads).toEqual([200, 200]);
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
