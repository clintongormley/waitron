import { randomBytes, randomUUID } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readdir,
  readFile,
  writeFile,
  unlink,
  rm,
  realpath,
  utimes,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { initialSetupFor, withOperationAuthority } from "@waitron/module";
import {
  readStartAgainMarker,
  readStartAgainNote,
  type FirstSetupState,
} from "@waitron/provisioning";
import {
  decodeMinuteIdentity,
  encodeMinuteIdentity,
} from "@waitron/fiscal-verifactu/src/hour-identity.js";
import { hourSetupInput } from "@waitron/fiscal-verifactu/src/hour-preparation.js";
import { request, PASSWORD, MODULE } from "../test/first-fiscal.js";
import { keepHourRecoveryDocument } from "../test/hour-recovery-delivery.js";
import { expectStartAgainDeleted, startAgainNoteName } from "../test/start-again-deleted.js";
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
  stamp?: () => Promise<void>,
) {
  const inspected = await host.resolution.inspectFirstSetupResolution();
  const recovered = await host.owner.recoverFirstSetupOwner({
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    password: PASSWORD,
  });
  await stamp?.();
  const current = await resolution.inspectFirstSetupResolution();
  const ids = {
    inspectionId: current.inspectionId,
    revision: current.revision!,
    ownerGeneration: current.ownerGeneration!,
    owner: { ...recovered.state, capability: recovered.capability },
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
    legacy?: unknown;
    previousIndex?: number;
    document?: boolean;
    damage?: "missing-original" | "syntax" | "binding" | "digest";
    stray?: boolean;
    source?: "local" | "outside";
    outsideChange?: "replace" | "remove";
    /** Every file and folder of the attempt is stamped with this time after the password step. */
    stampAtMs?: number;
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
    if (retained.stray)
      await writeFile(join(anchor.stateDir, "first-fiscal-documents", "stray.json"), "{}");
  }
  const publicPath =
    retained?.source === "outside"
      ? outsidePath
      : join(anchor.stateDir, "module-operation-public.json");
  const hasPublic = retained?.history !== undefined || Object.hasOwn(retained ?? {}, "legacy");
  if (hasPublic) {
    await writeFile(
      publicPath,
      JSON.stringify(
        Object.hasOwn(retained ?? {}, "legacy")
          ? retained!.legacy
          : retained?.source === "outside"
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
                    current: retained!.history,
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
    retained?.stampAtMs === undefined
      ? undefined
      : async () => {
          const at = new Date(retained.stampAtMs!);
          await stampTree(anchor.stateDir, at);
          await stampTree(anchor.venueDir, at);
        },
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
async function stampTree(path: string, at: Date) {
  const found = await lstat(path).catch(() => null);
  if (found === null) return;
  if (found.isDirectory())
    for (const entry of await readdir(path)) await stampTree(join(path, entry), at);
  await utimes(path, at, at);
}
/** Two hours after the retired name, so the time floor is later than the name's own floor. */
const STAMP_AT_MS = instant(1) + 2 * 3_600_000;
/** The first minute after the newest file time plus the chooser's 150-second wait bound. */
const TIME_FLOOR_MS = (Math.floor((STAMP_AT_MS + 150_000) / 60_000) + 1) * 60_000;
async function expectTimeFloorNote(f: Awaited<ReturnType<typeof fixture>>) {
  expect(TIME_FLOOR_MS).toBeGreaterThan(instant(1) + 60_000);
  expect(await readStartAgainNote(join(f.root, "state"))).toEqual({
    version: 1,
    floorMs: TIME_FLOOR_MS,
    lastName: null,
    module: MODULE,
  });
}
/** A fixture whose Start again is refused: the abandoned attempt stays, and no note or marker is written. */
async function expectStartAgainRefused(made: Promise<unknown>, code: string) {
  await expect(made).rejects.toMatchObject({ code });
  const root = roots.at(-1)!;
  const anchor = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  await expect(lstat(join(anchor.stateDir, "first-setup.json"))).resolves.toBeDefined();
  expect(await readStartAgainNote(anchor.stateDir)).toBeNull();
  expect(await readStartAgainMarker(anchor.venueDir)).toBeNull();
}
async function expectNoteBounds(
  f: Awaited<ReturnType<typeof fixture>>,
  noteName: string,
  refused: boolean,
) {
  expect(await startAgainNoteName(f.state)).toBe(noteName);
  const selection = choose(f.host, f.state, f.claim.capability);
  if (refused)
    await expect(selection).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "minute_not_later" },
    });
  else {
    const chosen = (await selection).state;
    expect(chosen.consumptionIntent).toBe(true);
    const name = (firstSetupModuleContext(chosen, MODULE).request as { identity: string }).identity;
    expect(decodeMinuteIdentity(name)).toBeGreaterThan(decodeMinuteIdentity(noteName));
  }
}

it("fresh events cannot reuse a retired hour with another allocation ID", async () => {
  const f = await fixture(1, request.taxId, "production", false);
  expect(f.state.frozen.attemptId).not.toBe(f.old.frozen.attemptId);
  const current = firstSetupModuleContext(f.state, MODULE),
    prior = firstSetupModuleContext(f.old, MODULE);
  expect(current.binding.eventId).not.toBe(prior.binding.eventId);
  await expect(choose(f.host, f.state, f.claim.capability)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "minute_not_later" },
  });
});
it.each(["later-hour", "other-taxpayer", "other-environment"])(
  "after Start again the note refuses the abandoned hour under another taxpayer or environment, and permits a later hour: %s",
  async (which) => {
    const f = await fixture(
      which === "later-hour" ? 2 : 1,
      which === "other-taxpayer" ? "89890001K" : request.taxId,
      which === "other-environment" ? "preproduction" : "production",
      false,
    );
    const selection = choose(f.host, f.state, f.claim.capability);
    if (which === "later-hour") expect((await selection).state.consumptionIntent).toBe(true);
    else
      await expect(selection).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "minute_not_later" },
      });
    expect(f.state.inputs).toEqual({});
  },
);
it.each([1, 2])(
  "the real hour candidate route protects a retired hour before freezing hour offset %s",
  async (index) => {
    const f = await fixture(index, request.taxId, "production", false);
    const { Hono } = await import("hono"),
      { mountSetup } = await import("./setup-api.js");
    const app = new Hono();
    mountSetup(app, { environment: "production", firstFiscal: f.host }, () => {});
    const owner = ownerFor(f.state, f.claim.capability);
    const response = await selectPastWaits(clock, async () => {
      const comparisonId = await compare(f.host, f.state, f.claim.capability);
      const sent = await app.request("/setup-api/first-setup/candidates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Waitron-Setup-Owner": owner.capability,
          "X-Waitron-Setup-Attempt": owner.attemptId,
          "X-Waitron-Setup-Revision": String(owner.revision),
          "X-Waitron-Setup-Generation": String(owner.ownerGeneration),
        },
        body: JSON.stringify({
          module: MODULE,
          proposal: { comparisonId },
          reconfirmation: await f.host.owner.reconfirm(owner, PASSWORD, "block-use"),
        }),
      });
      const body = (await sent.json()) as { preparation?: unknown };
      return { code: sent.status, body, preparation: body.preparation };
    });
    expect(response.code).toBe(index === 1 ? 400 : 200);
    if (index === 1) {
      expect(response.body).toEqual({
        error: {
          code: "sif.allocation_invalid",
          params: { reason: "minute_not_later", allowedFromMs: instant(1) + 180_000 },
        },
      });
      expect(await f.host.store.read()).toEqual(f.state);
    } else {
      const current = (await f.host.store.read())!;
      expect(current.consumptionIntent).toBe(true);
      expect(
        (current.frozen.modules.find((m) => m.module === MODULE)!.request as { identity: string })
          .identity,
      ).toBe("0CNQT");
    }
  },
);
it.each([1, 41, 42, 43])("a retired hour at offset42 bounds fresh offset%s", async (index) => {
  const f = await fixture(index, request.taxId, "production", false, 42);
  const selection = choose(f.host, f.state, f.claim.capability);
  if (index <= 42)
    await expect(selection).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "minute_not_later" },
    });
  else expect((await selection).state.consumptionIntent).toBe(true);
});
it("Start again of an empty replacement keeps the inherited floor in the note", async () => {
  const f = await fixture(2, request.taxId, "production", false);
  await suite.db.archiveTo(join(f.state.venueDir, "venue.db"));
  const inspection = await f.host.resolution.inspectFirstSetupResolution();
  expect(inspection.database).toBe("no-venue-rows");
  const { createFirstSetupResolutionActions } = await import("./first-setup-resolution.js");
  const actions = createFirstSetupResolutionActions({
    stateDir: f.state.stateDir,
    venueDir: f.state.venueDir,
    host: f.host,
  });
  await expect(
    actions.startAgainFirstSetup({
      inspectionId: inspection.inspectionId,
      revision: f.state.revision,
      ownerGeneration: f.state.ownerGeneration,
      register: { kind: "no-current-master", confirmed: true },
    }),
  ).resolves.toBeUndefined();
  await expectStartAgainDeleted(f.state);
  expect(await startAgainNoteName(f.state)).toBe(
    (firstSetupModuleContext(f.old, MODULE).request as { identity: string }).identity,
  );
});
it("password recovery starts an unused named replacement again in the same folders, and the note holds the later of the two names", async () => {
  const f = await fixture(2, request.taxId, "production", false);
  const earlier = (await readStartAgainNote(f.state.stateDir))!.lastName!;
  const named = (await choose(f.host, f.state, f.claim.capability)).state;
  const later = (firstSetupModuleContext(named, MODULE).request as { identity: string }).identity;
  expect(decodeMinuteIdentity(later)).toBeGreaterThan(decodeMinuteIdentity(earlier));
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
      owner: { ...recovered.state, capability: recovered.capability },
    }),
  ).resolves.toBeUndefined();
  expect({ stateDir: f.state.stateDir, venueDir: f.state.venueDir }).toEqual({
    stateDir: f.old.stateDir,
    venueDir: f.old.venueDir,
  });
  await expectStartAgainDeleted(f.state);
  expect(await startAgainNoteName(f.state)).toBe(later);
});
it.each([2, 41, 42, 43])(
  "the attempt's own public hour42 goes into the note and bounds offset%s, not its saved hour1",
  async (index) => {
    const f = await fixture(index, request.taxId, "production", false, 1, {
      history: retainedHour(),
    });
    await expectNoteBounds(f, encodeMinuteIdentity(instant(42)), index < 42);
  },
);
it("a public record naming the hour the chooser picks at offset42 refuses that same name", async () => {
  const f = await fixture(42, request.taxId, "production", false, 1, {
    history: retainedHour(42, "W1", 120_000),
  });
  await expectNoteBounds(f, "0CR2T", true);
});
it("a public hour under another software ID still goes into the note", async () => {
  const f = await fixture(2, request.taxId, "production", false, 1, {
    history: retainedHour(42, "OTHER"),
  });
  await expectNoteBounds(f, encodeMinuteIdentity(instant(42)), true);
});
it.each(["other-taxpayer", "other-environment"])(
  "the note from public hour facts bounds a replacement under an %s",
  async (which) => {
    const f = await fixture(
      2,
      which === "other-taxpayer" ? "89890001K" : request.taxId,
      which === "other-environment" ? "preproduction" : "production",
      false,
      1,
      { history: retainedHour() },
    );
    await expectNoteBounds(f, encodeMinuteIdentity(instant(42)), true);
  },
);
it.each([2, 42, 43])(
  "Start again with a kept recovery document for hour42 notes hour42 before admitting offset%s",
  async (index) => {
    const f = await fixture(index, request.taxId, "production", false, 42, { document: true });
    const name = (firstSetupModuleContext(f.old, MODULE).request as { identity: string }).identity;
    await expectNoteBounds(f, name, index <= 42);
  },
);
it("a kept recovery document deleted before Start again leaves the note holding the attempt's frozen name", async () => {
  const f = await fixture(43, request.taxId, "production", false, 42, {
    document: true,
    damage: "missing-original",
  });
  expect(await startAgainNoteName(f.state)).toBe(
    (firstSetupModuleContext(f.old, MODULE).request as { identity: string }).identity,
  );
});
it.each(["syntax", "binding", "digest"] as const)(
  "a damaged recovery document %s is treated as missing: the summary says so, and the note keeps the attempt's own name",
  async (damage) => {
    const f = await fixture(43, request.taxId, "production", false, 42, { document: true, damage });
    const name = (firstSetupModuleContext(f.old, MODULE).request as { identity: string }).identity;
    expect(f.shown).toEqual({ reached: "named", lastName: name, recoveryRecordDamaged: true });
    expect(await startAgainNoteName(f.state)).toBe(name);
  },
);
it.each([{ document: true }, { document: true, damage: "missing-original" as const }])(
  "a kept recovery document that is valid or missing is not reported as damaged %#",
  async (retained) => {
    const f = await fixture(43, request.taxId, "production", false, 42, retained);
    expect("recoveryRecordDamaged" in f.shown).toBe(false);
  },
);
it("a damaged recovery document does not hide the rest of the history: the note takes the later retained name", async () => {
  const f = await fixture(43, request.taxId, "production", false, 1, {
    document: true,
    damage: "syntax",
    history: retainedHour(),
  });
  await expectNoteBounds(f, encodeMinuteIdentity(instant(42)), false);
});
it("a damaged recovery document beside another file in the documents folder reaches the confirmation, and the note takes the time floor", async () => {
  const f = await fixture(43, request.taxId, "production", false, 1, {
    document: true,
    damage: "syntax",
    stray: true,
    stampAtMs: STAMP_AT_MS,
  });
  expect(f.shown).toMatchObject({
    recoveryRecordDamaged: true,
    unreadable: { records: ["fiscal-documents"], floorMs: TIME_FLOOR_MS },
  });
  await expectTimeFloorNote(f);
});
it("a damaged recovery document beside invalid public evidence reaches the confirmation, and the note takes the time floor", async () => {
  const f = await fixture(43, request.taxId, "production", false, 1, {
    document: true,
    damage: "syntax",
    legacy: { version: 1, modules: {}, history: [null] },
    stampAtMs: STAMP_AT_MS,
  });
  expect(f.shown).toMatchObject({
    recoveryRecordDamaged: true,
    unreadable: { records: ["public-record"], floorMs: TIME_FLOOR_MS },
  });
  await expectTimeFloorNote(f);
});
it("Start again is refused while an outside hour-history file is configured", async () => {
  await expectStartAgainRefused(
    fixture(43, request.taxId, "production", false, 1, {
      history: retainedHour(),
      source: "outside",
    }),
    "setup.not_ready",
  );
});
it.each([
  null,
  { version: 1, modules: {}, history: [null] },
  { version: 1, modules: {}, history: [], extra: true },
])(
  "invalid public evidence reaches the confirmation, and the note takes the time floor %#",
  async (legacy) => {
    const f = await fixture(43, request.taxId, "production", false, 1, {
      legacy,
      stampAtMs: STAMP_AT_MS,
    });
    expect(f.shown).toMatchObject({
      unreadable: { records: ["public-record"], floorMs: TIME_FLOOR_MS },
    });
    expect("recoveryRecordDamaged" in f.shown).toBe(false);
    await expectTimeFloorNote(f);
  },
);
it.each(["reuse", "later"])(
  "ordinary hour preparation retains earlier abandoned events for %s",
  async (which) => {
    const f = await fixture(which === "reuse" ? 42 : 44, request.taxId, "production", false, 43, {
      previousIndex: 42,
    });
    const previous = f.old.previous[0]!;
    expect(
      (previous.frozen.modules.find((m) => m.module === MODULE)!.request as { identity: string })
        .identity,
    ).toBe("0CR2T");
    const selection = choose(f.host, f.state, f.claim.capability);
    if (which === "reuse")
      await expect(selection).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "minute_not_later" },
      });
    else {
      const result = await selection;
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
    }
  },
);
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
