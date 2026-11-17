import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readModuleRecord, readSetupFlowRecord } from "@waitron/provisioning";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { createFirstSetupModuleHost, createModuleOperationHost } from "./module-operation-host.js";
import { createFakeTimersHourClock, type HourTestClock } from "./testing/hour-test-clock.js";
import { clockServiceAnswer } from "./testing/synchronised-box-host.js";
import type { BoxHostClient, ClockServiceStatus } from "./box-host-client.js";
import { createFirstSetupCoordinator } from "@waitron/provisioning";
import { createNodeOperationPreparation } from "./node-operation-preparation.js";
import { createSelectedRecoveryPreparation } from "./recovery-preparation.js";
import { timeServiceReader } from "./clock-service-reading.js";
import { bootReader } from "./boot-reader.js";
import type { NodeId } from "@waitron/shared";
const time = vi.hoisted(() => ({
  clock: undefined as unknown as HourTestClock,
  synchronised: true,
}));
const boxHost = vi.hoisted(() => ({
  status: vi.fn<() => Promise<unknown>>(),
}));
vi.mock("./box-host-client.js", async (actual) => ({
  ...(await actual<typeof import("./box-host-client.js")>()),
  boxHostClient: (): BoxHostClient => ({
    clockStatus: () => boxHost.status() as Promise<ClockServiceStatus>,
    setClock: async () => ({ available: false, reason: "missing" }),
  }),
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-time-service.js", () => ({
  observeTimeServiceHourClock: async () =>
    time.synchronised
      ? {
          source: "internet",
          result: "usable",
          instantMs: time.clock.wall(),
          uncertaintyMs: 500,
          wallStartedMs: time.clock.wall(),
          wallFinishedMs: time.clock.wall(),
          monotonicStartedMs: time.clock.monotonic(),
          monotonicFinishedMs: time.clock.monotonic(),
        }
      : { source: "internet", result: "unavailable", reason: "not_synchronised" },
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
const venue = useVenueDb({ migrations: TEST_MIGRATIONS });
afterEach(() => {
  vi.useRealTimers();
  time.synchronised = true;
});
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
  time.clock = createFakeTimersHourClock();
  const f = await hourFirstFiscalFixture({ database: () => venue.db, clock: time.clock });
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
    expect((await readSetupFlowRecord(f.stateDir))?.recoveryManifests?.[f.module]).toMatchObject({
      ...f.staged.ref,
      statement: f.staged.statement,
    });
    expect(await restarted.keys.readStage(f.ownerAttempt)).toEqual(f.staged.stage);
    await expect(attempt(restarted)).rejects.toMatchObject({ code: "setup.not_ready", params: {} });
    const fresh = await restarted.owner.reconfirm(f.ownerAttempt, f.password, "activation");
    await restarted.recoveryDelivery.confirmRecoveryDocumentKept(
      f.ownerAttempt,
      { ...f.staged.ref, kept: true },
      fresh,
    );
    await expect(attempt(restarted)).resolves.toBe("prepared");
    await expect(attempt(restarted)).rejects.toMatchObject({ code: "setup.not_ready", params: {} });
  } finally {
    await f.dispose();
  }
});

it.each([
  ["on the same start of the server", false],
  ["not after the server restarts", true],
])(
  "a device time confirmed through the setup page counts at Provision two minutes later without the time service %s",
  async (_label, restart) => {
    const { createFirstSetupModuleHost } = await import("./module-operation-host.js");
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime("2026-10-16T11:40:00Z");
    time.clock = createFakeTimersHourClock();
    const readBoot = () => ({ id: "box-boot", ms: time.clock.monotonic() + 5_000_000 });
    time.synchronised = false;
    const f = await hourFirstFiscalFixture({
      database: () => venue.db,
      clock: time.clock,
      readBoot,
    });
    try {
      const intents = (await readModuleRecord(f.stateDir, f.module)).prepared.flatMap(
        (revision) =>
          (revision as { value: { entries: { kind: string; boot?: { bootId: string } }[] } }).value
            .entries,
      );
      expect(intents.find((entry) => entry.kind === "intent")?.boot).toMatchObject({
        bootId: expect.stringMatching(/^box-boot /),
        confirmed: true,
      });
      const runtime = restart
        ? createFirstSetupModuleHost({
            environment: {},
            stateDir: f.stateDir,
            venueDir: f.venueDir,
            modules: f.modules,
            database: () => venue.db,
            readBoot,
          })
        : f.host;
      const fresh = await runtime.owner.reconfirm(f.ownerAttempt, f.password, "activation");
      await runtime.recoveryDelivery.confirmRecoveryDocumentKept(
        f.ownerAttempt,
        { ...f.staged.ref, kept: true },
        fresh,
      );
      time.clock.advance(120_000);
      const run = vi.fn(async () => "prepared");
      const attempt = runtime.coordinator.run(async (hold) => {
        await runtime.recoveryDelivery.consume(f.ownerAttempt, f.module, hold);
        return withOperationAuthority(f.context.binding, f.context.administratorId, (authority) =>
          runtime.modules
            .find((m) => m.name === f.module)!
            .operations!.prepare({ binding: f.context.binding, authority, input: f.input }, run),
        );
      });
      if (restart) {
        await expect(attempt).rejects.toMatchObject({
          code: "sif.allocation_invalid",
          params: { reason: "second_clock_missing" },
        });
        expect(run).not.toHaveBeenCalled();
      } else await expect(attempt).resolves.toBe("prepared");
    } finally {
      await f.dispose();
    }
  },
);

it("freezes fresh planned identities and selected module versions before any public candidate export", async () => {
  const { firstFiscalFixture, request, MODULE } = await import("../test/first-fiscal.js");
  const { createFirstSetupModuleHost } = await import("./module-operation-host.js");
  const { join } = await import("node:path");
  const f = await firstFiscalFixture();
  try {
    const host = createFirstSetupModuleHost({
      environment: {},
      modules: f.modules,
      stateDir: join(f.root, "another-state"),
      venueDir: join(f.root, "another-venue"),
    });
    const claimed = await host.owner.claimFirstSetup({ environment: "production", request });
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

it("binds module-declared outside evidence into the inspection", async () => {
  const { createFirstSetupModuleHost } = await import("./module-operation-host.js");
  const { writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime("2026-10-16T11:40:00Z");
  time.clock = createFakeTimersHourClock();
  const f = await hourFirstFiscalFixture({ database: () => venue.db, clock: time.clock });
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
    const inspected = await host.resolution.inspectFirstSetupResolution();
    await writeFile(outside, '{"retained":43}');
    const fresh = await host.resolution.inspectFirstSetupResolution();
    expect(fresh.inspectionId).not.toBe(inspected.inspectionId);
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

describe("every host the server builds asks the box's time service, afresh at each reading, and, for a restore, its boot", () => {
  const binding = {
    module: "captured",
    action: "restore",
    eventId: "event",
    sourceId: "source",
    targetNodeId: "node",
  };
  const capturing = () => {
    const seen: { host?: ModuleOperationHost } = {};
    const module = fakeModule("captured", {
      operations: {
        prepare: async (operation, run) => run(operation),
        configure: (bound) => {
          seen.host = bound;
          return { prepare: async (operation, run) => run(operation) };
        },
      },
    });
    return { module, read: () => seen.host!.timeServiceSynchronised!(), host: () => seen.host! };
  };
  let scratch: string;
  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), "time-service-host-"));
    boxHost.status.mockReset();
  });
  afterEach(() => rm(scratch, { recursive: true, force: true }));
  const builders = {
    "the first setup's": (module: ReturnType<typeof capturing>["module"]) =>
      createFirstSetupModuleHost({
        environment: {},
        stateDir: join(scratch, "state"),
        venueDir: join(scratch, "venue"),
        modules: [module],
      }),
    "a live operation's (handover, conflict switch, promotion)": (
      module: ReturnType<typeof capturing>["module"],
    ) =>
      createNodeOperationPreparation({
        stateDir: join(scratch, "state"),
        venueDir: join(scratch, "venue"),
        db: venue.db,
        nodeDb: venue.node,
        node: { nodeId: "node" as NodeId },
        modules: [module],
        coordinator: createFirstSetupCoordinator(),
        environment: {},
      }),
    "a restore's (its page, its start and the restore command)": (
      module: ReturnType<typeof capturing>["module"],
      readBoot?: ModuleOperationHost["readBoot"],
    ) =>
      createSelectedRecoveryPreparation({
        stateDir: join(scratch, "state"),
        venueDir: join(scratch, "venue"),
        coordinator: createFirstSetupCoordinator(),
        modules: [module],
        binding,
        node: { nodeId: "node" as NodeId },
        secret: "secret",
        database: () => venue.db,
        nodeDatabase: () => venue.node,
        selected: {} as Parameters<typeof createSelectedRecoveryPreparation>[0]["selected"],
        readIsolation: async () => ({
          oldMachineAbsent: false,
          oldMachineOffline: true,
          noParallelRecovery: true,
        }),
        readBoot,
      }),
  };
  it.each(Object.entries(builders))("%s host reads the box's host service", async (_, build) => {
    const { module, read } = capturing();
    build(module);
    boxHost.status.mockResolvedValueOnce(clockServiceAnswer(true));
    expect(await read()).toBe(true);
    boxHost.status.mockResolvedValueOnce(clockServiceAnswer(false));
    expect(await read()).toBe(false);
    expect(boxHost.status).toHaveBeenCalledTimes(2);
  });
  it.each(Object.entries(builders))(
    "%s host answers not synchronised when the host service fails",
    async (_, build) => {
      const { module, read } = capturing();
      build(module);
      boxHost.status.mockResolvedValueOnce({ available: false, reason: "missing" });
      expect(await read()).toBe(false);
      boxHost.status.mockRejectedValueOnce(new Error("socket gone"));
      expect(await read()).toBe(false);
    },
  );
  it("a restore's host reads the box's boot by default", () => {
    const { module, host } = capturing();
    builders["a restore's (its page, its start and the restore command)"](module);
    const boot = host().readBoot!();
    expect(boot.id).toBe(bootReader().readBoot().id);
    expect(Number.isFinite(boot.ms)).toBe(true);
  });
  it("the first setup's host reads the box's boot", () => {
    const { module, host } = capturing();
    builders["the first setup's"](module);
    const boot = host().readBoot!();
    expect(boot.id?.split(" ")[0] ?? null).toBe(bootReader().readBoot().id);
    expect(Number.isFinite(boot.ms)).toBe(true);
  });
  it("the first setup's host handed a boot reader answers its uptime under an id each start of the server renews", () => {
    const reading = { id: "handed-boot", ms: 4321 };
    const started = () => {
      const { module, host } = capturing();
      createFirstSetupModuleHost({
        environment: {},
        stateDir: join(scratch, "state"),
        venueDir: join(scratch, "venue"),
        modules: [module],
        readBoot: () => reading,
      });
      return host();
    };
    const first = started();
    const again = started();
    expect(first.readBoot!()).toEqual({ ms: 4321, id: expect.stringMatching(/^handed-boot \S+$/) });
    expect(first.readBoot!()).toEqual(first.readBoot!());
    expect(again.readBoot!().id).not.toBe(first.readBoot!().id);
    reading.id = null as unknown as string;
    expect(first.readBoot!()).toEqual({ ms: 4321, id: null });
  });
  it("a restore's host handed a boot reader answers that reader's reading", () => {
    const { module, host } = capturing();
    const reading = { id: "handed-boot", ms: 4321 };
    builders["a restore's (its page, its start and the restore command)"](module, () => reading);
    expect(host().readBoot!()).toEqual(reading);
  });
  it("a host handed a reader asks that reader, not the default host service", async () => {
    const { module, read } = capturing();
    const handed = { clockStatus: vi.fn(async () => clockServiceAnswer(true)) };
    createFirstSetupModuleHost({
      environment: {},
      stateDir: join(scratch, "state"),
      venueDir: join(scratch, "venue"),
      modules: [module],
      timeServiceSynchronised: timeServiceReader(handed),
    });
    expect(await read()).toBe(true);
    expect(await read()).toBe(true);
    expect(handed.clockStatus).toHaveBeenCalledTimes(2);
    expect(boxHost.status).not.toHaveBeenCalled();
  });
});
