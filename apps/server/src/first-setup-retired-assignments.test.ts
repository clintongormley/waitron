import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, readdir, unlink, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { initialSetupFor, withOperationAuthority } from "@waitron/module";
import {
  createFirstSetupCoordinator,
  createFirstSetupResolutionStore,
  selectFirstSetupWorkspace,
  readFirstSetupRetirements,
  type FirstSetupState,
} from "@waitron/provisioning";
import { encodeHourIdentity } from "@waitron/fiscal-verifactu/src/hour-identity.js";
import { hourSetupInput } from "@waitron/fiscal-verifactu/src/hour-preparation.js";
import { request, PASSWORD, MODULE } from "../test/first-fiscal.js";
import { keepHourRecoveryDocument } from "../test/hour-recovery-delivery.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { firstSetupModuleContext } from "./first-fiscal-evidence.js";
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
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(first);
  outside.release.mockReturnValue({ instantMs: first - 86_400_000 });
  outside.internet.mockImplementation(async () => {
    const mono = performance.now();
    return {
      source: "internet",
      result: "usable",
      instantMs: Date.now(),
      uncertaintyMs: 500,
      wallStartedMs: Date.now(),
      wallFinishedMs: Date.now(),
      monotonicStartedMs: mono,
      monotonicFinishedMs: mono,
    };
  });
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
  const challenge = (await host.preparation.prepare(owner, MODULE, {
    action: "clock-challenge",
  })) as { id: string };
  await host.preparation.prepare(owner, MODULE, {
    action: "compare-clocks",
    browser: { challengeId: challenge.id, instantMs: Date.now() },
  });
}
async function choose(host: Host, state: FirstSetupState, capability: string) {
  await compare(host, state, capability);
  const owner = ownerFor(state, capability);
  return host.preparation.select(
    owner,
    MODULE,
    { answer: "no" },
    await host.owner.reconfirm(owner, PASSWORD, "block-use"),
  );
}
function selectedRequest(state: FirstSetupState, index: number) {
  const context = firstSetupModuleContext(state, MODULE);
  const identity = encodeHourIdentity(instant(index));
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
function retainedHour(index = 42, softwareId = "W1") {
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
            identity: encodeHourIdentity(instant(index)),
            recordedAtMs: instant(index),
          },
        ],
      },
    ],
  };
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
    source?: "local" | "outside";
  },
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "retired-hour-assignments-")));
  roots.push(root);
  const anchor = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
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
      await compare(oldHost, old, oldClaim.capability);
      const owner = ownerFor(old, oldClaim.capability);
      const grant = await oldHost.owner.reconfirm(owner, PASSWORD, "block-use");
      const context = firstSetupModuleContext(old, MODULE);
      const seat = initialSetupFor(oldHost.modules, MODULE)!;
      await oldHost.owner.consumeReconfirmation(owner, grant, "block-use");
      const candidates = await oldHost.withPreparationAuthorization(
        async () => {
          await oldHost.owner.authorize(owner);
        },
        async () => seat.candidates(context, { answer: "no" }),
      );
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
  const originals: { name: string; bytes: Buffer | null }[] = [
    {
      name: "state/first-setup.json",
      bytes: await readFile(join(anchor.stateDir, "first-setup.json")),
    },
    {
      name: "venue/first-setup-claim.json",
      bytes: await readFile(join(anchor.venueDir, "first-setup-claim.json")),
    },
    { name: "venue/venue.db", bytes: null },
  ];
  if (retained?.document) {
    await keepHourRecoveryDocument(oldHost, ownerFor(old, oldClaim.capability), PASSWORD);
    const directory = join(anchor.stateDir, "first-fiscal-documents");
    const path = join(directory, `${MODULE}.recovery.json`);
    if (retained.damage === "syntax") await writeFile(path, "{damaged recovery document");
    if (retained.damage === "binding" || retained.damage === "digest") {
      const manifest = JSON.parse(await readFile(path, "utf8"));
      if (retained.damage === "binding") manifest.attemptId = randomUUID();
      else manifest.statement.createdAt = "2025-10-16T11:40:00.000Z";
      await writeFile(path, JSON.stringify(manifest));
    }
    const names = (await readdir(directory)).sort();
    originals.push({
      name: "directory:state/first-fiscal-documents",
      bytes: Buffer.from(JSON.stringify(names)),
    });
    for (const name of names)
      originals.push({
        name: `state/first-fiscal-documents/${name}`,
        bytes: await readFile(join(directory, name)),
      });
  }
  const publicPath =
    retained?.source === "outside"
      ? join(root, "outside-history.json")
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
    originals.push({
      name:
        retained?.source === "outside"
          ? `outside-file:${publicPath}`
          : "state/module-operation-public.json",
      bytes: await readFile(publicPath),
    });
  }
  const resolutionId = randomUUID(),
    workspaceId = randomUUID();
  const base = join(anchor.stateDir, "first-setup-workspaces", workspaceId);
  const binding = {
    workspaceId,
    resolutionId,
    anchorStateDir: anchor.stateDir,
    anchorVenueDir: anchor.venueDir,
    stateDir: join(base, "state"),
    venueDir: join(base, "venue"),
    selectionGeneration: 1,
  };
  const records = createFirstSetupResolutionStore({
    ...anchor,
    coordinator: createFirstSetupCoordinator(),
  });
  const prepared = await records.prepare(
    {
      resolutionId,
      attemptId: old.frozen.attemptId,
      observedRevision: old.revision,
      observedOwnerGeneration: old.ownerGeneration,
      database: "missing",
      authority: "original-password",
      register: null,
      action: "retire",
      nextWorkspace: binding,
    },
    originals,
  );
  await selectFirstSetupWorkspace(anchor, await records.apply(prepared));
  if (retained?.damage === "missing-original") {
    const archived = await records.readOriginals(resolutionId);
    expect(
      archived.some((entry) => entry.name.endsWith(".recovery.json") && entry.bytes !== null),
    ).toBe(true);
    // Damage the archived bytes, rather than removing the live file the archive already preserved.
    const archive = join(anchor.stateDir, "first-setup-resolutions", resolutionId);
    const files = await readdir(archive, { recursive: true });
    let removed = false;
    const original = originals.find((entry) => entry.name.endsWith(".recovery.json"))!.bytes!;
    for (const name of files) {
      const path = join(archive, name);
      const value = await readFile(path).catch(() => null);
      if (value === null) continue;
      const chunk = JSON.parse(value.toString("utf8")) as { bytes?: string };
      if (typeof chunk.bytes === "string" && Buffer.from(chunk.bytes, "base64").equals(original)) {
        await unlink(path);
        removed = true;
        break;
      }
    }
    expect(removed).toBe(true);
  }
  const host = createFirstSetupModuleHost({
    ...binding,
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
  return { root, host, state, old, claim, publicPath, module: MODULE, password: PASSWORD };
}

it("fresh events cannot reuse a retired hour with another allocation ID", async () => {
  const f = await fixture();
  expect(f.state.frozen.attemptId).not.toBe(f.old.frozen.attemptId);
  const current = firstSetupModuleContext(f.state, MODULE),
    prior = firstSetupModuleContext(f.old, MODULE);
  expect(current.binding.eventId).not.toBe(prior.binding.eventId);
  await expect(f.host.assertFreshAssignment(f.state, MODULE)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
});
it.each(["later-hour", "other-taxpayer", "other-environment"])(
  "retirement still permits a %s",
  async (which) => {
    const f = await fixture(
      which === "later-hour" ? 2 : 1,
      which === "other-taxpayer" ? "89890001K" : request.taxId,
      which === "other-environment" ? "preproduction" : "production",
    );
    await f.host.assertFreshAssignment(f.state, MODULE);
    expect(f.state.revision).toBe(2);
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
    await compare(f.host, f.state, f.claim.capability);
    const owner = ownerFor(f.state, f.claim.capability);
    const response = await app.request("/setup-api/first-setup/candidates", {
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
        proposal: { answer: "no" },
        reconfirmation: await f.host.owner.reconfirm(owner, PASSWORD, "block-use"),
      }),
    });
    expect(response.status).toBe(index === 1 ? 400 : 200);
    if (index === 1) {
      expect(await response.json()).toEqual({
        error: { code: "sif.allocation_invalid", params: { reason: "hour_not_later" } },
      });
      expect(await f.host.store.read()).toEqual(f.state);
    } else {
      const current = (await f.host.store.read())!;
      expect(current.consumptionIntent).toBe(true);
      expect(
        (current.frozen.modules.find((m) => m.module === MODULE)!.request as { identity: string })
          .identity,
      ).toBe("06RC");
    }
  },
);
it("activation refuses a retired hour even when a caller bypassed the candidate route", async () => {
  const f = await fixture();
  const state = await f.host.store.update(f.state.frozen.attemptId, f.state.revision, {
    kind: "consumption-intent",
  });
  const { activateFirstFiscal } = await import("./first-fiscal-activation.js");
  await expect(
    f.host.coordinator.run((hold) =>
      activateFirstFiscal(
        f.host,
        { environment: "production" },
        ownerFor(state, f.claim.capability),
        {},
        hold,
      ),
    ),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await f.host.store.read()).toEqual(state);
});
it.each([1, 41, 42, 43])("a retired hour at offset42 bounds fresh offset%s", async (index) => {
  const f = await fixture(index, request.taxId, "production", true, 42);
  if (index <= 42)
    await expect(f.host.assertFreshAssignment(f.state, MODULE)).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
  else await f.host.assertFreshAssignment(f.state, MODULE);
});
it("an empty replacement cannot erase inherited spent hours", async () => {
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
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(await f.host.store.read()).toEqual(f.state);
});
it("password recovery retires an unused replacement without erasing the earlier hour or inventing register evidence", async () => {
  const f = await fixture(2, request.taxId, "production", false);
  await suite.db.archiveTo(join(f.state.venueDir, "venue.db"));
  const initial = await f.host.resolution.inspectFirstSetupResolution();
  expect(initial.emptyDatabase).toBe(true);
  const recovered = await f.host.owner.recoverFirstSetupOwner({
    inspectionId: initial.inspectionId,
    revision: f.state.revision,
    ownerGeneration: f.state.ownerGeneration,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    password: PASSWORD,
  });
  const inspection = await f.host.resolution.inspectFirstSetupResolution();
  const { createFirstSetupResolutionActions } = await import("./first-setup-resolution.js");
  const actions = createFirstSetupResolutionActions({
    stateDir: f.state.stateDir,
    venueDir: f.state.venueDir,
    host: f.host,
  });
  const binding = await actions.startAgainFirstSetup({
    inspectionId: inspection.inspectionId,
    revision: recovered.state.revision,
    ownerGeneration: recovered.state.ownerGeneration,
    owner: { ...recovered.state, capability: recovered.capability },
  });
  expect(binding.selectionGeneration).toBe(2);
  expect(binding.anchorStateDir).toBe(f.old.stateDir);
  const retired = await readFirstSetupRetirements(binding);
  expect(retired.map((entry) => entry.record.register)).toEqual([null, null]);
  expect(retired[1]!.state).toEqual(f.old);
});
it.each([2, 41, 42, 43])(
  "retained public hour42 bounds offset%s independently of saved hour1",
  async (index) => {
    const f = await fixture(index, request.taxId, "production", true, 1, {
      history: retainedHour(),
    });
    if (index <= 42)
      await expect(f.host.assertFreshAssignment(f.state, MODULE)).rejects.toMatchObject({
        code: "setup.attempt_conflict",
      });
    else await f.host.assertFreshAssignment(f.state, MODULE);
  },
);
it("a retained hour under another software ID still consumes that taxpayer's hour", async () => {
  const f = await fixture(2, request.taxId, "production", true, 1, {
    history: retainedHour(42, "OTHER"),
  });
  await expect(f.host.assertFreshAssignment(f.state, MODULE)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
});
it.each(["other-taxpayer", "other-environment"])(
  "retained public hour facts preserve the %s namespace",
  async (which) => {
    const f = await fixture(
      2,
      which === "other-taxpayer" ? "89890001K" : request.taxId,
      which === "other-environment" ? "preproduction" : "production",
      true,
      1,
      { history: retainedHour() },
    );
    await f.host.assertFreshAssignment(f.state, MODULE);
  },
);
it.each([2, 42, 43])(
  "retirement retains the real recovery document and hour42 before admitting offset%s",
  async (index) => {
    const f = await fixture(index, request.taxId, "production", true, 42, { document: true });
    if (index <= 42)
      await expect(f.host.assertFreshAssignment(f.state, MODULE)).rejects.toMatchObject({
        code: "setup.attempt_conflict",
      });
    else await f.host.assertFreshAssignment(f.state, MODULE);
  },
);
it.each(["missing-original", "syntax", "binding", "digest"] as const)(
  "damaged retired recovery document %s never becomes absence of history",
  async (damage) => {
    if (damage === "missing-original") {
      await expect(
        fixture(43, request.taxId, "production", true, 42, { document: true, damage }),
      ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
      return;
    }
    const f = await fixture(43, request.taxId, "production", true, 42, { document: true, damage });
    await expect(f.host.assertFreshAssignment(f.state, MODULE)).rejects.toMatchObject({
      code: "setup.not_ready",
    });
  },
);
it.each([2, 43])(
  "independent hour-history file42 retained at retirement bounds offset%s",
  async (index) => {
    const f = await fixture(index, request.taxId, "production", true, 1, {
      history: retainedHour(),
      source: "outside",
    });
    if (index <= 42)
      await expect(f.host.assertFreshAssignment(f.state, MODULE)).rejects.toMatchObject({
        code: "setup.attempt_conflict",
      });
    else await f.host.assertFreshAssignment(f.state, MODULE);
  },
);
it.each([
  null,
  { version: 1, modules: {}, history: [null] },
  { version: 1, modules: {}, history: [], extra: true },
])("invalid retained public evidence fails with a domain refusal %#", async (legacy) => {
  const f = await fixture(43, request.taxId, "production", true, 1, { legacy });
  await expect(f.host.assertFreshAssignment(f.state, MODULE)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
});
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
    ).toBe("06SM");
    const selection = choose(f.host, f.state, f.claim.capability);
    if (which === "reuse")
      await expect(selection).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "hour_not_later" },
      });
    else {
      const result = await selection;
      expect(result.state.consumptionIntent).toBe(true);
      const selected = result.state.frozen.modules.find((m) => m.module === MODULE)!.request as {
        identity: string;
        input: unknown;
      };
      expect(selected.identity).toBe("06SP");
      const path = join(f.old.stateDir, "module-preparation-state.json");
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
      );
      expect(preview).toMatchObject({
        status: "selected",
        identity: "06SP",
        issuedAt: "2026-10-18T06:40:00.000Z",
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
it.each(["replace", "remove"])(
  "a live outside history may %s without releasing its archived hour42",
  async (change) => {
    for (const index of [2, 43]) {
      const f = await fixture(index, request.taxId, "production", true, 1, {
        history: retainedHour(),
        source: "outside",
      });
      if (change === "replace") await writeFile(f.publicPath, JSON.stringify(retainedHour(1)));
      else await unlink(f.publicPath);
      if (index <= 42)
        await expect(f.host.assertFreshAssignment(f.state, MODULE)).rejects.toMatchObject({
          code: "setup.attempt_conflict",
        });
      else await f.host.assertFreshAssignment(f.state, MODULE);
      expect(await f.host.store.read()).toEqual(f.state);
    }
  },
);
