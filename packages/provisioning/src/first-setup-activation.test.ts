import { randomBytes } from "node:crypto";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { AppError } from "@waitron/shared";
import { initialSetupFor } from "@waitron/module";
import { withTransaction, stampDeployment, nodeRoles } from "@waitron/db";
import { createFirstSetupRuntime } from "./first-setup-runtime.js";
import { prepareFirstSetupCommand } from "./first-setup-command.js";
import { firstSetupModuleContext } from "./first-setup-module-context.js";
import { initialVenueApplyInput } from "./initial-venue-input.js";
import { planVenue } from "./venue-plan.js";
import { applyVenue, type VenueResult } from "./venue-apply.js";
import {
  activateFirstSetup,
  finishFirstSetup,
  checkedFirstSetupCommit,
  firstSetupProvisionRequest,
  publishCheckedFirstSetup,
} from "./first-setup-activation.js";
import { MODULE, PASSWORD, request } from "../test/first-setup-request.js";

const NOW = Date.parse("2026-10-16T11:40:00Z");
const external = vi.hoisted(() => ({ internet: vi.fn() }));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: external.internet,
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
const venue = useVenueDb({ migrations: TEST_MIGRATIONS });
const roots: string[] = [];
beforeEach(() => {
  // Keep wall and elapsed time together while the recovery PDF is generated.
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(NOW);
  external.internet.mockImplementation(async () => ({
    source: "internet",
    result: "usable",
    instantMs: NOW,
    uncertaintyMs: 500,
    wallStartedMs: NOW,
    wallFinishedMs: NOW,
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }));
});
afterEach(async () => {
  vi.useRealTimers();
  external.internet.mockReset();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(kept = true) {
  const root = await mkdtemp(join(tmpdir(), "shared-activation-"));
  roots.push(root);
  const runtime = createFirstSetupRuntime({
    stateDir: join(root, "state"),
    venueDir: join(root, "venue"),
    modules: ALL_MODULES,
    environment: {},
    database: () => venue.db,
  });
  const claim = await runtime.owner.claimFirstSetup(
    { environment: "preproduction", request },
    randomBytes(32).toString("base64url"),
  );
  const io = {
    stdout() {},
    stderr() {},
    clearScreen() {},
    prompt: async () => "no",
    promptSecret: async () => PASSWORD,
  };
  const prepared = await prepareFirstSetupCommand(
    runtime,
    { ...claim.state, capability: claim.capability },
    io,
  );
  expect(prepared.status).toBe("ready");
  if (kept) {
    io.prompt = async () => "yes";
    expect(
      await runtime.commandDelivery.deliver(prepared.owner, io, join(root, "recovery.pdf"), "en"),
    ).toEqual({ status: "ready" });
  }
  const states: string[] = [];
  let written: VenueResult | undefined;
  const provision = vi.fn(async (beforeTransaction: () => Promise<void>) => {
    const state = (await runtime.store.read())!;
    await stampDeployment(venue.db, state.frozen.environment);
    const input = firstSetupProvisionRequest(state).initialOperations;
    const modules = runtime.modules
      .filter((module) => state.frozen.modules.some((entry) => entry.module === module.name))
      .map((module) => {
        if (
          module.operations === undefined ||
          !input.inputs.some((entry) => entry.module === module.name)
        )
          return module;
        const operations = module.operations;
        return {
          ...module,
          operations: {
            prepare: <T>(
              operation: Parameters<typeof operations.prepare>[0],
              run: (prepared: Parameters<typeof operations.prepare>[0]) => Promise<T>,
            ) =>
              operations.prepare(operation, async (ready) => {
                await beforeTransaction();
                states.push((await runtime.store.read())!.status);
                return run(ready);
              }),
          },
        };
      });
    written = await applyVenue(planVenue(state.frozen.request, modules), {
      ...initialVenueApplyInput(input),
      db: venue.db,
      modules,
    });
  });
  const recover = vi.fn(async () => {
    if (written === undefined) throw new Error("no committed venue");
    return structuredClone(written);
  });
  const check = vi.fn((state: Awaited<ReturnType<typeof runtime.owner.authorize>>) =>
    checkedFirstSetupCommit(runtime, { db: venue.db, recoverProvision: recover }, state),
  );
  const assertReady = vi.fn(async () => {});
  const confirmCommitted = vi.fn(async () => {});
  const publish = vi.fn(
    async (
      state: Awaited<ReturnType<typeof runtime.owner.authorize>>,
      checked: { venue: VenueResult; modules: Record<string, unknown> },
    ) => {
      states.push(state.status);
      expect(state.result).toEqual(checked);
      return checked.venue;
    },
  );
  const deps = { provision, check, assertReady, confirmCommitted, publish };
  const owner = prepared.owner;
  const digest = "a".repeat(64);
  const activate = () =>
    runtime.resolution.withVenueExclusion(() =>
      runtime.coordinator.run((hold) => activateFirstSetup(runtime, deps, owner, digest, hold)),
    );
  return { root, runtime, owner, digest, deps, states, activate, recover, io };
}

it("commits a real prepared hour only after kept consent and publishes its checked result", async () => {
  const f = await fixture();
  const result = await f.activate();
  const state = (await f.runtime.store.read())!;
  expect(state.status).toBe("committed");
  expect(state.inputs.$publication).toEqual({ digest: f.digest });
  expect(state.result).toMatchObject({
    venue: result,
    modules: {
      [MODULE]: {
        activationEventId: state.frozen.modules.find((entry) => entry.module === MODULE)!.eventId,
      },
    },
  });
  expect(f.states).toEqual(["activation-started", "committed"]);
  expect(f.deps.assertReady).toHaveBeenCalledOnce();
  expect(f.deps.provision).toHaveBeenCalledOnce();
  expect(f.deps.check).toHaveBeenCalledOnce();
  expect(f.deps.publish).toHaveBeenCalledOnce();
  expect(await venue.db.execute("select count(*) as count from registro_sif")).toMatchObject({
    rows: [{ count: 1 }],
  });
  expect(
    await venue.db.execute("select code, next_number from invoice_series order by code"),
  ).toMatchObject({
    rows: [
      { code: "A-06RB", next_number: 1 },
      { code: "FF-06RB", next_number: 1 },
      { code: "R-06RB", next_number: 1 },
    ],
  });
});

it("refuses activation without fresh kept authority before readiness, writes or publication", async () => {
  const f = await fixture(false);
  const before = await f.runtime.store.read();
  await expect(f.activate()).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(await f.runtime.store.read()).toEqual(before);
  expect(f.deps.assertReady).not.toHaveBeenCalled();
  expect(f.deps.provision).not.toHaveBeenCalled();
  expect(f.deps.publish).not.toHaveBeenCalled();
  expect(await venue.db.execute("select count(*) as count from tenants")).toMatchObject({
    rows: [{ count: 0 }],
  });
});

it("checks every module's real committed receipt before trusting the recovered venue", async () => {
  const f = await fixture();
  const state = (await f.runtime.store.read())!;
  f.recover.mockResolvedValue({
    nodeId: state.frozen.nodeId,
    locationId: "f0d20241-e144-4ea6-bf9b-66976e60e765",
    seriesIds: [],
    seeded: [],
  });
  expect(
    await checkedFirstSetupCommit(f.runtime, { db: venue.db, recoverProvision: f.recover }, state),
  ).toBeNull();
  expect(f.recover).not.toHaveBeenCalled();
  const context = firstSetupModuleContext(state, MODULE);
  expect(
    await withTransaction(venue.db, (tx) =>
      initialSetupFor(f.runtime.modules, MODULE)!.committed(tx, context, state.inputs[MODULE]),
    ),
  ).toBeNull();
});

it("refuses a recovered venue that differs from the stored exact committed result", async () => {
  const f = await fixture();
  await f.activate();
  const state = (await f.runtime.store.read())!;
  f.recover.mockResolvedValue({
    ...(state.result as { venue: VenueResult }).venue,
    seriesIds: [],
  });
  await expect(
    checkedFirstSetupCommit(f.runtime, { db: venue.db, recoverProvision: f.recover }, state),
  ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  expect(await f.runtime.store.read()).toEqual(state);
});

it("records the exact commit after a lost response and never activates it twice", async () => {
  const f = await fixture();
  const provision = f.deps.provision.getMockImplementation()!;
  f.deps.provision.mockImplementation(async (before) => {
    await provision(before);
    throw new AppError("setup.not_ready", {});
  });
  await expect(f.activate()).rejects.toMatchObject({ code: "setup.not_ready" });
  const committed = (await f.runtime.store.read())!;
  expect(committed.status).toBe("committed");
  expect(f.deps.publish).not.toHaveBeenCalled();
  f.owner.revision = committed.revision;
  await expect(f.activate()).resolves.toEqual(
    committed.result && (committed.result as { venue: VenueResult }).venue,
  );
  expect(f.deps.provision).toHaveBeenCalledOnce();
  expect(f.deps.confirmCommitted).toHaveBeenCalledOnce();
  expect(f.deps.publish).toHaveBeenCalledOnce();
  expect(await venue.db.execute("select count(*) as count from registro_sif")).toMatchObject({
    rows: [{ count: 1 }],
  });
});

it("readiness refusal leaves the venue unactivated and consumes the one-use kept authority", async () => {
  const f = await fixture();
  const before = await f.runtime.store.read();
  f.deps.assertReady.mockRejectedValue(new AppError("setup.not_ready", {}));
  await expect(f.activate()).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(await f.runtime.store.read()).toEqual(before);
  expect(f.deps.provision).not.toHaveBeenCalled();
  f.deps.assertReady.mockResolvedValue();
  await expect(f.activate()).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(f.deps.assertReady).toHaveBeenCalledOnce();
  expect(await venue.db.execute("select count(*) as count from registro_sif")).toMatchObject({
    rows: [{ count: 0 }],
  });
});

it("a preparation refusal before the transaction boundary leaves the attempt resumable", async () => {
  const f = await fixture();
  const before = await f.runtime.store.read();
  f.deps.provision.mockRejectedValue(new AppError("setup.not_ready", {}));
  await expect(f.activate()).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(await f.runtime.store.read()).toEqual(before);
  expect(f.deps.check).not.toHaveBeenCalled();
  expect(f.deps.publish).not.toHaveBeenCalled();
});

it.each(["throw", "return", "check-refuses"])(
  "%s after the activation boundary without an exact commit is uncertain and never published",
  async (outcome) => {
    const f = await fixture();
    f.deps.provision.mockImplementation(async (before) => {
      await before();
      if (outcome !== "return") throw new AppError("setup.not_ready", {});
    });
    if (outcome === "check-refuses")
      f.deps.check.mockRejectedValue(new Error("synthetic read refusal"));
    await expect(f.activate()).rejects.toMatchObject({
      code: outcome === "return" ? "setup.attempt_uncertain" : "setup.not_ready",
    });
    expect((await f.runtime.store.read())!.status).toBe("uncertain");
    expect(f.deps.publish).not.toHaveBeenCalled();
    expect(await venue.db.execute("select count(*) as count from registro_sif")).toMatchObject({
      rows: [{ count: 0 }],
    });
  },
);

it("refuses a changed publication digest before replaying or writing", async () => {
  const f = await fixture();
  await f.activate();
  const state = (await f.runtime.store.read())!;
  f.owner.revision = state.revision;
  await expect(
    f.runtime.coordinator.run((hold) =>
      activateFirstSetup(f.runtime, f.deps, f.owner, "b".repeat(64), hold),
    ),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await f.runtime.store.read()).toEqual(state);
  expect(f.deps.check).toHaveBeenCalledOnce();
  expect(f.deps.provision).toHaveBeenCalledOnce();
  expect(f.deps.publish).toHaveBeenCalledOnce();
});

it("a publication refusal retains the checked commit and retries publication without kept consent or activation", async () => {
  const f = await fixture();
  f.deps.publish.mockRejectedValueOnce(new AppError("setup.not_ready", {}));
  await expect(f.activate()).rejects.toMatchObject({ code: "setup.not_ready" });
  const state = (await f.runtime.store.read())!;
  expect(state.status).toBe("committed");
  f.owner.revision = state.revision;
  const rows = await venue.db.execute("select * from invoice_series order by id");
  await expect(f.activate()).resolves.toEqual((state.result as { venue: VenueResult }).venue);
  expect(f.deps.assertReady).toHaveBeenCalledOnce();
  expect(f.deps.provision).toHaveBeenCalledOnce();
  expect(f.deps.confirmCommitted).toHaveBeenCalledOnce();
  expect(f.deps.publish).toHaveBeenCalledTimes(2);
  expect(await venue.db.execute("select * from invoice_series order by id")).toEqual(rows);
});

it("an unreadable exact receipt after commit leaves activation-started for a read-only retry", async () => {
  const f = await fixture();
  f.deps.check.mockRejectedValueOnce(new Error("synthetic lost read"));
  await expect(f.activate()).rejects.toThrow("synthetic lost read");
  const state = (await f.runtime.store.read())!;
  expect(state.status).toBe("activation-started");
  f.owner.revision = state.revision;
  await f.activate();
  expect((await f.runtime.store.read())!.status).toBe("committed");
  expect(f.deps.provision).toHaveBeenCalledOnce();
  expect(f.deps.confirmCommitted).toHaveBeenCalledOnce();
  expect(f.deps.publish).toHaveBeenCalledOnce();
});

it.each(["missing", "different", "throws"])(
  "a %s receipt on replay marks uncertainty before publication",
  async (failure) => {
    const f = await fixture();
    await f.activate();
    const before = (await f.runtime.store.read())!;
    f.owner.revision = before.revision;
    if (failure === "missing") f.deps.check.mockResolvedValue(null);
    else if (failure === "throws")
      f.deps.check.mockRejectedValue(new Error("synthetic read refusal"));
    else
      f.recover.mockResolvedValue({
        ...(before.result as { venue: VenueResult }).venue,
        seriesIds: [],
      });
    await expect(f.activate()).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
    expect((await f.runtime.store.read())!.status).toBe("uncertain");
    expect(f.deps.provision).toHaveBeenCalledOnce();
    expect(f.deps.publish).toHaveBeenCalledOnce();
  },
);

it("retained committed evidence still needs the caller's fresh publication authority", async () => {
  const f = await fixture();
  await f.activate();
  const before = (await f.runtime.store.read())!;
  f.owner.revision = before.revision;
  f.deps.confirmCommitted.mockRejectedValue(new AppError("setup.owner_required", {}));
  await expect(f.activate()).rejects.toMatchObject({ code: "setup.owner_required" });
  expect(await f.runtime.store.read()).toEqual(before);
  expect(f.deps.publish).toHaveBeenCalledOnce();
  expect(f.deps.provision).toHaveBeenCalledOnce();
});

it("a stale owner cannot reach activation dependencies", async () => {
  const f = await fixture();
  f.owner.revision += 1;
  await expect(f.activate()).rejects.toMatchObject({ code: "setup.owner_required" });
  expect(f.deps.assertReady).not.toHaveBeenCalled();
  expect(f.deps.provision).not.toHaveBeenCalled();
  expect(f.deps.check).not.toHaveBeenCalled();
  expect(f.deps.publish).not.toHaveBeenCalled();
});

it("an uncertain attempt cannot reach activation dependencies", async () => {
  const f = await fixture();
  let state = (await f.runtime.store.read())!;
  state = await f.runtime.store.update(state.frozen.attemptId, state.revision, {
    kind: "activation-started",
  });
  state = await f.runtime.store.update(state.frozen.attemptId, state.revision, {
    kind: "uncertain",
  });
  f.owner.revision = state.revision;
  await expect(f.activate()).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  expect(await f.runtime.store.read()).toEqual(state);
  expect(f.deps.provision).not.toHaveBeenCalled();
  expect(f.deps.check).not.toHaveBeenCalled();
  expect(f.deps.publish).not.toHaveBeenCalled();
});

it("an adapter cannot publish without reporting its transaction boundary", async () => {
  const f = await fixture();
  const before = await f.runtime.store.read();
  f.deps.provision.mockResolvedValue(undefined);
  await expect(f.activate()).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  expect(await f.runtime.store.read()).toEqual(before);
  expect(f.deps.check).not.toHaveBeenCalled();
  expect(f.deps.publish).not.toHaveBeenCalled();
  expect(await venue.db.execute("select count(*) as count from tenants")).toMatchObject({
    rows: [{ count: 0 }],
  });
});

it("continues a retained publication binding only after renewed kept consent", async () => {
  const f = await fixture();
  const before = (await f.runtime.store.read())!;
  const bound = await f.runtime.store.update(before.frozen.attemptId, before.revision, {
    kind: "publication-binding",
    digest: f.digest,
  });
  f.owner.revision = bound.revision;
  await expect(f.activate()).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(f.deps.provision).not.toHaveBeenCalled();
  await f.runtime.commandDelivery.deliver(f.owner, f.io, join(f.root, "recovery.pdf"), "en");
  await f.activate();
  const after = (await f.runtime.store.read())!;
  expect(after.status).toBe("committed");
  expect(after.history.filter((event) => event.kind === "publication-binding")).toHaveLength(1);
  expect(f.deps.provision).toHaveBeenCalledOnce();
  expect(f.deps.publish).toHaveBeenCalledOnce();
});

async function publicationFixture() {
  const f = await fixture();
  const steps: string[] = [];
  const publication = {
    db: venue.db,
    publishSelection: vi.fn(async () => {
      steps.push("selection");
    }),
    publishIdentity: vi.fn(async () => {
      steps.push("identity");
    }),
    sealSettings: vi.fn(async () => {
      steps.push("settings");
    }),
    persistTrading: vi.fn(async () => {
      steps.push("trading");
    }),
    clearConfiguration: vi.fn(async () => {
      steps.push("clear");
    }),
  };
  const audit = vi.fn(async () => {
    steps.push("audit");
    expect((await f.runtime.store.read())!.status).toBe("publication");
  });
  const publish = (
    state: Awaited<ReturnType<typeof f.runtime.owner.authorize>>,
    checked: { venue: VenueResult; modules: Record<string, unknown> },
  ) =>
    f.runtime.coordinator.run((hold) =>
      publishCheckedFirstSetup(
        f.runtime,
        publication,
        state,
        checked,
        f.owner,
        f.digest,
        hold,
        audit,
      ),
    );
  await f.activate();
  const state = (await f.runtime.store.read())!;
  f.owner.revision = state.revision;
  const checked = state.result as { venue: VenueResult; modules: Record<string, unknown> };
  return { ...f, steps, publication, audit, publish, state, checked };
}

it("publishes only an exact checked commit, installs its retained verifier and audits before completion", async () => {
  const f = await publicationFixture();
  const stage = await f.runtime.keys.readStage(f.owner);
  expect(await venue.db.select().from(nodeRoles)).toEqual([]);
  await expect(f.publish(f.state, f.checked)).resolves.toEqual(f.checked.venue);
  expect(f.steps).toEqual(["selection", "identity", "settings", "trading", "clear", "audit"]);
  expect((await f.runtime.store.read())!.status).toBe("complete");
  expect(await venue.db.select().from(nodeRoles)).toMatchObject([
    {
      nodeId: f.checked.venue.nodeId,
      breakGlassVerifier: stage.verifier,
      breakGlassKeyName: stage.name,
    },
  ]);
});

it.each(["selection", "identity", "settings", "trading", "clear", "audit"])(
  "a %s refusal keeps publication incomplete and allows a checked retry without another activation",
  async (step) => {
    const f = await publicationFixture();
    const selected = {
      selection: f.publication.publishSelection,
      identity: f.publication.publishIdentity,
      settings: f.publication.sealSettings,
      trading: f.publication.persistTrading,
      clear: f.publication.clearConfiguration,
      audit: f.audit,
    }[step]!;
    selected.mockRejectedValueOnce(new AppError("setup.not_ready", {}));
    await expect(f.publish(f.state, f.checked)).rejects.toMatchObject({ code: "setup.not_ready" });
    const after = (await f.runtime.store.read())!;
    expect(after.status).toBe(step === "audit" ? "publication" : "committed");
    expect(f.steps).toEqual(
      ["selection", "identity", "settings", "trading", "clear", "audit"].slice(
        0,
        ["selection", "identity", "settings", "trading", "clear", "audit"].indexOf(step),
      ),
    );
    f.owner.revision = after.revision;
    const verifier = await venue.db.select().from(nodeRoles);
    const series = await venue.db.execute("select * from invoice_series order by id");
    await expect(f.publish(after, f.checked)).resolves.toEqual(f.checked.venue);
    expect((await f.runtime.store.read())!.status).toBe("complete");
    expect(await venue.db.select().from(nodeRoles)).toEqual(verifier);
    expect(await venue.db.execute("select * from invoice_series order by id")).toEqual(series);
    expect(f.deps.provision).toHaveBeenCalledOnce();
  },
);

it.each(["status", "result", "digest"])(
  "publication refuses a mismatched %s before any output or verifier installation",
  async (part) => {
    const f = await publicationFixture();
    const changed = structuredClone(f.state);
    if (part === "status") changed.status = "activation-started";
    else if (part === "digest") changed.inputs.$publication = { digest: "b".repeat(64) };
    const checked =
      part === "result"
        ? { ...f.checked, venue: { ...f.checked.venue, seriesIds: [] } }
        : f.checked;
    await expect(f.publish(changed, checked)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
    expect(f.steps).toEqual([]);
    expect(await venue.db.select().from(nodeRoles)).toEqual([]);
    expect(await f.runtime.store.read()).toEqual(f.state);
  },
);

it.each(["database", "reader", "offering"])(
  "an absent %s cannot certify a committed setup",
  async (part) => {
    const f = await fixture();
    const state = (await f.runtime.store.read())!;
    if (part === "offering")
      state.frozen.modules = state.frozen.modules.filter((entry) => entry.module !== MODULE);
    await expect(
      checkedFirstSetupCommit(
        f.runtime,
        {
          ...(part === "database" ? {} : { db: venue.db }),
          ...(part === "reader" ? {} : { recoverProvision: f.recover }),
        },
        state,
      ),
    ).rejects.toMatchObject({
      code: part === "offering" ? "setup.attempt_uncertain" : "setup.not_ready",
    });
    expect(f.recover).not.toHaveBeenCalled();
  },
);

it("derives the complete frozen provision request and preserves configuration-import binding", async () => {
  const f = await fixture();
  const state = (await f.runtime.store.read())!;
  const imported = {
    ...state,
    frozen: { ...state.frozen, configurationImport: { digest: "b".repeat(64), newTaxpayer: true } },
  } as typeof state;
  const derived = firstSetupProvisionRequest(imported);
  expect(derived).toEqual({
    environment: state.frozen.environment,
    venue: state.frozen.request,
    configurationImport: true,
    configurationDigest: "b".repeat(64),
    newTaxpayer: true,
    initialOperations: {
      nodeId: state.frozen.nodeId,
      administratorId: state.frozen.administratorId,
      inputs: [
        {
          module: MODULE,
          eventId: state.frozen.modules.find((entry) => entry.module === MODULE)!.eventId,
          sourceId: state.frozen.sourceId,
          input: state.inputs[MODULE],
        },
      ],
    },
  });
  derived.venue.legalName = "changed caller copy";
  expect(state.frozen.request.legalName).toBe(request.legalName);
});

it("a missing retained key stops publication before selection or identity work", async () => {
  const f = await publicationFixture();
  await rm(join(f.root, "state", "first-setup-node-key.json"));
  await expect(f.publish(f.state, f.checked)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  expect(f.steps).toEqual([]);
  expect(await venue.db.select().from(nodeRoles)).toEqual([]);
  expect(await f.runtime.store.read()).toEqual(f.state);
});

it("retains the caller's legacy key adapter for a module without the recovery-document seat", async () => {
  const f = await publicationFixture();
  const modules = f.runtime.modules.map((module) => {
    const seat = module.provisioning?.initialSetup;
    if (seat === undefined) return module;
    const { recoveryDocument: _, ...legacy } = seat;
    void _;
    return { ...module, provisioning: { ...module.provisioning, initialSetup: legacy } };
  });
  const installLegacyKey = vi.fn(async () => {});
  await f.runtime.coordinator.run((hold) =>
    publishCheckedFirstSetup(
      { ...f.runtime, modules },
      { ...f.publication, installLegacyKey },
      f.state,
      f.checked,
      f.owner,
      f.digest,
      hold,
    ),
  );
  expect(installLegacyKey.mock.calls).toHaveLength(f.state.frozen.modules.length);
  expect((installLegacyKey.mock.calls as unknown[][]).map((call) => call[2])).toEqual(
    f.state.frozen.modules.map((entry) => entry.module),
  );
  expect(f.steps).toEqual(["selection", "identity", "settings", "trading", "clear"]);
  expect((await f.runtime.store.read())!.status).toBe("complete");
});

async function finishFixture(recover = true) {
  const f = await publicationFixture();
  let owner = f.owner;
  const recoveryNonce = randomBytes(32).toString("base64url");
  if (recover) {
    const inspection = await f.runtime.resolution.inspectFirstSetupResolution();
    const recovered = await f.runtime.owner.recoverFirstSetupOwner({
      inspectionId: inspection.inspectionId,
      revision: f.state.revision,
      ownerGeneration: f.state.ownerGeneration,
      clientClaimNonce: recoveryNonce,
      password: PASSWORD,
    });
    owner = { ...recovered.state, capability: recovered.capability };
  }
  const check = vi.fn(f.deps.check.getMockImplementation()!);
  const finish = (digest = f.digest) =>
    f.runtime.resolution.withVenueExclusion(() =>
      f.runtime.coordinator.run((hold) =>
        finishFirstSetup(
          f.runtime,
          {
            check,
            publish: (state, checked, beforeComplete) =>
              publishCheckedFirstSetup(
                f.runtime,
                f.publication,
                state,
                checked,
                owner,
                digest,
                hold,
                beforeComplete,
              ),
          },
          owner,
          digest,
          hold,
        ),
      ),
    );
  return { ...f, owner, check, finish, recoveryNonce };
}

it("shared Finish publishes a recovered exact commit and durably records password authority", async () => {
  const f = await finishFixture();
  const before = await venue.db.execute("select * from invoice_series order by id");
  await expect(f.finish()).resolves.toEqual(f.checked.venue);
  expect((await f.runtime.store.read())!.status).toBe("complete");
  expect(await venue.db.execute("select * from invoice_series order by id")).toEqual(before);
  expect(await venue.db.execute("select count(*) as count from registro_sif")).toMatchObject({
    rows: [{ count: 1 }],
  });
  expect(f.deps.provision).toHaveBeenCalledOnce();
  expect(f.steps).toEqual(["selection", "identity", "settings", "trading", "clear"]);
  const { createFirstSetupResolutionStore } = await import("./first-setup-resolution.js");
  const { createFirstSetupCoordinator } = await import("./first-setup-state.js");
  const records = createFirstSetupResolutionStore({
    stateDir: join(f.root, "state"),
    venueDir: join(f.root, "venue"),
    coordinator: createFirstSetupCoordinator(),
  });
  const ids = await readdir(join(f.root, "state", "first-setup-resolutions"));
  const audits = (await Promise.all(ids.map((id) => records.read(id)))).flat();
  expect(audits).toContainEqual(
    expect.objectContaining({
      action: "finish-publication",
      phase: "applied",
      database: "committed-exact",
      authority: "original-password",
      register: null,
      observedOwnerGeneration: f.owner.ownerGeneration,
    }),
  );
});

it("shared Finish refuses an unrecovered owner before reading the commit or publishing", async () => {
  const f = await finishFixture(false);
  const before = await f.runtime.store.read();
  await expect(f.finish()).rejects.toMatchObject({ code: "setup.owner_required" });
  expect(await f.runtime.store.read()).toEqual(before);
  expect(f.check).not.toHaveBeenCalled();
  expect(f.steps).toEqual([]);
});

it("shared Finish refuses a different publication digest without reading or changing the commit", async () => {
  const f = await finishFixture();
  const before = await f.runtime.store.read();
  await expect(f.finish("b".repeat(64))).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  expect(await f.runtime.store.read()).toEqual(before);
  expect(f.check).not.toHaveBeenCalled();
  expect(f.steps).toEqual([]);
});

it("shared Finish requires a real committed module receipt", async () => {
  const f = await finishFixture();
  const before = await f.runtime.store.read();
  const audits = await readdir(join(f.root, "state", "first-setup-resolutions"));
  f.check.mockResolvedValue(null);
  await expect(f.finish()).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  expect(await f.runtime.store.read()).toEqual(before);
  expect(f.steps).toEqual([]);
  expect(await readdir(join(f.root, "state", "first-setup-resolutions"))).toEqual(audits);
});

it("shared Finish rejects a different recovered venue before publication", async () => {
  const f = await finishFixture();
  const before = await f.runtime.store.read();
  f.recover.mockResolvedValue({ ...f.checked.venue, seriesIds: [] });
  await expect(f.finish()).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  expect(await f.runtime.store.read()).toEqual(before);
  expect(f.steps).toEqual([]);
});

it("shared Finish keeps failed publication retryable without activation or another recovery PDF", async () => {
  const f = await finishFixture();
  f.publication.persistTrading.mockRejectedValueOnce(new AppError("setup.not_ready", {}));
  await expect(f.finish()).rejects.toMatchObject({ code: "setup.not_ready" });
  const interrupted = (await f.runtime.store.read())!;
  expect(interrupted.status).toBe("committed");
  f.owner.revision = interrupted.revision;
  await expect(f.finish()).resolves.toEqual(f.checked.venue);
  expect((await f.runtime.store.read())!.status).toBe("complete");
  expect(f.deps.provision).toHaveBeenCalledOnce();
  expect(f.check).toHaveBeenCalledTimes(2);
  expect(await venue.db.execute("select count(*) as count from registro_sif")).toMatchObject({
    rows: [{ count: 1 }],
  });
});

it("shared Finish derives the publication digest only after recovering and checking selection", async () => {
  const f = await finishFixture();
  let derived = 0;
  await expect(
    f.runtime.coordinator.run((hold) =>
      finishFirstSetup(
        f.runtime,
        {
          check: f.check,
          publish: (state, checked, beforeComplete) =>
            publishCheckedFirstSetup(
              f.runtime,
              f.publication,
              state,
              checked,
              f.owner,
              f.digest,
              hold,
              beforeComplete,
            ),
        },
        f.owner,
        (state) => {
          derived++;
          expect(state.ownerGeneration).toBe(f.owner.ownerGeneration);
          return f.digest;
        },
        hold,
      ),
    ),
  ).resolves.toEqual(f.checked.venue);
  expect(derived).toBe(1);
});

it("shared Finish rejects stale ownership before deriving publication secrets", async () => {
  const f = await finishFixture();
  const before = await f.runtime.store.read();
  const digest = vi.fn(() => f.digest);
  await expect(
    f.runtime.coordinator.run((hold) =>
      finishFirstSetup(
        f.runtime,
        { check: f.check, publish: vi.fn() },
        { ...f.owner, revision: f.owner.revision + 1 },
        digest,
        hold,
      ),
    ),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  expect(digest).not.toHaveBeenCalled();
  expect(f.check).not.toHaveBeenCalled();
  expect(await f.runtime.store.read()).toEqual(before);
});

it("shared Finish rejects an ordinary resumed owner even after a password recovery", async () => {
  const f = await finishFixture();
  const resumed = await f.runtime.owner.resumeFirstSetup(f.recoveryNonce, {
    password: PASSWORD,
  });
  const owner = { ...resumed.state, capability: resumed.capability };
  const digest = vi.fn(() => f.digest);
  await expect(
    f.runtime.coordinator.run((hold) =>
      finishFirstSetup(f.runtime, { check: f.check, publish: vi.fn() }, owner, digest, hold),
    ),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  expect(digest).not.toHaveBeenCalled();
  expect(f.check).not.toHaveBeenCalled();
});

it.each(["revision", "ownerGeneration"] as const)(
  "shared Finish refuses an audit snapshot with another %s before publishing",
  async (field) => {
    const f = await finishFixture();
    const capture = f.runtime.resolution.captureFirstSetupOriginals;
    f.runtime.resolution.captureFirstSetupOriginals = async () => {
      const snapshot = await capture();
      return { ...snapshot, inspection: { ...snapshot.inspection, [field]: f.owner[field] - 1 } };
    };
    const before = await f.runtime.store.read();
    await expect(f.finish()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    expect(f.steps).toEqual([]);
    expect(await f.runtime.store.read()).toEqual(before);
  },
);

it("shared Finish completes a lost host result write without a second activation", async () => {
  const f = await fixture();
  f.deps.check.mockRejectedValueOnce(new Error("synthetic lost result read"));
  await expect(f.activate()).rejects.toThrow("synthetic lost result read");
  const before = (await f.runtime.store.read())!;
  expect(before.status).toBe("activation-started");
  const series = await venue.db.execute("select * from invoice_series order by id");
  const inspection = await f.runtime.resolution.inspectFirstSetupResolution();
  const recovered = await f.runtime.owner.recoverFirstSetupOwner({
    inspectionId: inspection.inspectionId,
    revision: before.revision,
    ownerGeneration: before.ownerGeneration,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    password: PASSWORD,
  });
  const owner = { ...recovered.state, capability: recovered.capability };
  const states: string[] = [];
  await f.runtime.resolution.withVenueExclusion(() =>
    f.runtime.coordinator.run((hold) =>
      finishFirstSetup(
        f.runtime,
        {
          check: f.deps.check,
          publish: (state, checked, beforeComplete) => {
            states.push(state.status);
            return publishCheckedFirstSetup(
              f.runtime,
              {
                db: venue.db,
                publishSelection: async () => {},
                publishIdentity: async () => {},
                sealSettings: async () => {},
                persistTrading: async () => {},
              },
              state,
              checked,
              owner,
              f.digest,
              hold,
              beforeComplete,
            );
          },
        },
        owner,
        f.digest,
        hold,
      ),
    ),
  );
  expect(states).toEqual(["committed"]);
  expect((await f.runtime.store.read())!.status).toBe("complete");
  expect(f.deps.provision).toHaveBeenCalledOnce();
  expect(await venue.db.execute("select * from invoice_series order by id")).toEqual(series);
  expect(await venue.db.execute("select count(*) as count from registro_sif")).toMatchObject({
    rows: [{ count: 1 }],
  });
});
