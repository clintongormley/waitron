import { randomBytes } from "node:crypto";
import { access, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ALL_MODULES } from "@waitron/composition";
import {
  raiseStartAgainNote,
  readModulePreparationHistory,
  readStartAgainNote,
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
afterEach(async () => {
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
