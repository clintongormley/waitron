import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import {
  initialSetupFor,
  type WaitronModule,
  type ModuleOperationHost,
  type InitialSetupContribution,
  type InitialSetupContext,
} from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { createFirstSetupRuntime } from "./first-setup-runtime.js";
import { firstSetupModuleContext } from "./first-setup-module-context.js";
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
  vi.useFakeTimers({ toFake: ["Date"] });
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

async function fixture(
  options: {
    modules?: readonly WaitronModule[];
    readRetiredSetup?: ModuleOperationHost["readRetiredSetup"];
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "owned-preparation-"));
  roots.push(root);
  const settings = {
    environment: {},
    stateDir: join(root, "state"),
    venueDir: join(root, "venue"),
    modules: options.modules ?? ALL_MODULES,
    database: () => venue.db,
    readRetiredSetup: options.readRetiredSetup,
  };
  const host = createFirstSetupRuntime(settings);
  const claim = await host.owner.claimFirstSetup(
    { environment: "preproduction", request },
    randomBytes(32).toString("base64url"),
  );
  let owner = { ...claim.state, capability: claim.capability };
  const compare = () =>
    host.preparation.prepare(owner, MODULE, {
      action: "compare-clocks",
      browser: null,
    });
  const select = async (answer = "no", proof?: string) => {
    const result = await host.preparation.select(
      owner,
      MODULE,
      { answer },
      proof ?? (await host.owner.reconfirm(owner, PASSWORD, "block-use")),
    );
    if (result) owner = { ...owner, revision: result.state.revision };
    return result;
  };
  return {
    root,
    host,
    compare,
    select,
    settings,
    get owner() {
      return owner;
    },
  };
}

function opaqueModules(overrides: Partial<InitialSetupContribution> = {}) {
  return ALL_MODULES.map((module) =>
    module.name !== MODULE
      ? module
      : {
          ...module,
          provisioning: {
            ...module.provisioning,
            initialSetup: {
              ...module.provisioning!.initialSetup!,
              configure: undefined,
              preparation: async (_context: InitialSetupContext, proposal: unknown) => proposal,
              candidates: async () => ({ candidate: "olivo-1" }),
              request: (_context: InitialSetupContext, candidate: unknown) => candidate,
              inspect: (_context: InitialSetupContext, input: unknown) => ({
                input,
                summary: null,
              }),
              assignmentKeys: undefined,
              assignmentPositions: undefined,
              ...overrides,
            },
          },
        },
  );
}

it("freezes a password-confirmed real hour request and imports only its matching activation input", async () => {
  const f = await fixture();
  await f.compare();
  await f.select();
  let state = (await f.host.store.read())!;
  expect(state.status).toBe("consumption-intent");
  const context = firstSetupModuleContext(state, MODULE);
  expect(context.request).toMatchObject({
    kind: "waitron-hour-setup",
    status: "selected",
    identity: "06RB",
    input: {
      allocation: {
        installationIdentity: "06RB",
        series: [
          { code: "A-06RB", purpose: "standard" },
          { code: "FF-06RB", purpose: "full" },
          { code: "R-06RB", purpose: "rectificative" },
        ],
      },
    },
  });
  const input = (context.request as { input: unknown }).input;
  await f.host.preparation.import(f.owner, MODULE, input);
  state = (await f.host.store.read())!;
  expect(state.inputs[MODULE]).toEqual(input);
  const journal = JSON.parse(
    await readFile(join(f.root, "state/module-preparation-state.json"), "utf8"),
  );
  expect(journal.revisions[0].value.entries[0].identity).toBe("06RB");
  expect(journal.revisions[0].binding).toEqual(context.binding);
  expect(
    initialSetupFor(f.host.modules, MODULE)!.inspect(
      firstSetupModuleContext(state, MODULE),
      state.inputs[MODULE],
    ).input,
  ).toEqual(input);
});

it("refuses a missing password grant before recording a selected hour", async () => {
  const f = await fixture();
  await f.compare();
  await expect(f.select("no", "invalid-proof")).rejects.toMatchObject({
    code: "setup.owner_required",
  });
  expect((await f.host.store.read())!.status).toBe("claimed");
  await expect(readFile(join(f.root, "state/module-preparation-state.json"))).rejects.toMatchObject(
    { code: "ENOENT" },
  );
  await f.select();
  expect((await f.host.store.read())!.status).toBe("consumption-intent");
});

it("retains an authenticated waiting decision without freezing usable activation input", async () => {
  const f = await fixture();
  await f.compare();
  const pending = f.select("yes");
  await expect(pending).resolves.toMatchObject({
    preparation: { status: "waiting", targetMs: Date.parse("2026-10-16T12:00:00Z") },
  });
  const first = await pending;
  expect(first.preparation).toMatchObject({
    status: "waiting",
    targetMs: Date.parse("2026-10-16T12:00:00Z"),
  });
  const second = await f.select("yes");
  expect(second.preparation).toMatchObject({
    status: "waiting",
    targetMs: Date.parse("2026-10-16T12:00:00Z"),
  });
  const state = (await f.host.store.read())!;
  expect(state.status).toBe("claimed");
  expect(state.consumptionIntent).toBe(false);
  expect(firstSetupModuleContext(state, MODULE).request).toBeNull();
  expect(state.inputs).toEqual({});
});

it("binds preparation to the current owner capability and revision", async () => {
  const f = await fixture();
  await expect(
    f.host.preparation.prepare(
      { ...f.owner, capability: randomBytes(32).toString("base64url") },
      MODULE,
      { action: "selection" },
    ),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  const before = f.owner;
  await f.compare();
  await f.select();
  await expect(
    f.host.preparation.prepare(before, MODULE, { action: "selection" }),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  await expect(
    f.host.preparation.prepare(f.owner, MODULE, { action: "selection" }),
  ).resolves.toMatchObject({ status: "selected", identity: "06RB" });
});

it("refuses uploaded activation material before any owned request exists", async () => {
  const f = await fixture();
  await expect(
    f.host.preparation.import(f.owner, MODULE, { allocation: { installationIdentity: "06RB" } }),
  ).rejects.toMatchObject({ code: "sif.allocation_invalid" });
  expect((await f.host.store.read())!.inputs).toEqual({});
  expect((await f.host.store.read())!.status).toBe("claimed");
});

it("keeps exact input replay read-only and refuses an edited allocation", async () => {
  const f = await fixture();
  await f.compare();
  await f.select();
  const state = (await f.host.store.read())!;
  const input = (firstSetupModuleContext(state, MODULE).request as { input: unknown }).input;
  const imported = await f.host.preparation.import(f.owner, MODULE, input);
  const owner = { ...f.owner, revision: imported.revision };
  await expect(f.host.preparation.import(owner, MODULE, input)).resolves.toEqual(imported);
  await expect(
    f.host.preparation.import(owner, MODULE, { ...(input as object), changed: true }),
  ).rejects.toMatchObject({ code: "sif.allocation_invalid" });
  expect(await f.host.store.read()).toEqual(imported);
});

it("refuses module selection drift before running another preparation", async () => {
  const f = await fixture({ modules: opaqueModules() });
  const changed = createFirstSetupRuntime({
    ...f.settings,
    modules: f.settings.modules.map((module) =>
      module.name === "catalogue" ? { ...module, version: "99.0.0" } : module,
    ),
  });
  await expect(
    changed.preparation.prepare(f.owner, MODULE, { action: "compare-clocks", browser: null }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect((await changed.store.read())!.status).toBe("claimed");
});

it.each([
  { module: "catalogue", code: "setup.request_invalid", params: { field: "body" } },
  {
    module: "missing-module",
    code: "module.operation_invalid",
    params: { module: "missing-module" },
  },
])("refuses preparation for non-offering $module", async ({ module, code, params }) => {
  const f = await fixture();
  for (const result of [
    () => f.host.preparation.prepare(f.owner, module, {}),
    () => f.host.preparation.select(f.owner, module, {}, "unused"),
    () => f.host.preparation.import(f.owner, module, {}),
  ])
    await expect(result()).rejects.toMatchObject({ code, params });
  expect((await f.host.store.read())!.status).toBe("claimed");
});

it("checks retired assignments before freezing or accepting a supplied request", async () => {
  let retired: Awaited<ReturnType<NonNullable<ModuleOperationHost["readRetiredSetup"]>>> = [];
  const f = await fixture({ readRetiredSetup: async () => retired });
  await f.compare();
  await f.select();
  const state = (await f.host.store.read())!;
  const context = firstSetupModuleContext(state, MODULE);
  const input = (context.request as { input: unknown }).input;
  retired = [{ context, input, publicEvidence: [] }];
  await expect(f.host.preparation.import(f.owner, MODULE, input)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect((await f.host.store.read())!.inputs).toEqual({});
});

it("awaits the opaque module before freezing and consumes a grant even when it has no preparation store", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture({
    modules: opaqueModules({
      candidates: async () => {
        await gate;
        return { candidate: "olivo-2" };
      },
    }),
  });
  const proof = await f.host.owner.reconfirm(f.owner, PASSWORD, "block-use");
  const pending = f.select("no", proof);
  expect((await f.host.store.read())!.status).toBe("claimed");
  release();
  await pending;
  expect(firstSetupModuleContext((await f.host.store.read())!, MODULE).request).toEqual({
    candidate: "olivo-2",
  });
  await expect(f.select("no", proof)).rejects.toMatchObject({ code: "setup.attempt_conflict" });
});

it("does not freeze opaque candidates without a valid password grant", async () => {
  const f = await fixture({ modules: opaqueModules() });
  await expect(f.select("no", "invalid")).rejects.toMatchObject({ code: "setup.owner_required" });
  expect(firstSetupModuleContext((await f.host.store.read())!, MODULE).request).toBeNull();
  await f.select();
  expect((await f.host.store.read())!.status).toBe("consumption-intent");
});

it("refuses a module with no interactive preparation callback", async () => {
  const f = await fixture({ modules: opaqueModules({ preparation: undefined }) });
  await expect(f.compare()).rejects.toMatchObject({ code: "setup.request_invalid" });
  expect((await f.host.store.read())!.status).toBe("claimed");
});

it("refuses a conflicting inspected input even when the module accepts both forms", async () => {
  const f = await fixture({ modules: opaqueModules() });
  await f.select();
  const state = await f.host.preparation.import(f.owner, MODULE, { publicValue: "original" });
  const owner = { ...f.owner, revision: state.revision };
  await expect(
    f.host.preparation.import(owner, MODULE, { publicValue: "changed" }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect((await f.host.store.read())!.inputs[MODULE]).toEqual({ publicValue: "original" });
});

it("waits for every offering before recording consumption intent", async () => {
  const modules = opaqueModules();
  const seat = initialSetupFor(modules, MODULE)!;
  const second = {
    ...fakeModule("second-offering", { provisioning: { initialSetup: seat } }),
    tier: "mandatory" as const,
  };
  const f = await fixture({ modules: [...modules, second] });
  await f.select();
  expect((await f.host.store.read())!.status).toBe("claimed");
  const proof = await f.host.owner.reconfirm(f.owner, PASSWORD, "block-use");
  await f.host.preparation.select(f.owner, second.name, {}, proof);
  const state = (await f.host.store.read())!;
  expect(state.status).toBe("consumption-intent");
  expect(
    state.frozen.modules
      .filter((entry) => [MODULE, second.name].includes(entry.module))
      .map((entry) => entry.request),
  ).toEqual([{ candidate: "olivo-1" }, { candidate: "olivo-1" }]);
});

it.each(["key", "position", "retained-key", "retained-position"] as const)(
  "refuses a spent %s before freezing a candidate",
  async (kind) => {
    const modules = opaqueModules({
      assignmentKeys: () => (kind.includes("key") ? ["spent"] : []),
      assignmentPositions: () =>
        kind.includes("position") ? [{ namespace: "same-taxpayer", position: 4 }] : [],
      retainedAssignments: () => ({
        keys: ["spent"],
        positions: [{ namespace: "same-taxpayer", position: 4 }],
      }),
    });
    let retired: Awaited<ReturnType<NonNullable<ModuleOperationHost["readRetiredSetup"]>>> = [];
    const f = await fixture({ modules, readRetiredSetup: async () => retired });
    const context = firstSetupModuleContext((await f.host.store.read())!, MODULE);
    retired = [{ context, input: {}, publicEvidence: kind.startsWith("retained") ? [{}] : [] }];
    await expect(f.select()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    const state = (await f.host.store.read())!;
    expect(state.status).toBe("claimed");
    expect(firstSetupModuleContext(state, MODULE).request).toBeNull();
  },
);

it("accepts a strictly later assignment in its own namespace", async () => {
  const modules = opaqueModules({
    assignmentKeys: (_context: InitialSetupContext, input: unknown) =>
      input == null ? ["new"] : ["old"],
    assignmentPositions: (_context: InitialSetupContext, input: unknown) => [
      { namespace: "same-taxpayer", position: input == null ? 5 : 4 },
    ],
    retainedAssignments: () => ({
      keys: ["old"],
      positions: [
        { namespace: "same-taxpayer", position: 4 },
        { namespace: "another-taxpayer", position: 99 },
      ],
    }),
  });
  let retired: Awaited<ReturnType<NonNullable<ModuleOperationHost["readRetiredSetup"]>>> = [];
  const f = await fixture({ modules, readRetiredSetup: async () => retired });
  retired = [
    {
      context: firstSetupModuleContext((await f.host.store.read())!, MODULE),
      input: {},
      publicEvidence: [{}],
    },
  ];
  await f.select();
  expect((await f.host.store.read())!.status).toBe("consumption-intent");
});

it("reuses an existing owner hold for preparation and candidate selection", async () => {
  const f = await fixture({ modules: opaqueModules() });
  await expect(
    f.host.coordinator.run((hold) =>
      f.host.preparation.prepare(f.owner, MODULE, { publicValue: "checked" }, hold),
    ),
  ).resolves.toEqual({ publicValue: "checked" });
  const proof = await f.host.owner.reconfirm(f.owner, PASSWORD, "block-use");
  const selected = await f.host.coordinator.run((hold) =>
    f.host.preparation.select(f.owner, MODULE, {}, proof, hold),
  );
  const owner = { ...f.owner, revision: selected.state.revision };
  const imported = await f.host.coordinator.run((hold) =>
    f.host.preparation.import(owner, MODULE, { publicValue: "checked" }, hold),
  );
  expect(imported.inputs[MODULE]).toEqual({ publicValue: "checked" });
  await expect(f.host.assertFreshAssignment(imported, "catalogue")).resolves.toBeUndefined();
}, 5000);

it.each([null, "", "x".repeat(65537)])(
  "refuses malformed password grants without freezing a request",
  async (proof) => {
    const f = await fixture({ modules: opaqueModules() });
    await expect(f.host.preparation.select(f.owner, MODULE, {}, proof)).rejects.toMatchObject({
      code: "setup.request_invalid",
    });
    expect((await f.host.store.read())!.status).toBe("claimed");
    expect(firstSetupModuleContext((await f.host.store.read())!, MODULE).request).toBeNull();
  },
);

it.each(["key", "position"])("keeps a prior abandoned attempt's %s spent", async (kind) => {
  const modules = opaqueModules({
    assignmentKeys: (context) => (context.request === null || kind !== "key" ? [] : ["spent"]),
    assignmentPositions: (context) =>
      context.request === null || kind !== "position"
        ? []
        : [{ namespace: "same-taxpayer", position: 4 }],
  });
  const second = {
    ...fakeModule("second-offering", {
      provisioning: { initialSetup: initialSetupFor(modules, MODULE)! },
    }),
    tier: "mandatory" as const,
  };
  const f = await fixture({ modules: [...modules, second] });
  await f.select();
  const before = (await f.host.store.read())!;
  await f.host.store.update(before.frozen.attemptId, before.revision, { kind: "abandoned" });
  const claim = await f.host.owner.claimFirstSetup(
    { environment: "preproduction", request },
    randomBytes(32).toString("base64url"),
  );
  const owner = { ...claim.state, capability: claim.capability };
  const proof = await f.host.owner.reconfirm(owner, PASSWORD, "block-use");
  await expect(f.host.preparation.select(owner, MODULE, {}, proof)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  const after = (await f.host.store.read())!;
  expect(after.status).toBe("claimed");
  expect(after.previous).toHaveLength(1);
  expect(firstSetupModuleContext(after, MODULE).request).toBeNull();
});

it.each(["keys", "positions"])("serves a module that declares only assignment %s", async (kind) => {
  const f = await fixture({
    modules: opaqueModules({
      assignmentKeys: kind === "keys" ? () => ["new"] : undefined,
      assignmentPositions:
        kind === "positions" ? () => [{ namespace: "same-taxpayer", position: 5 }] : undefined,
    }),
  });
  await f.select();
  expect((await f.host.store.read())!.status).toBe("consumption-intent");
});
