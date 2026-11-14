import { readSetupFlowRecord, updateSetupFlowSection } from "./setup-flow-record.js";
import { dirname, join } from "node:path";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InitialSetupContribution, WaitronModule, ModuleOperationHost } from "@waitron/module";
import { ALL_MODULES } from "@waitron/composition";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { createFirstSetupRuntime } from "./first-setup-runtime.js";
import { prepareFirstSetupCommand, recheckFirstSetupCommand } from "./first-setup-command.js";
import { MODULE, PASSWORD, request } from "../test/first-setup-request.js";
import {
  moveFakeClockPast,
  prepareCommandPastWaits,
  STOPPED_DURING_WAIT,
  stopDuringWait,
} from "../test/settle-wait.js";

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
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(NOW);
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
  testClock?: ModuleOperationHost["testClock"],
) {
  const root = await mkdtemp(join(tmpdir(), "setup-command-"));
  roots.push(root);
  const runtime = createFirstSetupRuntime({
    environment: {},
    stateDir: join(root, "state"),
    venueDir: join(root, "venue"),
    modules,
    database: () => venue.db,
    testClock,
  });
  const claim = await runtime.owner.claimFirstSetup({ environment: "preproduction", request });
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

/** The owner as it stands after a run the stand-in stop ended during its wait. */
async function ownerAfterStop(f: {
  runtime: { store: { read(): Promise<{ revision: number } | null> } };
  owner: Parameters<typeof prepareFirstSetupCommand>[1];
}) {
  return { ...f.owner, revision: (await f.runtime.store.read())!.revision };
}

it("prepares a real owned name after the terminal's wait, asking no question, without activating a venue", async () => {
  let wall = Date.parse("2026-10-16T11:38:00Z");
  let monotonic = 1_000_000;
  vi.setSystemTime(wall);
  external.internet.mockImplementation(async () => ({
    source: "internet",
    result: "usable",
    instantMs: wall,
    uncertaintyMs: 500,
    wallStartedMs: wall,
    wallFinishedMs: wall,
    monotonicStartedMs: monotonic,
    monotonicFinishedMs: monotonic,
  }));
  const f = await fixture("no", PASSWORD, ALL_MODULES, {
    wall: () => wall,
    monotonic: () => monotonic,
  });
  let outputAtWait: string[] = [];
  const result = await prepareFirstSetupCommand(f.runtime, f.owner, f.io, async (ms) => {
    outputAtWait = [...f.output];
    wall += ms;
    monotonic += ms;
    vi.setSystemTime(wall);
  });
  expect(outputAtWait).toContain(
    "Waiting to confirm the time, so no invoice series is ever repeated.",
  );
  expect(outputAtWait).toContain(
    "Waiting until 2026-10-16T11:40:00.000Z; it carries on by itself, so keep the command running.",
  );
  expect(result.status).toBe("ready");
  const state = (await f.runtime.store.read())!;
  expect(state.status).toBe("consumption-intent");
  expect(state.frozen.modules.find((entry) => entry.module === MODULE)!.request).toMatchObject({
    kind: "waitron-hour-setup",
    status: "selected",
    identity: "0CNNW",
  });
  expect(state.inputs[MODULE]).toMatchObject({
    allocation: {
      installationIdentity: "0CNNW",
      series: [
        { code: "A-0CNNW", purpose: "standard" },
        { code: "FF-0CNNW", purpose: "full" },
        { code: "R-0CNNW", purpose: "rectificative" },
      ],
    },
  });
  const journal = JSON.parse(
    await readFile(join(f.root, "state/module-records/fiscal-verifactu.json"), "utf8"),
  );
  expect(journal.prepared.at(-1).value.entries).toMatchObject([
    { kind: "wait", targetMs: Date.parse("2026-10-16T11:40:00Z") },
    { kind: "intent", identity: "0CNNW" },
  ]);
  expect(await venue.db.execute("select count(*) as count from registro_sif")).toMatchObject({
    rows: [{ count: 0 }],
  });
  expect(await venue.db.execute("select count(*) as count from tenants")).toMatchObject({
    rows: [{ count: 0 }],
  });
  expect(f.prompts.length).toBeGreaterThan(0);
  expect(f.prompts.every((question) => question === "Confirm setup password: ")).toBe(true);
  expect(f.output.join("\n")).not.toContain(PASSWORD);
});

it("retains its settle wait, says why and until when, and exposes no activation input", async () => {
  const f = await fixture();
  await expect(prepareFirstSetupCommand(f.runtime, f.owner, f.io, stopDuringWait)).rejects.toBe(
    STOPPED_DURING_WAIT,
  );
  const state = (await f.runtime.store.read())!;
  expect(state.status).toBe("claimed");
  expect(state.inputs).toEqual({});
  expect(state.frozen.modules.find((entry) => entry.module === MODULE)!.request).toBeNull();
  const journal = JSON.parse(
    await readFile(join(f.root, "state/module-records/fiscal-verifactu.json"), "utf8"),
  );
  const entries = journal.prepared.at(-1).value.entries;
  expect(entries).toMatchObject([{ kind: "wait", targetMs: Date.parse("2026-10-16T11:42:00Z") }]);
  expect(entries[0]).not.toHaveProperty("answer");
  expect(f.output).toContain("Waiting to confirm the time, so no invoice series is ever repeated.");
  expect(f.output).toContain(
    "Waiting until 2026-10-16T11:42:00.000Z; it carries on by itself, so keep the command running.",
  );
  expect(f.prompts.every((question) => question === "Confirm setup password: ")).toBe(true);
});

it("with only the box's clock the terminal explains and cancels without a question or a spent name", async () => {
  const f = await fixture();
  external.internet.mockResolvedValue({ source: "internet", result: "unavailable", reason: "tls" });
  const result = await prepareFirstSetupCommand(f.runtime, f.owner, f.io, stopDuringWait);
  expect(result.status).toBe("cancelled");
  expect(result.state.status).toBe("claimed");
  expect(result.state.inputs).toEqual({});
  expect(f.output.join("\n")).toContain("2026-10-16T11:40:00.000Z");
  expect(f.output.join("\n")).toContain("internet: unavailable");
  expect(f.output).toContain(
    "No series is made without a confirmed time, so none is ever repeated.",
  );
  expect(f.output).toContain(
    "Connect the box to the internet, or set up from a phone or laptop on the venue's network.",
  );
  expect(f.prompts).toEqual([]);
  await expect(
    readFile(join(f.root, "state/module-records/fiscal-verifactu.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("when the internet's clock disagrees the terminal explains and cancels without a question", async () => {
  const f = await fixture();
  external.internet.mockImplementation(async () => ({
    source: "internet",
    result: "usable",
    instantMs: NOW + 31_000,
    uncertaintyMs: 0,
    wallStartedMs: NOW,
    wallFinishedMs: NOW,
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }));
  const result = await prepareFirstSetupCommand(f.runtime, f.owner, f.io, stopDuringWait);
  expect(result.status).toBe("cancelled");
  expect(f.output).toContain(
    "No series is made without a confirmed time, so none is ever repeated.",
  );
  expect(f.output).not.toContain(
    "Connect the box to the internet, or set up from a phone or laptop on the venue's network.",
  );
  expect(f.prompts).toEqual([]);
  await expect(
    readFile(join(f.root, "state/module-records/fiscal-verifactu.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

function withSeat(
  runtime: ReturnType<typeof createFirstSetupRuntime>,
  change: (seat: InitialSetupContribution) => Partial<InitialSetupContribution>,
) {
  return {
    ...runtime,
    modules: runtime.modules.map((module) => {
      if (module.name !== MODULE) return module;
      const seat = module.provisioning!.initialSetup!;
      return {
        ...module,
        provisioning: { ...module.provisioning, initialSetup: { ...seat, ...change(seat) } },
      };
    }),
  };
}

it("a module's question reaches the operator's terminal and the typed answer reaches the module", async () => {
  const f = await fixture("synthetic answer");
  const heard: string[] = [];
  const runtime = withSeat(f.runtime, (seat) => ({
    async command(context, actions) {
      heard.push(await actions.prompt("Synthetic question? "));
      return seat.command!(context, actions);
    },
  }));
  await expect(prepareFirstSetupCommand(runtime, f.owner, f.io, stopDuringWait)).rejects.toBe(
    STOPPED_DURING_WAIT,
  );
  expect(f.prompts[0]).toBe("Synthetic question? ");
  expect(heard).toEqual(["synthetic answer"]);
});

it("rejects a wrong password before persisting a selected hour", async () => {
  const f = await fixture("no", "wrong-synthetic-password");
  await expect(
    prepareFirstSetupCommand(f.runtime, f.owner, f.io, stopDuringWait),
  ).rejects.toMatchObject({
    code: "setup.owner_required",
  });
  expect((await f.runtime.store.read())!.status).toBe("claimed");
  await expect(
    readFile(join(f.root, "state/module-records/fiscal-verifactu.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("reuses the exact prepared state without another question or another spent hour", async () => {
  const f = await fixture();
  await expect(prepareFirstSetupCommand(f.runtime, f.owner, f.io, stopDuringWait)).rejects.toBe(
    STOPPED_DURING_WAIT,
  );
  const first = await f.runtime.store.read();
  const before = await readFile(join(f.root, "state/module-records/fiscal-verifactu.json"));
  f.prompts.splice(0);
  await expect(
    prepareFirstSetupCommand(f.runtime, await ownerAfterStop(f), f.io, stopDuringWait),
  ).rejects.toBe(STOPPED_DURING_WAIT);
  expect(await f.runtime.store.read()).toEqual(first);
  expect(f.prompts).toEqual([]);
  expect(await readFile(join(f.root, "state/module-records/fiscal-verifactu.json"))).toEqual(
    before,
  );
});

it("imports an already selected request without selecting another hour", async () => {
  const f = await fixture();
  let selected;
  for (let round = 0; ; round++) {
    const comparison = (await f.runtime.preparation.prepare(
      f.owner,
      MODULE,
      { action: "compare-clocks", browser: null },
      { onBox: true },
    )) as { id: string };
    const proof = await f.runtime.owner.reconfirm(f.owner, PASSWORD, "block-use");
    selected = await f.runtime.preparation.select(
      f.owner,
      MODULE,
      { comparisonId: comparison.id },
      proof,
    );
    const waiting = (selected as { preparation?: { status?: string; targetMs?: number } })
      .preparation;
    if (waiting?.status !== "waiting") break;
    if (round === 3) throw new Error("still waiting after 3 clock moves");
    moveFakeClockPast(waiting.targetMs!);
  }
  const before = await readFile(join(f.root, "state/module-records/fiscal-verifactu.json"));
  const result = await prepareFirstSetupCommand(
    f.runtime,
    { ...f.owner, revision: selected.state.revision },
    f.io,
    stopDuringWait,
  );
  expect(result.status).toBe("ready");
  expect(result.state.inputs[MODULE]).toMatchObject({
    allocation: { installationIdentity: "0CNNY" },
  });
  expect(f.prompts).toEqual([]);
  expect(await readFile(join(f.root, "state/module-records/fiscal-verifactu.json"))).toEqual(
    before,
  );
});

it("rejects changed module versions even on an already imported request", async () => {
  const f = await fixture();
  await expect(prepareFirstSetupCommand(f.runtime, f.owner, f.io, stopDuringWait)).rejects.toBe(
    STOPPED_DURING_WAIT,
  );
  const first = { owner: await ownerAfterStop(f), state: await f.runtime.store.read() };
  const changed = createFirstSetupRuntime({
    environment: {},
    stateDir: join(f.root, "state"),
    venueDir: join(f.root, "venue"),
    modules: ALL_MODULES.map((module) =>
      module.name === "catalogue" ? { ...module, version: "99.0.0" } : module,
    ),
    database: () => venue.db,
  });
  await expect(
    prepareFirstSetupCommand(changed, first.owner, f.io, stopDuringWait),
  ).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(await f.runtime.store.read()).toEqual(first.state);
});

it("does not report preparation ready after activation has started", async () => {
  const f = await fixture();
  const first = await prepareCommandPastWaits(f.runtime, f.owner, f.io);
  const state = await f.runtime.store.update(first.owner.attemptId, first.state.revision, {
    kind: "activation-started",
  });
  await expect(
    prepareFirstSetupCommand(
      f.runtime,
      { ...first.owner, revision: state.revision },
      f.io,
      stopDuringWait,
    ),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await f.runtime.store.read()).toEqual(state);
});

it("does not return a stale cancelled owner after the setup is stopped", async () => {
  const f = await fixture("");
  external.internet.mockResolvedValue({ source: "internet", result: "unavailable", reason: "tls" });
  const prepare = f.runtime.preparation.prepare;
  f.runtime.preparation.prepare = async (...args) => {
    const compared = await prepare(...args);
    const held = (await f.runtime.store.read())!;
    await f.runtime.store.update(held.frozen.attemptId, held.revision, { kind: "abandoned" });
    return compared;
  };
  await expect(
    prepareFirstSetupCommand(f.runtime, f.owner, f.io, stopDuringWait),
  ).rejects.toMatchObject({
    code: "setup.owner_required",
  });
  expect((await f.runtime.store.read())!.status).toBe("abandoned");
});

it("refuses a corrected box clock while the operator is answering", async () => {
  const f = await fixture();
  f.io.promptSecret = async () => {
    vi.setSystemTime(NOW + 5_000);
    return PASSWORD;
  };
  await expect(
    prepareFirstSetupCommand(f.runtime, f.owner, f.io, stopDuringWait),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "clock_corrected" },
  });
  expect((await f.runtime.store.read())!.status).toBe("claimed");
  await expect(
    readFile(join(f.root, "state/module-records/fiscal-verifactu.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
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
  const result = await prepareFirstSetupCommand(f.runtime, f.owner, f.io, stopDuringWait);
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

it("near an hour's end the terminal waits for its settle point, not for the hour", async () => {
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
  await expect(prepareFirstSetupCommand(f.runtime, f.owner, f.io, stopDuringWait)).rejects.toBe(
    STOPPED_DURING_WAIT,
  );
  expect((await f.runtime.store.read())!.status).toBe("claimed");
  expect(f.output).toContain(
    "Waiting until 2026-10-16T12:02:00.000Z; it carries on by itself, so keep the command running.",
  );
  expect(f.output.join("\n")).not.toContain("UTC-hour boundary");
  expect(f.prompts.every((question) => question === "Confirm setup password: ")).toBe(true);
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
  await expect(
    prepareFirstSetupCommand(f.runtime, f.owner, f.io, stopDuringWait),
  ).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  expect(await f.runtime.store.read()).toEqual(before);
  expect(f.prompts).toEqual([]);
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
  await expect(
    prepareFirstSetupCommand(changed, f.owner, f.io, stopDuringWait),
  ).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect((await f.runtime.store.read())!.status).toBe("claimed");
  expect(f.prompts).toEqual([]);
});

it("retains the same hour wait when the owner runs the command again", async () => {
  const f = await fixture("unknown");
  await expect(prepareFirstSetupCommand(f.runtime, f.owner, f.io, stopDuringWait)).rejects.toBe(
    STOPPED_DURING_WAIT,
  );
  const before = await readFile(join(f.root, "state/module-records/fiscal-verifactu.json"));
  f.prompts.splice(0);
  await expect(prepareFirstSetupCommand(f.runtime, f.owner, f.io, stopDuringWait)).rejects.toBe(
    STOPPED_DURING_WAIT,
  );
  const resumed = (await f.runtime.store.read())!;
  expect(resumed.ownerGeneration).toBe(1);
  expect(resumed.frozen.modules.find((entry) => entry.module === MODULE)!.request).toBeNull();
  expect(f.prompts).toEqual([]);
  expect(await readFile(join(f.root, "state/module-records/fiscal-verifactu.json"))).toEqual(
    before,
  );
});

async function recoveryDeliveryFixture() {
  const f = await fixture();
  const prepared = await prepareCommandPastWaits(f.runtime, f.owner, f.io);
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
    venueName: request.name,
    createdAt: "2026-10-16T11:42:00.001Z",
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
  const manifest = (await readSetupFlowRecord(join(f.root, "state")))?.recoveryManifests?.[MODULE];
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
  expect(await readFile(join(f.root, "state/flows/setup/record.json"), "utf8")).not.toContain(
    f.staged.key.secret,
  );
});

async function resumptionFixture() {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(NOW);
  const f = await fixture();
  const prepared = await prepareCommandPastWaits(f.runtime, f.owner, f.io);
  const io = { ...f.io, prompt: async () => "yes" };
  const path = join(f.root, "recovery.pdf");
  await f.runtime.commandDelivery.deliver(prepared.owner, io, path, "en");
  return { ...f, prepared, owner: prepared.owner, io, path };
}

it("a module's last check before activation relays its question and refuses a new selection, writing nothing", async () => {
  const f = await resumptionFixture();
  const before = (await f.runtime.store.read())!;
  const journal = await readFile(join(f.root, "state/module-records/fiscal-verifactu.json"));
  const asked: string[] = [];
  const io = {
    ...f.io,
    prompt: async (question: string) => {
      asked.push(question);
      return "synthetic answer";
    },
  };
  const heard: string[] = [];
  let refusal: unknown;
  const runtime = withSeat(f.runtime, () => ({
    async commandBeforeActivation(_context, actions) {
      heard.push(await actions.prompt("Synthetic question? "));
      refusal = await actions.select({ choice: "another" }).then(
        () => "selected",
        (error: unknown) => error,
      );
      return { status: "cancelled" };
    },
  }));
  expect(await recheckFirstSetupCommand(runtime, f.owner, io)).toEqual({ status: "cancelled" });
  expect(asked).toEqual(["Synthetic question? "]);
  expect(heard).toEqual(["synthetic answer"]);
  expect(refusal).toMatchObject({ code: "setup.attempt_conflict" });
  expect(await f.runtime.store.read()).toEqual(before);
  expect(await readFile(join(f.root, "state/module-records/fiscal-verifactu.json"))).toEqual(
    journal,
  );
});

it("an expired kept grant cannot authorize resumption", async () => {
  const f = await resumptionFixture();
  vi.advanceTimersByTime(300001);
  await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
});

it("a changed staged key cannot authorize resumption with the original kept document", async () => {
  const f = await resumptionFixture();
  const path = join(f.root, "state/flows/setup/record.json");
  const stage = JSON.parse(await readFile(path, "utf8")).nodeKey;
  stage.name = stage.name.endsWith("AAAA") ? "2026-10-16 · CCCC" : "2026-10-16 · AAAA";
  await mkdir(dirname(path), { recursive: true });
  await updateSetupFlowSection(join(f.root, "state"), "nodeKey", () => stage);
  await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
});
