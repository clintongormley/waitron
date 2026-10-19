import { afterEach, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { hourFirstFiscalFixture } from "../test/hour-first-fiscal.js";
import {
  configureModuleOperations,
  withOperationAuthority,
  type ModuleOperationHost,
  type ModuleOperationPreparation,
} from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { createModuleOperationHost } from "./module-operation-host.js";
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => {
    const now = Date.now(),
      mono = performance.now();
    return {
      source: "internet",
      result: "usable",
      instantMs: now,
      uncertaintyMs: 500,
      wallStartedMs: now,
      wallFinishedMs: now,
      monotonicStartedMs: mono,
      monotonicFinishedMs: mono,
    };
  },
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
const venue = useVenueDb({ migrations: TEST_MIGRATIONS });
afterEach(() => vi.useRealTimers());
it("takes an immutable environment snapshot and configures module copies without changing an already prepared seat", async () => {
  const env = { SENTINEL: "passed" };
  const host = createModuleOperationHost(env);
  env.SENTINEL = "later";
  const plain = fakeModule("plain");
  const original: ModuleOperationPreparation = {
    prepare: async (operation, run) => run(operation),
    configure: (bound) => ({
      prepare: async (operation, run) => run({ ...operation, input: bound.environment.SENTINEL }),
    }),
  };
  const modules = [plain, fakeModule("configured", { operations: original })];
  const configured = configureModuleOperations(modules, host);
  expect(configured[0]).toBe(plain);
  expect(configured[1]).not.toBe(modules[1]);
  expect(modules[1]!.operations).toBe(original);
  const binding = {
    module: "configured",
    action: "setup",
    eventId: "event",
    sourceId: "source",
    targetNodeId: "node",
  };
  await withOperationAuthority(binding, "admin", async (authority) => {
    expect(
      await configured[1]!.operations!.prepare(
        { binding, authority, input: {} },
        async (operation) => operation.input,
      ),
    ).toBe("passed");
    expect(await host.readPublicEvidence(binding)).toBeUndefined();
  });
});

it("the bound runtime retains its recovery document after restart and prepares only a fresh owner-confirmed attempt", async () => {
  const { createFirstSetupModuleHost } = await import("./module-operation-host.js");
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime("2026-10-16T11:40:00Z");
  const f = await hourFirstFiscalFixture({ database: () => venue.db });
  try {
    const make = () =>
      createFirstSetupModuleHost({
        environment: {},
        stateDir: f.stateDir,
        venueDir: f.venueDir,
        modules: f.modules,
        database: () => venue.db,
      });
    const attempt = (runtime: ReturnType<typeof make>) =>
      runtime.coordinator.run(async (hold) => {
        await runtime.recoveryDelivery.consume(f.ownerAttempt, f.module, hold);
        return withOperationAuthority(f.context.binding, f.context.administratorId, (authority) =>
          runtime.modules
            .find((m) => m.name === f.module)!
            .operations!.prepare(
              { binding: f.context.binding, authority, input: f.input },
              async () => "prepared",
            ),
        );
      });
    const restarted = make();
    expect(await restarted.recoveryDelivery.readRecoveryDocument(f.ownerAttempt, f.module)).toEqual(
      { ...f.staged.ref, statement: f.staged.statement },
    );
    expect(await restarted.keys.readStage(f.ownerAttempt)).toEqual(f.staged.stage);
    await expect(attempt(restarted)).rejects.toMatchObject({ code: "setup.not_ready", params: {} });
    const fresh = await restarted.owner.reconfirm(f.ownerAttempt, f.password, "activation");
    await restarted.recoveryDelivery.confirmRecoveryDocumentKept(
      f.ownerAttempt,
      { ...f.staged.ref, kept: true },
      fresh,
    );
    await expect(attempt(restarted)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "clock_stale" },
    });
    await restarted.preparation.prepare(f.ownerAttempt, f.module, {
      action: "compare-clocks",
      browser: null,
    });
    await restarted.recoveryDelivery.confirmRecoveryDocumentKept(
      f.ownerAttempt,
      { ...f.staged.ref, kept: true },
      await restarted.owner.reconfirm(f.ownerAttempt, f.password, "activation"),
    );
    await expect(attempt(restarted)).resolves.toBe("prepared");
    await expect(attempt(restarted)).rejects.toMatchObject({ code: "setup.not_ready", params: {} });
  } finally {
    await f.dispose();
  }
});

it("freezes fresh planned identities and selected module versions before any public candidate export", async () => {
  const { firstFiscalFixture, request, MODULE } = await import("../test/first-fiscal.js");
  const { createFirstSetupModuleHost } = await import("./module-operation-host.js");
  const { randomBytes } = await import("node:crypto");
  const { join } = await import("node:path");
  const f = await firstFiscalFixture();
  try {
    const host = createFirstSetupModuleHost({
      environment: {},
      modules: f.modules,
      stateDir: join(f.root, "another-state"),
      venueDir: join(f.root, "another-venue"),
    });
    const claimed = await host.owner.claimFirstSetup(
      { environment: "production", request },
      randomBytes(32).toString("base64url"),
    );
    const state = (await host.store.read())!;
    expect(state.frozen.modules).toContainEqual({
      module: "core",
      version: "0.0.0",
      eventId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      request: null,
    });
    expect(state.frozen.modules.some((entry) => entry.module === "fiscal-none")).toBe(false);
    expect(state.frozen.modules.filter((entry) => entry.module === MODULE)).toEqual([
      {
        module: MODULE,
        version: "0.0.0",
        eventId: expect.stringMatching(/^[a-f0-9-]{36}$/),
        request: null,
      },
    ]);
    expect(state.frozen.sourceId).toBe(`first-setup:${claimed.state.attemptId}`);
    expect(state.frozen.nodeId).toBe(claimed.state.nodeId);
    expect(state.frozen.administratorId).toBe(claimed.state.administratorId);
    expect(state.frozen.request.admin.email).toBe("elena@example.test");
  } finally {
    await f.dispose();
  }
});

it("binds module-declared outside evidence and rejects prior password and document grants after ownership recovery", async () => {
  const { createFirstSetupModuleHost } = await import("./module-operation-host.js");
  const { writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { randomBytes } = await import("node:crypto");
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime("2026-10-16T11:40:00Z");
  const f = await hourFirstFiscalFixture({ database: () => venue.db });
  try {
    const outside = join(f.root, "retained-history.json");
    await writeFile(outside, '{"retained":42}');
    const host = createFirstSetupModuleHost({
      ...f,
      database: () => venue.db,
      environment: {},
      modules: f.modules.map((module) => {
        if (module.name !== f.module) return module;
        const setup = module.provisioning!.initialSetup!;
        return {
          ...module,
          provisioning: {
            ...module.provisioning,
            initialSetup: {
              ...setup,
              configure: (bound: ModuleOperationHost) => ({
                ...setup.configure!(bound),
                resolutionEvidence: () => ({ files: [outside], directories: [] }),
              }),
            },
          },
        };
      }),
    });
    await host.recoveryDelivery.confirmRecoveryDocumentKept(
      f.ownerAttempt,
      { ...f.staged.ref, kept: true },
      await host.owner.reconfirm(f.ownerAttempt, f.password, "activation"),
    );
    await expect(host.recoveryDelivery.checkKept(f.ownerAttempt, f.module)).resolves.toMatch(
      /^[a-f0-9]{64}$/,
    );
    const grant = await host.owner.reconfirm(f.ownerAttempt, f.password, "activation");
    const inspected = await host.resolution.inspectFirstSetupResolution();
    await writeFile(outside, '{"retained":43}');
    const fresh = await host.resolution.inspectFirstSetupResolution();
    expect(fresh.inspectionId).not.toBe(inspected.inspectionId);
    const recovered = await host.owner.recoverFirstSetupOwner({
      inspectionId: fresh.inspectionId,
      revision: fresh.revision!,
      ownerGeneration: fresh.ownerGeneration!,
      password: f.password,
      clientClaimNonce: randomBytes(32).toString("base64url"),
    });
    const owner = { ...recovered.state, capability: recovered.capability };
    await expect(
      host.owner.consumeReconfirmation(owner, grant, "activation"),
    ).rejects.toMatchObject({ code: "setup.owner_required" });
    await expect(host.recoveryDelivery.consume(owner, f.module)).rejects.toMatchObject({
      code: "setup.not_ready",
      params: {},
    });
    await expect(
      host.keys.stageInitialNodeKey(
        owner,
        await host.owner.reconfirm(owner, f.password, "block-use"),
      ),
    ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  } finally {
    await f.dispose();
  }
});

it.each(["restore", "promote", "reserve", "establish"])(
  "the first-setup evidence host leaves ordinary %s to its configured outside source",
  async (action) => {
    const { declaredFirstFiscalFixture } = await import("../test/declared-first-fiscal.js");
    const { createFirstSetupModuleHost } = await import("./module-operation-host.js");
    const f = await declaredFirstFiscalFixture();
    try {
      const host = createFirstSetupModuleHost({
        stateDir: f.stateDir,
        venueDir: f.venueDir,
        modules: f.modules,
        environment: {},
      });
      expect(
        await host.evidence.read({ ...f.context.binding, action, sourceId: "normal-operation" }),
      ).toBeUndefined();
      await expect(host.evidence.read(f.context.binding)).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "outside_confirmation_missing" },
      });
    } finally {
      await f.dispose();
    }
  },
);

it("exposes the configured opaque preparation store to a module without interpreting its value", async () => {
  let retained: unknown = null;
  const host = createModuleOperationHost(
    {},
    {
      read: async () => undefined,
      withPreparationState: async (_binding, run) =>
        run({
          get history() {
            return retained === null ? [] : [retained];
          },
          get value() {
            return retained;
          },
          async replace(value) {
            retained = value;
          },
        }),
    },
  );
  const binding = {
    module: "example",
    action: "setup",
    eventId: "event",
    sourceId: "source",
    targetNodeId: "node",
  };
  await host.withPreparationState!(binding, async (state) => {
    await state.replace({ public: "opaque" });
  });
  expect(retained).toEqual({ public: "opaque" });
});
