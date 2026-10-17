import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InitialSetupContribution, WaitronModule, ModuleOperationHost } from "@waitron/module";
import { ALL_MODULES } from "@waitron/composition";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { createFirstSetupRuntime } from "./first-setup-runtime.js";
import { firstSetupModuleContext } from "./first-setup-module-context.js";
import { prepareFirstSetupCommand, resumeFirstSetupCommand } from "./first-setup-command.js";
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
  answer = "no",
  password = PASSWORD,
  modules: readonly WaitronModule[] = ALL_MODULES,
  readRetiredSetup?: ModuleOperationHost["readRetiredSetup"],
) {
  const root = await mkdtemp(join(tmpdir(), "setup-command-"));
  roots.push(root);
  const runtime = createFirstSetupRuntime({
    environment: {},
    stateDir: join(root, "state"),
    venueDir: join(root, "venue"),
    modules,
    database: () => venue.db,
    readRetiredSetup,
  });
  const claim = await runtime.owner.claimFirstSetup(
    { environment: "preproduction", request },
    randomBytes(32).toString("base64url"),
  );
  const owner = { ...claim.state, capability: claim.capability };
  const output: string[] = [];
  const prompts: string[] = [];
  const io = {
    stdout: (line: string) => {
      output.push(line);
    },
    stderr: (line: string) => {
      output.push(line);
    },
    prompt: async (question: string) => {
      prompts.push(question);
      return answer;
    },
    promptSecret: async (question: string) => {
      prompts.push(question);
      return password;
    },
    clearScreen() {},
  };
  return { root, runtime, owner, output, prompts, io };
}

it("prepares a real owned hour from terminal answers without activating a venue", async () => {
  const f = await fixture();
  const result = await prepareFirstSetupCommand(f.runtime, f.owner, f.io);
  expect(result.status).toBe("ready");
  const state = (await f.runtime.store.read())!;
  expect(state.status).toBe("consumption-intent");
  expect(state.frozen.modules.find((entry) => entry.module === MODULE)!.request).toMatchObject({
    kind: "waitron-hour-setup",
    status: "selected",
    identity: "06RB",
  });
  expect(state.inputs[MODULE]).toMatchObject({
    allocation: {
      installationIdentity: "06RB",
      series: [
        { code: "A-06RB", purpose: "standard" },
        { code: "FF-06RB", purpose: "full" },
        { code: "R-06RB", purpose: "rectificative" },
      ],
    },
  });
  const journal = JSON.parse(
    await readFile(join(f.root, "state/module-preparation-state.json"), "utf8"),
  );
  expect(journal.revisions.at(-1).value.entries[0].identity).toBe("06RB");
  expect(await venue.db.execute("select count(*) as count from registro_sif")).toMatchObject({
    rows: [{ count: 0 }],
  });
  expect(await venue.db.execute("select count(*) as count from tenants")).toMatchObject({
    rows: [{ count: 0 }],
  });
  expect(f.prompts).toEqual([
    "Has anyone set up a Waitron box for this business in the last hour? [no/yes/unknown]: ",
    "Confirm setup password: ",
  ]);
  expect(f.output.join("\n")).toContain("every venue using this taxpayer's NIF");
  expect(f.output.join("\n")).not.toContain(PASSWORD);
});

it.each(["yes", "unknown"])(
  "retains a %s wait without exposing an activation input",
  async (answer) => {
    const f = await fixture(answer);
    const result = await prepareFirstSetupCommand(f.runtime, f.owner, f.io);
    expect(result.status).toBe("waiting");
    expect(result.state.status).toBe("claimed");
    expect(result.state.inputs).toEqual({});
    expect(
      result.state.frozen.modules.find((entry) => entry.module === MODULE)!.request,
    ).toBeNull();
    const journal = JSON.parse(
      await readFile(join(f.root, "state/module-preparation-state.json"), "utf8"),
    );
    expect(journal.revisions.at(-1).value.entries).toMatchObject([
      { kind: "wait", answer, targetMs: Date.parse("2026-10-16T12:00:00Z") },
    ]);
    expect(f.output.join("\n")).toContain("2026-10-16T12:00:00.000Z");
    expect(f.output.join("\n")).toContain("does not reserve a separate hour");
  },
);

it("requires an explicit check of the displayed clock when internet comparison is unavailable", async () => {
  const f = await fixture();
  external.internet.mockResolvedValue({ source: "internet", result: "unavailable", reason: "tls" });
  f.io.prompt = async (question) => {
    f.prompts.push(question);
    return question.startsWith("The box") ? "yes" : "no";
  };
  const result = await prepareFirstSetupCommand(f.runtime, f.owner, f.io);
  expect(result.status).toBe("ready");
  expect(result.state.inputs[MODULE]).toMatchObject({
    allocation: { installationIdentity: "06RB" },
  });
  expect(f.output.join("\n")).toContain("2026-10-16T11:40:00.000Z");
  expect(f.output.join("\n")).toContain("internet: unavailable");
  expect(f.output.join("\n")).toContain("wrong time can reuse invoice names");
  expect(f.prompts[0]).toBe("The box's displayed date and time are correct? [y/N]: ");
});

it("stops before spending an hour when the clock confirmation is declined", async () => {
  const f = await fixture("no");
  external.internet.mockResolvedValue({ source: "internet", result: "unavailable", reason: "tls" });
  const result = await prepareFirstSetupCommand(f.runtime, f.owner, f.io);
  expect(result.status).toBe("cancelled");
  expect(result.state.status).toBe("claimed");
  expect(result.state.inputs).toEqual({});
  expect(f.prompts).toEqual(["The box's displayed date and time are correct? [y/N]: "]);
  await expect(readFile(join(f.root, "state/module-preparation-state.json"))).rejects.toMatchObject(
    { code: "ENOENT" },
  );
});

it.each(["", "maybe"])(
  "cancels an absent or unrecognised taxpayer answer (%j) without spending",
  async (answer) => {
    const f = await fixture(answer);
    const result = await prepareFirstSetupCommand(f.runtime, f.owner, f.io);
    expect(result.status).toBe("cancelled");
    expect(result.state.status).toBe("claimed");
    expect(f.prompts).toHaveLength(1);
    await expect(
      readFile(join(f.root, "state/module-preparation-state.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("accepts the explicitly entered taxpayer answer independent of whitespace or case", async () => {
  const f = await fixture(" NO ");
  const result = await prepareFirstSetupCommand(f.runtime, f.owner, f.io);
  expect(result.status).toBe("ready");
  expect(result.state.inputs[MODULE]).toMatchObject({
    allocation: { installationIdentity: "06RB" },
  });
});

it("rejects a wrong password before persisting a selected hour", async () => {
  const f = await fixture("no", "wrong-synthetic-password");
  await expect(prepareFirstSetupCommand(f.runtime, f.owner, f.io)).rejects.toMatchObject({
    code: "setup.owner_required",
  });
  expect((await f.runtime.store.read())!.status).toBe("claimed");
  await expect(readFile(join(f.root, "state/module-preparation-state.json"))).rejects.toMatchObject(
    { code: "ENOENT" },
  );
});

it("reuses the exact prepared state without another question or another spent hour", async () => {
  const f = await fixture();
  const first = await prepareFirstSetupCommand(f.runtime, f.owner, f.io);
  const before = await readFile(join(f.root, "state/module-preparation-state.json"));
  f.prompts.splice(0);
  const again = await prepareFirstSetupCommand(f.runtime, first.owner, f.io);
  expect(again).toEqual(first);
  expect(f.prompts).toEqual([]);
  expect(await readFile(join(f.root, "state/module-preparation-state.json"))).toEqual(before);
});

it("imports an already selected request without selecting another hour", async () => {
  const f = await fixture();
  await f.runtime.preparation.prepare(f.owner, MODULE, { action: "compare-clocks", browser: null });
  const proof = await f.runtime.owner.reconfirm(f.owner, PASSWORD, "block-use");
  const selected = await f.runtime.preparation.select(f.owner, MODULE, { answer: "no" }, proof);
  const before = await readFile(join(f.root, "state/module-preparation-state.json"));
  const result = await prepareFirstSetupCommand(
    f.runtime,
    { ...f.owner, revision: selected.state.revision },
    f.io,
  );
  expect(result.status).toBe("ready");
  expect(result.state.inputs[MODULE]).toMatchObject({
    allocation: { installationIdentity: "06RB" },
  });
  expect(f.prompts).toEqual([]);
  expect(await readFile(join(f.root, "state/module-preparation-state.json"))).toEqual(before);
});

it("rejects changed module versions even on an already imported request", async () => {
  const f = await fixture();
  const first = await prepareFirstSetupCommand(f.runtime, f.owner, f.io);
  const changed = createFirstSetupRuntime({
    environment: {},
    stateDir: join(f.root, "state"),
    venueDir: join(f.root, "venue"),
    modules: ALL_MODULES.map((module) =>
      module.name === "catalogue" ? { ...module, version: "99.0.0" } : module,
    ),
    database: () => venue.db,
  });
  await expect(prepareFirstSetupCommand(changed, first.owner, f.io)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(await f.runtime.store.read()).toEqual(first.state);
});

it("does not report preparation ready after activation has started", async () => {
  const f = await fixture();
  const first = await prepareFirstSetupCommand(f.runtime, f.owner, f.io);
  const state = await f.runtime.store.update(first.owner.attemptId, first.state.revision, {
    kind: "activation-started",
  });
  await expect(
    prepareFirstSetupCommand(f.runtime, { ...first.owner, revision: state.revision }, f.io),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await f.runtime.store.read()).toEqual(state);
});

it("does not return a stale cancelled owner after another password recovery", async () => {
  const f = await fixture("");
  f.io.prompt = async () => {
    await f.runtime.owner.recoverFirstSetup(randomBytes(32).toString("base64url"), {
      password: PASSWORD,
    });
    return "";
  };
  await expect(prepareFirstSetupCommand(f.runtime, f.owner, f.io)).rejects.toMatchObject({
    code: "setup.owner_required",
  });
  expect((await f.runtime.store.read())!.status).toBe("claimed");
  expect((await f.runtime.store.read())!.ownerGeneration).toBe(2);
});

it("refuses a corrected box clock while the operator is answering", async () => {
  const f = await fixture();
  f.io.promptSecret = async () => {
    vi.setSystemTime(NOW + 5_000);
    return PASSWORD;
  };
  await expect(prepareFirstSetupCommand(f.runtime, f.owner, f.io)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "clock_corrected" },
  });
  expect((await f.runtime.store.read())!.status).toBe("claimed");
  await expect(readFile(join(f.root, "state/module-preparation-state.json"))).rejects.toMatchObject(
    { code: "ENOENT" },
  );
});

function twoCommandModules() {
  const base = ALL_MODULES.find((module) => module.name === MODULE)!.provisioning!.initialSetup!;
  return ALL_MODULES.map((module) => {
    if (![MODULE, "catalogue"].includes(module.name)) return module;
    const seat: InitialSetupContribution = {
      ...base,
      configure: undefined,
      assignmentKeys: undefined,
      assignmentPositions: undefined,
      async command(context, actions) {
        const input = context.request ?? (await actions.select({ choice: module.name }));
        return { status: "ready", input };
      },
      candidates: async (_context, proposal) => structuredClone(proposal),
      request: (_context, candidate) => candidate,
      inspect: (_context, input) => ({ input, summary: null }),
    };
    return { ...module, provisioning: { ...module.provisioning, initialSetup: seat } };
  });
}

it("selects every contributing module before importing any activation input", async () => {
  const f = await fixture("no", PASSWORD, twoCommandModules());
  const result = await prepareFirstSetupCommand(f.runtime, f.owner, f.io);
  expect(result.status).toBe("ready");
  expect(result.state.status).toBe("consumption-intent");
  expect(result.state.inputs).toEqual({
    catalogue: { choice: "catalogue" },
    [MODULE]: { choice: MODULE },
  });
  expect(result.state.history.map((event) => event.kind)).toEqual([
    "claim",
    "candidates",
    "candidates",
    "consumption-intent",
    "import",
    "import",
  ]);
  expect(f.prompts).toEqual(["Confirm setup password: ", "Confirm setup password: "]);
});

it("waits for a new comparison when valid observations straddle a UTC-hour boundary", async () => {
  const f = await fixture();
  vi.setSystemTime(Date.parse("2026-10-16T11:59:59.900Z"));
  external.internet.mockImplementation(async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 500,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }));
  const result = await prepareFirstSetupCommand(f.runtime, f.owner, f.io);
  expect(result.status).toBe("waiting");
  expect(result.state.status).toBe("claimed");
  expect(f.output.join("\n")).toContain("UTC-hour boundary");
  expect(f.prompts).toEqual([]);
  await expect(readFile(join(f.root, "state/module-preparation-state.json"))).rejects.toMatchObject(
    { code: "ENOENT" },
  );
});

it("preflights every command contribution before asking for any password or selecting material", async () => {
  const modules = twoCommandModules().map((module) =>
    module.name === MODULE
      ? {
          ...module,
          provisioning: {
            ...module.provisioning,
            initialSetup: { ...module.provisioning!.initialSetup!, command: undefined },
          },
        }
      : module,
  );
  const f = await fixture("no", PASSWORD, modules);
  const before = await f.runtime.store.read();
  await expect(prepareFirstSetupCommand(f.runtime, f.owner, f.io)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  expect(await f.runtime.store.read()).toEqual(before);
  expect(f.prompts).toEqual([]);
});

it("rechecks retired assignment floors before returning an already imported request", async () => {
  let retired: Awaited<ReturnType<NonNullable<ModuleOperationHost["readRetiredSetup"]>>> = [];
  const f = await fixture("no", PASSWORD, ALL_MODULES, async () => retired);
  const first = await prepareFirstSetupCommand(f.runtime, f.owner, f.io);
  retired = [
    {
      context: firstSetupModuleContext(first.state, MODULE),
      input: first.state.inputs[MODULE],
      publicEvidence: [],
    },
  ];
  await expect(prepareFirstSetupCommand(f.runtime, first.owner, f.io)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(await f.runtime.store.read()).toEqual(first.state);
});

it("refuses module selection drift before a command can return cancellation", async () => {
  const modules = twoCommandModules().map((module) =>
    module.provisioning?.initialSetup === undefined
      ? module
      : {
          ...module,
          provisioning: {
            ...module.provisioning,
            initialSetup: {
              ...module.provisioning.initialSetup,
              command: async () => ({ status: "cancelled" as const }),
            },
          },
        },
  );
  const f = await fixture("no", PASSWORD, modules);
  const changed = createFirstSetupRuntime({
    environment: {},
    stateDir: join(f.root, "state"),
    venueDir: join(f.root, "venue"),
    modules: modules.map((module) =>
      module.name === "catalogue" ? { ...module, version: "99.0.0" } : module,
    ),
    database: () => venue.db,
  });
  await expect(prepareFirstSetupCommand(changed, f.owner, f.io)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect((await f.runtime.store.read())!.status).toBe("claimed");
  expect(f.prompts).toEqual([]);
});

it("retains the same hour wait after recovering ownership with the setup password", async () => {
  const f = await fixture("unknown");
  await prepareFirstSetupCommand(f.runtime, f.owner, f.io);
  const before = await readFile(join(f.root, "state/module-preparation-state.json"));
  const recovered = await f.runtime.owner.recoverFirstSetup(randomBytes(32).toString("base64url"), {
    password: PASSWORD,
  });
  const owner = { ...recovered.state, capability: recovered.capability };
  f.prompts.splice(0);
  const resumed = await prepareFirstSetupCommand(f.runtime, owner, f.io);
  expect(resumed.status).toBe("waiting");
  expect(resumed.owner.ownerGeneration).toBe(2);
  expect(resumed.state.frozen.modules.find((entry) => entry.module === MODULE)!.request).toBeNull();
  expect(f.prompts).toEqual([]);
  expect(await readFile(join(f.root, "state/module-preparation-state.json"))).toEqual(before);
});

it("keeps clock confirmations tied to the old owner when a durable wait survives recovery", async () => {
  const f = await fixture();
  const comparison = (await f.runtime.preparation.prepare(f.owner, MODULE, {
    action: "compare-clocks",
    browser: null,
  })) as { id: string };
  const recovered = await f.runtime.owner.recoverFirstSetup(randomBytes(32).toString("base64url"), {
    password: PASSWORD,
  });
  const owner = { ...recovered.state, capability: recovered.capability };
  await expect(
    f.runtime.preparation.prepare(owner, MODULE, {
      action: "confirm-clock",
      comparisonId: comparison.id,
    }),
  ).rejects.toMatchObject({ code: "sif.allocation_invalid", params: { reason: "clock_stale" } });
});

async function recoveryDeliveryFixture() {
  const f = await fixture();
  const prepared = await prepareFirstSetupCommand(f.runtime, f.owner, f.io);
  expect(prepared.status).toBe("ready");
  expect(f.runtime).toHaveProperty("keys.stageInitialNodeKey", expect.any(Function));
  expect(f.runtime).toHaveProperty("recoveryDelivery.consume", expect.any(Function));
  const owner = prepared.owner;
  const staged = await f.runtime.keys.stageInitialNodeKey(
    owner,
    await f.runtime.owner.reconfirm(owner, PASSWORD, "block-use"),
  );
  const statement = {
    kind: "waitron-recovery-document",
    version: 1,
    scope: { taxpayerNif: request.taxId, softwareId: "W1", environment: "preproduction" },
    taxpayerName: request.legalName,
    venueName: request.location.name,
    createdAt: "2026-10-16T11:40:00.000Z",
    nodeKey: { nodeId: staged.key.nodeId, name: staged.key.name },
  };
  const { firstFiscalPublicDigest } = await import("./first-setup-public-digest.js");
  const reference = {
    module: MODULE,
    stageId: staged.stage.stageId,
    inputDigest: firstFiscalPublicDigest(prepared.state.inputs[MODULE]),
    bindingDigest: firstFiscalPublicDigest(statement),
    documentDigest: "a".repeat(64),
  };
  await f.runtime.recoveryDelivery.registerRecoveryDocumentDelivery(owner, {
    ...reference,
    statement,
  });
  const kept = async () =>
    f.runtime.recoveryDelivery.confirmRecoveryDocumentKept(
      owner,
      { ...reference, kept: true },
      await f.runtime.owner.reconfirm(owner, PASSWORD, "activation"),
    );
  return { ...f, owner, prepared, staged, statement, reference, kept };
}

it("the command runtime retains public delivery bindings but requires a fresh kept confirmation", async () => {
  const f = await recoveryDeliveryFixture();
  await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  const manifest = JSON.parse(
    await readFile(join(f.root, "state/first-fiscal-documents", `${MODULE}.recovery.json`), "utf8"),
  );
  expect(manifest).toMatchObject({
    ...f.reference,
    statement: f.statement,
    attemptId: f.owner.attemptId,
    revision: f.owner.revision,
    ownerGeneration: f.owner.ownerGeneration,
  });
  expect(JSON.stringify(manifest)).not.toContain(f.staged.key.secret);
  expect(JSON.stringify(manifest)).not.toContain(PASSWORD);
  await f.kept();
  await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).resolves.toBeUndefined();
  await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  expect((await f.runtime.store.read())!.status).toBe("consumption-intent");
  expect(await venue.db.execute("select count(*) as count from registro_sif")).toMatchObject({
    rows: [{ count: 0 }],
  });
});

it("a recovered command owner cannot reuse the earlier kept-document authority", async () => {
  const f = await recoveryDeliveryFixture();
  await f.kept();
  const inspection = await f.runtime.resolution.inspectFirstSetupResolution();
  const recovered = await f.runtime.owner.recoverFirstSetupOwner({
    inspectionId: inspection.inspectionId,
    revision: f.owner.revision,
    ownerGeneration: f.owner.ownerGeneration,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    password: PASSWORD,
  });
  const owner = { ...recovered.state, capability: recovered.capability };
  await expect(f.runtime.recoveryDelivery.consume(owner, MODULE)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  expect(await f.runtime.keys.readStage(owner)).toEqual(f.staged.stage);
  expect((await f.runtime.store.read())!.inputs[MODULE]).toEqual(f.prepared.state.inputs[MODULE]);
});

it.each(["stageId", "inputDigest", "bindingDigest", "documentDigest"] as const)(
  "the command runtime refuses a kept confirmation for a changed %s",
  async (field) => {
    const f = await recoveryDeliveryFixture();
    const value = field === "stageId" ? "00000000-0000-4000-8000-000000000000" : "b".repeat(64);
    await expect(
      f.runtime.recoveryDelivery.confirmRecoveryDocumentKept(
        f.owner,
        { ...f.reference, [field]: value, kept: true },
        await f.runtime.owner.reconfirm(f.owner, PASSWORD, "activation"),
      ),
    ).rejects.toMatchObject({ code: "setup.not_ready" });
    await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).rejects.toMatchObject({
      code: "setup.not_ready",
    });
    await f.kept();
    await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).resolves.toBeUndefined();
  },
);

it("a restarted command runtime reads the staged verifier but has no delivery grant or raw key", async () => {
  const f = await recoveryDeliveryFixture();
  await f.kept();
  const runtime = createFirstSetupRuntime({
    environment: {},
    stateDir: join(f.root, "state"),
    venueDir: join(f.root, "venue"),
    modules: ALL_MODULES,
    database: () => venue.db,
  });
  expect(await runtime.keys.readStage(f.owner)).toEqual(f.staged.stage);
  await expect(runtime.recoveryDelivery.consume(f.owner, MODULE)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  await expect(
    runtime.keys.stageInitialNodeKey(
      f.owner,
      await runtime.owner.reconfirm(f.owner, PASSWORD, "block-use"),
    ),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await readFile(join(f.root, "state/first-setup-node-key.json"), "utf8")).not.toContain(
    f.staged.key.secret,
  );
});

async function resumptionFixture(kept = true) {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(NOW);
  const f = await fixture();
  const prepared = await prepareFirstSetupCommand(f.runtime, f.owner, f.io);
  const io = { ...f.io, prompt: async () => "yes" };
  const path = join(f.root, "recovery.pdf");
  await f.runtime.commandDelivery.deliver(prepared.owner, io, path, "en");
  const oldComparison = (await f.runtime.preparation.prepare(prepared.owner, MODULE, {
    action: "compare-clocks",
    browser: null,
  })) as { id: string };
  const inspection = await f.runtime.resolution.inspectFirstSetupResolution();
  const recovered = await f.runtime.owner.recoverFirstSetupOwner({
    inspectionId: inspection.inspectionId,
    revision: prepared.state.revision,
    ownerGeneration: prepared.state.ownerGeneration,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    password: PASSWORD,
  });
  const owner = { ...recovered.state, capability: recovered.capability };
  if (kept) await f.runtime.commandDelivery.deliver(owner, io, path, "en");
  return { ...f, prepared, owner, io, path, oldComparison };
}

it("an explicit command resume refreshes clocks and records the recovered owner without replacing input or PDF", async () => {
  const f = await resumptionFixture();
  const pdf = await readFile(f.path);
  const before = (await f.runtime.store.read())!;
  external.internet.mockClear();
  expect(await resumeFirstSetupCommand(f.runtime, f.owner, f.io)).toEqual({ status: "ready" });
  expect(external.internet).toHaveBeenCalledTimes(1);
  expect(await readFile(f.path)).toEqual(pdf);
  expect(await f.runtime.store.read()).toEqual(before);
  const journal = JSON.parse(
    await readFile(join(f.root, "state/module-preparation-state.json"), "utf8"),
  );
  expect(journal.revisions.at(-1).value.entries.at(-1)).toMatchObject({
    kind: "resume",
    identity: "06RB",
  });
  await expect(f.runtime.owner.authorize(f.prepared.owner)).rejects.toMatchObject({
    code: "setup.owner_required",
  });
});

it("a claimed owner cannot use the explicit recovered-owner resume", async () => {
  const f = await fixture();
  const prepared = await prepareFirstSetupCommand(f.runtime, f.owner, f.io);
  await expect(resumeFirstSetupCommand(f.runtime, prepared.owner, f.io)).rejects.toMatchObject({
    code: "setup.owner_required",
  });
});

it("recovered ownership without a newly confirmed kept PDF cannot resume", async () => {
  const f = await resumptionFixture(false);
  await expect(resumeFirstSetupCommand(f.runtime, f.owner, f.io)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  const journal = JSON.parse(
    await readFile(join(f.root, "state/module-preparation-state.json"), "utf8"),
  );
  expect(journal.revisions).toHaveLength(1);
});

it("a wrong resume confirmation password cannot record the owner transition", async () => {
  const f = await resumptionFixture();
  await expect(
    resumeFirstSetupCommand(f.runtime, f.owner, { ...f.io, promptSecret: async () => "wrong" }),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  const journal = JSON.parse(
    await readFile(join(f.root, "state/module-preparation-state.json"), "utf8"),
  );
  expect(journal.revisions).toHaveLength(1);
});

it("repeating an explicit resume keeps one owner transition and one PDF", async () => {
  const f = await resumptionFixture();
  const pdf = await readFile(f.path);
  await resumeFirstSetupCommand(f.runtime, f.owner, f.io);
  await resumeFirstSetupCommand(f.runtime, f.owner, f.io);
  const journal = JSON.parse(
    await readFile(join(f.root, "state/module-preparation-state.json"), "utf8"),
  );
  expect(journal.revisions).toHaveLength(2);
  expect(
    journal.revisions
      .at(-1)
      .value.entries.filter((entry: { kind: string }) => entry.kind === "resume"),
  ).toHaveLength(1);
  expect(await readFile(f.path)).toEqual(pdf);
});

it("the module cannot write a resume outside the host's password authorization scope", async () => {
  const f = await resumptionFixture();
  const state = (await f.runtime.store.read())!;
  const seat = f.runtime.modules.find((module) => module.name === MODULE)!.provisioning!
    .initialSetup!;
  await f.runtime.preparation.prepare(f.owner, MODULE, { action: "compare-clocks", browser: null });
  await expect(
    seat.resume!(firstSetupModuleContext(state, MODULE), state.inputs[MODULE], "a".repeat(64)),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  const journal = JSON.parse(
    await readFile(join(f.root, "state/module-preparation-state.json"), "utf8"),
  );
  expect(journal.revisions).toHaveLength(1);
});

it("an old clock confirmation cannot be replayed after recovered-owner resumption", async () => {
  const f = await resumptionFixture();
  await resumeFirstSetupCommand(f.runtime, f.owner, f.io);
  await expect(
    f.runtime.preparation.prepare(f.owner, MODULE, {
      action: "confirm-clock",
      comparisonId: f.oldComparison.id,
    }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "clock_confirmation_required" },
  });
});

it("an expired kept grant cannot authorize resumption", async () => {
  const f = await resumptionFixture();
  vi.advanceTimersByTime(300001);
  await expect(f.runtime.recoveryDelivery.checkKept(f.owner, MODULE)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
});

it("a changed staged key cannot authorize resumption with the original kept document", async () => {
  const f = await resumptionFixture();
  const { writeFile } = await import("node:fs/promises");
  const path = join(f.root, "state/first-setup-node-key.json");
  const stage = JSON.parse(await readFile(path, "utf8"));
  stage.name = stage.name.endsWith("AAAA") ? "2026-10-16 · CCCC" : "2026-10-16 · AAAA";
  await writeFile(path, JSON.stringify(stage));
  await expect(f.runtime.recoveryDelivery.checkKept(f.owner, MODULE)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
});

it("the shared host refuses direct resumption by an owner who has not recovered ownership", async () => {
  const f = await fixture();
  const prepared = await prepareFirstSetupCommand(f.runtime, f.owner, f.io);
  await f.runtime.commandDelivery.deliver(
    prepared.owner,
    { ...f.io, prompt: async () => "yes" },
    join(f.root, "recovery.pdf"),
    "en",
  );
  const proof = await f.runtime.owner.reconfirm(prepared.owner, PASSWORD, "block-use");
  await expect(f.runtime.preparation.resume(prepared.owner, MODULE, proof)).rejects.toMatchObject({
    code: "setup.owner_required",
  });
});
