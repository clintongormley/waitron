import { randomBytes, randomUUID } from "node:crypto";
import { lstat, mkdtemp, readFile, writeFile, unlink, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { initialSetupFor, withOperationAuthority } from "@waitron/module";
import { readStartAgainMarker, type FirstSetupState } from "@waitron/provisioning";
import {
  decodeMinuteIdentity,
  encodeMinuteIdentity,
} from "@waitron/fiscal-verifactu/src/hour-identity.js";
import { hourSetupInput } from "@waitron/fiscal-verifactu/src/hour-preparation.js";
import { request, PASSWORD, MODULE } from "../test/first-fiscal.js";
import { keepHourRecoveryDocument } from "../test/hour-recovery-delivery.js";
import { expectStartAgainDeleted } from "../test/start-again-deleted.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { firstSetupModuleContext } from "./first-fiscal-evidence.js";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";
import { createFirstSetupResolutionInspection } from "./first-setup-resolution-inspection.js";
import {
  createFakeTimersHourClock,
  selectPastWaits,
  type HourTestClock,
} from "./testing/hour-test-clock.js";
import { ALL_MODULES } from "@waitron/composition";

const outside = vi.hoisted(() => ({ internet: vi.fn(), release: vi.fn() }));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: outside.internet,
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: outside.release,
}));
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const roots: string[] = [];
const modules = ALL_MODULES.filter((m) => ["core", MODULE, "fiscal-none"].includes(m.name));
const first = Date.parse("2026-10-16T11:40:00.000Z");
const instant = (index: number) => first + (index - 1) * 3_600_000;
let clock: HourTestClock;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(first);
  clock = createFakeTimersHourClock();
  outside.release.mockReturnValue({ instantMs: first - 86_400_000 });
  outside.internet.mockImplementation(async () => ({
    source: "internet",
    result: "usable",
    instantMs: clock.wall(),
    uncertaintyMs: 500,
    wallStartedMs: clock.wall(),
    wallFinishedMs: clock.wall(),
    monotonicStartedMs: clock.monotonic(),
    monotonicFinishedMs: clock.monotonic(),
  }));
});
afterEach(async () => {
  vi.useRealTimers();
  outside.internet.mockReset();
  outside.release.mockReset();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
type Host = ReturnType<typeof createFirstSetupModuleHost>;
function ownerFor(state: FirstSetupState, capability: string) {
  return {
    attemptId: state.frozen.attemptId,
    revision: state.revision,
    ownerGeneration: state.ownerGeneration,
    capability,
  };
}
async function compare(host: Host, state: FirstSetupState, capability: string) {
  const owner = ownerFor(state, capability);
  const challenge = (await host.preparation.prepare(
    owner,
    MODULE,
    {
      action: "clock-challenge",
    },
    { onBox: true },
  )) as { id: string };
  const compared = (await host.preparation.prepare(
    owner,
    MODULE,
    {
      action: "compare-clocks",
      browser: { challengeId: challenge.id, instantMs: clock.wall() },
    },
    { onBox: true },
  )) as { id: string };
  return compared.id;
}
function choose(host: Host, state: FirstSetupState, capability: string) {
  const owner = ownerFor(state, capability);
  return selectPastWaits(clock, async () => {
    const comparisonId = await compare(host, state, capability);
    return host.preparation.select(
      owner,
      MODULE,
      { comparisonId },
      await host.owner.reconfirm(owner, PASSWORD, "block-use"),
    );
  });
}
function selectedRequest(state: FirstSetupState, index: number) {
  const context = firstSetupModuleContext(state, MODULE);
  const identity = encodeMinuteIdentity(instant(index));
  return {
    kind: "waitron-hour-setup",
    status: "selected",
    identity,
    input: hourSetupInput(
      {
        binding: context.binding,
        scope: { taxpayerNif: context.taxId, environment: context.environment },
        bases: [...context.bases].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)),
        identity,
        issuedAt: new Date(instant(index)).toISOString(),
      },
      context.administratorId,
    ),
  };
}
function retainedHour(index = 42, softwareId = "W1", laterMs = 0) {
  return {
    format: "waitron-hour-history",
    scope: { taxpayerNif: request.taxId, environment: "production" },
    sources: [
      {
        reference: "retained-venue",
        complete: true,
        records: [
          {
            reference: "retained-venue/retired-hour",
            kind: "retirement",
            taxpayerNif: request.taxId,
            environment: "production",
            softwareId,
            nodeId: "retired-peer",
            identity: encodeMinuteIdentity(instant(index) + laterMs),
            recordedAtMs: instant(index) + laterMs,
          },
        ],
      },
    ],
  };
}
async function startAgainMissingDatabase(
  host: Host,
  folders: { stateDir: string; venueDir: string },
  resolution: Host["resolution"] = host.resolution,
) {
  const inspected = await host.resolution.inspectFirstSetupResolution();
  await host.owner.recoverFirstSetupOwner({
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    password: PASSWORD,
  });
  const current = await resolution.inspectFirstSetupResolution();
  const ids = {
    inspectionId: current.inspectionId,
    revision: current.revision!,
    ownerGeneration: current.ownerGeneration!,
  };
  const actions = createFirstSetupResolutionActions({ ...folders, host: { ...host, resolution } });
  const shown = await actions.startAgainSummary(ids);
  await actions.startAgainFirstSetup({
    ...ids,
    confirmMissingDatabase: { nothingFiledOrSold: true, shown },
  });
  return shown;
}
async function fixture(
  index = 1,
  taxId = request.taxId,
  environment: "production" | "preproduction" = "production",
  freezeCandidates = true,
  retiredIndex = 1,
  retained?: {
    history?: unknown;
    previousIndex?: number;
    document?: boolean;
    damage?: "missing-original" | "syntax" | "binding" | "digest";
    source?: "local" | "outside";
    outsideChange?: "replace" | "remove";
  },
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "retired-hour-assignments-")));
  roots.push(root);
  const anchor = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  const outsidePath = join(root, "outside-history.json");
  const oldHost = createFirstSetupModuleHost({
    ...anchor,
    modules,
    environment: {},
    database: () => suite.db,
  });
  let oldClaim = await oldHost.owner.claimFirstSetup(
    { environment: "production", request },
    randomBytes(32).toString("base64url"),
  );
  let old = (await oldHost.store.read())!;
  for (const hour of retained?.previousIndex === undefined
    ? [retiredIndex]
    : [retained.previousIndex, retiredIndex]) {
    vi.setSystemTime(instant(hour));
    if (hour !== retiredIndex) {
      const owner = ownerFor(old, oldClaim.capability);
      const grant = await oldHost.owner.reconfirm(owner, PASSWORD, "block-use");
      const context = firstSetupModuleContext(old, MODULE);
      const seat = initialSetupFor(oldHost.modules, MODULE)!;
      await oldHost.owner.consumeReconfirmation(owner, grant, "block-use");
      const candidates = await selectPastWaits(clock, async () => {
        const comparisonId = await compare(oldHost, old, oldClaim.capability);
        const authorize = async () => {
          await oldHost.owner.authorize(owner);
        };
        return oldHost.withPreparationAuthorization(
          { intent: authorize, wait: authorize },
          async () => seat.candidates(context, { comparisonId }),
        );
      });
      old = await oldHost.store.update(old.frozen.attemptId, old.revision, {
        kind: "candidates",
        module: MODULE,
        request: seat.request(context, candidates),
      });
      await oldHost.store.update(old.frozen.attemptId, old.revision, { kind: "abandoned" });
      oldClaim = await oldHost.owner.claimFirstSetup(
        { environment: "production", request },
        randomBytes(32).toString("base64url"),
      );
      old = (await oldHost.store.read())!;
    } else old = (await choose(oldHost, old, oldClaim.capability)).state;
  }
  const oldOwner = ownerFor(old, oldClaim.capability);
  const input = (old.frozen.modules.find((m) => m.module === MODULE)!.request as { input: unknown })
    .input;
  old = await oldHost.preparation.import(oldOwner, MODULE, input);
  if (retained?.document) {
    await keepHourRecoveryDocument(oldHost, ownerFor(old, oldClaim.capability), PASSWORD);
    const path = join(anchor.stateDir, "first-fiscal-documents", `${MODULE}.recovery.json`);
    if (retained.damage === "missing-original") await unlink(path);
    if (retained.damage === "syntax") await writeFile(path, "{damaged recovery document");
    if (retained.damage === "binding" || retained.damage === "digest") {
      const manifest = JSON.parse(await readFile(path, "utf8"));
      if (retained.damage === "binding") manifest.attemptId = randomUUID();
      else manifest.statement.createdAt = "2025-10-16T11:40:00.000Z";
      await writeFile(path, JSON.stringify(manifest));
    }
  }
  const publicPath =
    retained?.source === "outside"
      ? outsidePath
      : join(anchor.stateDir, "module-operation-public.json");
  if (retained?.history !== undefined) {
    await writeFile(
      publicPath,
      JSON.stringify(
        retained.source === "outside"
          ? retained.history
          : {
              version: 1,
              modules: {},
              history: [
                {
                  attemptId: old.frozen.attemptId,
                  revision: old.revision,
                  ownerGeneration: old.ownerGeneration,
                  module: MODULE,
                  current: retained.history,
                },
              ],
            },
      ),
    );
  }
  if (retained?.outsideChange === "replace")
    await writeFile(publicPath, JSON.stringify(retainedHour(1)));
  if (retained?.outsideChange === "remove") await unlink(publicPath);
  // The hour module configures no outside evidence, so the outside rows name the file directly.
  const shown = await startAgainMissingDatabase(
    oldHost,
    anchor,
    retained?.source === "outside"
      ? createFirstSetupResolutionInspection({
          ...anchor,
          store: oldHost.store,
          expectedMigrationSets: modules.map((module) => module.migrations.name),
          publicEvidencePaths: [outsidePath],
        })
      : oldHost.resolution,
  );
  const host = createFirstSetupModuleHost({
    ...anchor,
    modules,
    environment: {},
    database: () => suite.db,
  });
  const claim = await host.owner.claimFirstSetup(
    { environment, request: { ...request, taxId } },
    randomBytes(32).toString("base64url"),
  );
  let state = (await host.store.read())!;
  if (freezeCandidates)
    state = await host.store.update(state.frozen.attemptId, state.revision, {
      kind: "candidates",
      module: MODULE,
      request: selectedRequest(state, index),
    });
  vi.setSystemTime(instant(index));
  return {
    root,
    host,
    state,
    old,
    claim,
    publicPath,
    module: MODULE,
    password: PASSWORD,
    shown,
  };
}
/** A fixture whose Start again is refused: the abandoned attempt stays, and no marker is written. */
async function expectStartAgainRefused(made: Promise<unknown>, code: string) {
  await expect(made).rejects.toMatchObject({ code });
  const root = roots.at(-1)!;
  const anchor = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  await expect(lstat(join(anchor.stateDir, "first-setup.json"))).resolves.toBeDefined();
  expect(await readStartAgainMarker(anchor.venueDir)).toBeNull();
}

it("password recovery starts an unused named replacement again in the same folders", async () => {
  const f = await fixture(2, request.taxId, "production", false);
  const named = (await choose(f.host, f.state, f.claim.capability)).state;
  await suite.db.archiveTo(join(f.state.venueDir, "venue.db"));
  const initial = await f.host.resolution.inspectFirstSetupResolution();
  expect(initial.emptyDatabase).toBe(true);
  const recovered = await f.host.owner.recoverFirstSetupOwner({
    inspectionId: initial.inspectionId,
    revision: named.revision,
    ownerGeneration: named.ownerGeneration,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    password: PASSWORD,
  });
  const inspection = await f.host.resolution.inspectFirstSetupResolution();
  const actions = createFirstSetupResolutionActions({
    stateDir: f.state.stateDir,
    venueDir: f.state.venueDir,
    host: f.host,
  });
  await expect(
    actions.startAgainFirstSetup({
      inspectionId: inspection.inspectionId,
      revision: recovered.state.revision,
      ownerGeneration: recovered.state.ownerGeneration,
    }),
  ).resolves.toBeUndefined();
  expect({ stateDir: f.state.stateDir, venueDir: f.state.venueDir }).toEqual({
    stateDir: f.old.stateDir,
    venueDir: f.old.venueDir,
  });
  await expectStartAgainDeleted(f.state);
});
it.each(["syntax", "binding", "digest"] as const)(
  "a damaged recovery document %s is treated as missing, and the summary says so",
  async (damage) => {
    const f = await fixture(43, request.taxId, "production", false, 42, { document: true, damage });
    expect(f.shown).toEqual({ reached: "named", recoveryRecordDamaged: true });
  },
);
it.each([{ document: true }, { document: true, damage: "missing-original" as const }])(
  "a kept recovery document that is valid or missing is not reported as damaged %#",
  async (retained) => {
    const f = await fixture(43, request.taxId, "production", false, 42, retained);
    expect("recoveryRecordDamaged" in f.shown).toBe(false);
  },
);
it("Start again is refused while an outside hour-history file is configured", async () => {
  await expectStartAgainRefused(
    fixture(43, request.taxId, "production", false, 1, {
      history: retainedHour(),
      source: "outside",
    }),
    "setup.not_ready",
  );
});
it("ordinary hour preparation retains earlier abandoned events for later", async () => {
  const f = await fixture(44, request.taxId, "production", false, 43, {
    previousIndex: 42,
  });
  const previous = f.old.previous[0]!;
  expect(
    (previous.frozen.modules.find((m) => m.module === MODULE)!.request as { identity: string })
      .identity,
  ).toBe("0CR2T");
  const result = await choose(f.host, f.state, f.claim.capability);
  expect(result.state.consumptionIntent).toBe(true);
  const selected = result.state.frozen.modules.find((m) => m.module === MODULE)!.request as {
    identity: string;
    input: unknown;
  };
  expect(selected.identity).toBe("0CR6J");
  const path = join(f.state.stateDir, "module-preparation-state.json");
  const journal = await readFile(path);
  const restart = createFirstSetupModuleHost({
    stateDir: f.state.stateDir,
    venueDir: f.state.venueDir,
    modules,
    environment: {},
    database: () => suite.db,
  });
  vi.setSystemTime(instant(45));
  await compare(restart, result.state, f.claim.capability);
  const context = firstSetupModuleContext(result.state, MODULE);
  const operations = restart.modules.find((m) => m.name === MODULE)!.operations!;
  const preview = await restart.preparation.prepare(
    ownerFor(result.state, f.claim.capability),
    MODULE,
    { action: "selection" },
    { onBox: true },
  );
  expect(preview).toMatchObject({
    status: "selected",
    identity: "0CR6J",
    issuedAt: "2026-10-18T06:42:00.001Z",
  });
  const input = selected.input as ReturnType<typeof hourSetupInput>;
  const previousRequest = previous.frozen.modules.find((m) => m.module === MODULE)!.request as {
    input: ReturnType<typeof hourSetupInput>;
  };
  await expect(
    withOperationAuthority(context.binding, context.administratorId, (authority) =>
      operations.prepare(
        {
          binding: context.binding,
          authority,
          input: {
            ...input,
            allocation: {
              ...input.allocation,
              allocationId: previousRequest.input.allocation.allocationId,
            },
          },
        },
        async () => "old event must be refused",
      ),
    ),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "event_mismatch" },
  });
  const replay = await withOperationAuthority(
    context.binding,
    context.administratorId,
    (authority) =>
      operations.prepare(
        { binding: context.binding, authority, input: selected.input },
        async (prepared) => prepared.binding,
      ),
  );
  expect(replay).toEqual(context.binding);
  expect(await restart.store.read()).toEqual(result.state);
  expect(await readFile(path)).toEqual(journal);
});
it("an attempt after an abandoned one may take a minute earlier than the abandoned attempt's name", async () => {
  const f = await fixture(44, request.taxId, "production", false, 43, { previousIndex: 50 });
  const identity = (state: Pick<FirstSetupState, "frozen">) =>
    (state.frozen.modules.find((m) => m.module === MODULE)!.request as { identity: string })
      .identity;
  expect(f.old.previous.map(identity)).toEqual(["0CRHT"]);
  expect(decodeMinuteIdentity(identity(f.old))).toBeLessThan(decodeMinuteIdentity("0CRHT"));
  const result = await choose(f.host, f.state, f.claim.capability);
  expect(result.state.consumptionIntent).toBe(true);
  expect(
    (result.state.frozen.modules.find((m) => m.module === MODULE)!.request as { identity: string })
      .identity,
  ).toBe("0CR6J");
});
it("an abandoned attempt that chose the same minute still refuses the new one", async () => {
  const f = await fixture(44, request.taxId, "production", false, 43);
  const { state } = await choose(f.host, f.state, f.claim.capability);
  await expect(f.host.assertFreshAssignment(state, MODULE)).resolves.toBeUndefined();
  await expect(
    f.host.assertFreshAssignment({ ...state, previous: [...state.previous, state] }, MODULE),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
});
it.each(["replace", "remove"] as const)(
  "Start again stays refused when a configured outside history is changed by %s",
  async (outsideChange) => {
    await expectStartAgainRefused(
      fixture(43, request.taxId, "production", false, 1, {
        history: retainedHour(),
        source: "outside",
        outsideChange,
      }),
      "setup.not_ready",
    );
  },
);
