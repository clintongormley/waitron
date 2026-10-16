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

it("binds configured outside evidence and invalidates every live confirmation after snapshot recovery", async () => {
  const { declaredFirstFiscalFixture, publicDigest } =
    await import("../test/declared-first-fiscal.js");
  const { createFirstSetupModuleHost } = await import("./module-operation-host.js");
  const { writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { randomBytes } = await import("node:crypto");
  const f = await declaredFirstFiscalFixture();
  try {
    const outside = join(f.root, "retained-history.json");
    await writeFile(outside, '{"retained":42}');
    const host = createFirstSetupModuleHost({
      ...f,
      environment: { WAITRON_FISCAL_PAPER_HISTORY_FILE: outside },
    });
    const staged = await host.keys.stageInitialNodeKey(
      f.ownerAttempt,
      await host.owner.reconfirm(f.ownerAttempt, f.password, "block-use"),
    );
    const input = {
      module: f.module,
      stageId: staged.stage.stageId,
      inputDigest: publicDigest(f.input),
      historyDigest: f.statement.delivery.historyDigest,
      documentDigest: f.statement.delivery.documentDigest,
      statement: f.statement,
    };
    await host.delivery.registerFirstFiscalDelivery(f.ownerAttempt, input);
    const { statement: _statement, ...reference } = input;
    void _statement;
    await host.delivery.confirmFirstFiscalDocumentKept(
      f.ownerAttempt,
      { ...reference, kept: true },
      await host.owner.reconfirm(f.ownerAttempt, f.password, "activation"),
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
    await expect(host.delivery.read(f.context.binding)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
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
