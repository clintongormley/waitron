import { expect, it } from "vitest";
import {
  configureModuleOperations,
  withOperationAuthority,
  type ModuleOperationPreparation,
} from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { createModuleOperationHost } from "./module-operation-host.js";
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

it("the bound runtime retains independent trust after restart and prepares only a fresh owner-confirmed attempt", async () => {
  const { firstFiscalFixture, MODULE, PASSWORD } = await import("../test/first-fiscal.js");
  const { createFirstSetupModuleHost } = await import("./module-operation-host.js");
  const f = await firstFiscalFixture();
  try {
    const make = () =>
      createFirstSetupModuleHost({
        environment: {},
        stateDir: f.stateDir,
        venueDir: f.venueDir,
        modules: f.modules,
      });
    const first = make();
    await first.evidence.enrol(f.ownerAttempt, MODULE, f.key, f.key.fingerprint);
    const token = await first.owner.reconfirm(f.ownerAttempt, PASSWORD, "activation");
    await first.evidence.confirm(f.ownerAttempt, MODULE, f.current, token);
    const attempt = (runtime: ReturnType<typeof make>) =>
      withOperationAuthority(f.context.binding, f.context.administratorId, (authority) =>
        runtime.modules
          .find((m) => m.name === MODULE)!
          .operations!.prepare(
            { binding: f.context.binding, authority, input: f.input },
            async () => "prepared",
          ),
      );
    const restarted = make();
    await expect(attempt(restarted)).rejects.toMatchObject({ code: "sif.allocation_invalid" });
    const fresh = await restarted.owner.reconfirm(f.ownerAttempt, PASSWORD, "activation");
    await restarted.evidence.confirm(f.ownerAttempt, MODULE, f.current, fresh);
    await expect(attempt(restarted)).resolves.toBe("prepared");
    await expect(attempt(restarted)).rejects.toMatchObject({ code: "sif.allocation_invalid" });
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
