import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { ModuleOperationHost, OperationBinding } from "@waitron/module";
import { createFirstSetupCoordinator } from "./first-setup-state.js";
import * as hosts from "./recovery-preparation-host.js";
import { createModuleOperationHost } from "./first-setup-runtime.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const binding: OperationBinding = {
  module: "test-module",
  action: "restore",
  eventId: "event",
  sourceId: "selected-copy",
  targetNodeId: "node",
};
const facts = {
  country: "ES",
  taxId: "89890001K",
  environment: "preproduction" as const,
  bases: [{ code: "A", purpose: "standard" }],
  contextKey: "copy/key/context",
  history: [],
  oldMachineOffline: true,
  oldMachineAbsent: false,
  noParallelRecovery: true,
  priorActivation: "none" as const,
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "recovery-preparation-"));
  roots.push(root);
  const stateDir = join(root, "state"),
    venueDir = join(root, "venue");
  await mkdir(stateDir);
  await mkdir(venueDir);
  let authorized = true;
  const options = {
    stateDir,
    venueDir,
    coordinator: createFirstSetupCoordinator(),
    authorize: async () => {
      if (!authorized) throw new Error("authority expired");
    },
    withVenueExclusion: async <T>(run: () => Promise<T>) => run(),
    readRecoveryFacts: async (_binding: OperationBinding, check: () => void) => {
      check();
      return structuredClone(facts);
    },
  };
  const make = () => hosts.createRecoveryPreparationHost(options);
  return {
    host: make(),
    make,
    options,
    expire: () => {
      authorized = false;
    },
  };
}
it("reads recovery facts only inside the same active durable state callback", async () => {
  const f = await fixture();
  await expect(f.host.readRecoveryFacts(binding)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  await f.host.withPreparationState(binding, async () => {
    expect(await f.host.readRecoveryFacts(binding)).toEqual(facts);
    await expect(
      f.host.readRecoveryFacts({ ...binding, sourceId: "other-copy" }),
    ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  });
  await expect(f.host.readRecoveryFacts(binding)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
});
it("reopens the shared journal after a new recovery host is constructed", async () => {
  const f = await fixture();
  await f.host.withPreparationState(binding, (state) =>
    state.replace({ publicIntent: "spent-hour" }),
  );
  const next = f.make();
  await next.withPreparationState(binding, async (state) => {
    expect(state.value).toEqual({ publicIntent: "spent-hour" });
    expect(state.history).toEqual([{ publicIntent: "spent-hour" }]);
  });
});
it("rechecks authority before a recovery intent can become durable", async () => {
  const f = await fixture();
  await expect(
    f.host.withPreparationState(binding, async (state) => {
      f.expire();
      await state.replace({ publicIntent: "forbidden" });
    }),
  ).rejects.toThrow("authority expired");
});
it("rejects fact reads whose callback completes after the state scope closes", async () => {
  const f = await fixture();
  let escaped:
    | (() => Promise<Awaited<ReturnType<NonNullable<ModuleOperationHost["readRecoveryFacts"]>>>>)
    | undefined;
  await f.host.withPreparationState(binding, async () => {
    escaped = () => f.host.readRecoveryFacts(binding);
  });
  await expect(escaped!()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
});

it("re-enters an existing shared hold instead of queuing behind itself", async () => {
  const f = await fixture();
  await f.options.coordinator.run(async (hold) => {
    const host = hosts.createRecoveryPreparationHost({ ...f.options, currentHold: () => hold });
    await host.withPreparationState(binding, async (state) => {
      expect(await host.readRecoveryFacts(binding)).toEqual(facts);
      await state.replace({ retained: true });
    });
  });
  await f.host.withPreparationState(binding, async (state) => {
    expect(state.value).toEqual({ retained: true });
  });
});

it("rejects an asynchronous read that outlives the state callback", async () => {
  const f = await fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const host = hosts.createRecoveryPreparationHost({
    ...f.options,
    readRecoveryFacts: async () => {
      await gate;
      return facts;
    },
  });
  let pending!: Promise<unknown>;
  await host.withPreparationState(binding, async () => {
    pending = host.readRecoveryFacts(binding);
  });
  release();
  await expect(pending).rejects.toMatchObject({ code: "setup.attempt_conflict" });
});

it("creates a recovery host without an outside-evidence reader", async () => {
  const f = await fixture();
  const host = createModuleOperationHost({}, f.host);
  await expect(host.readPublicEvidence(binding)).resolves.toBeUndefined();
  await host.withPreparationState!(binding, async () => {
    expect(await host.readRecoveryFacts!(binding)).toEqual(facts);
  });
});
