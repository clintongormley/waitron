import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { createFirstSetupRuntime } from "./first-setup-runtime.js";
import { prepareFirstSetupCommand } from "./first-setup-command.js";
import { firstFiscalPublicDigest } from "./first-setup-public-digest.js";
import {
  createFirstSetupRecoveryDelivery,
  readFirstSetupRecoveryDeliverySnapshot,
} from "./first-setup-recovery-delivery.js";
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
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "recovery-delivery-"));
  roots.push(root);
  const options = {
    stateDir: join(root, "state"),
    venueDir: join(root, "venue"),
    modules: ALL_MODULES,
    environment: {},
    database: () => venue.db,
  };
  await mkdir(options.venueDir);
  const runtime = createFirstSetupRuntime(options);
  const claim = await runtime.owner.claimFirstSetup(
    { environment: "preproduction", request },
    randomBytes(32).toString("base64url"),
  );
  const prepared = await prepareFirstSetupCommand(
    runtime,
    { ...claim.state, capability: claim.capability },
    {
      stdout() {},
      stderr() {},
      prompt: async () => "no",
      promptSecret: async () => PASSWORD,
      clearScreen() {},
    },
  );
  expect(prepared.status).toBe("ready");
  const owner = prepared.owner;
  const staged = await runtime.keys.stageInitialNodeKey(
    owner,
    await runtime.owner.reconfirm(owner, PASSWORD, "block-use"),
  );
  const statement = {
    kind: "waitron-recovery-document",
    installationCodes: ["06RB"],
    version: 1,
    scope: { taxpayerNif: request.taxId, softwareId: "W1", environment: "preproduction" },
    taxpayerName: request.legalName,
    venueName: request.location.name,
    createdAt: "2026-10-16T11:40:00.000Z",
    nodeKey: { nodeId: staged.key.nodeId, name: staged.key.name },
  };
  const reference = {
    module: MODULE,
    stageId: staged.stage.stageId,
    inputDigest: firstFiscalPublicDigest(prepared.state.inputs[MODULE]),
    bindingDigest: firstFiscalPublicDigest(statement),
    documentDigest: "a".repeat(64),
  };
  await runtime.recoveryDelivery.registerRecoveryDocumentDelivery(owner, {
    ...reference,
    statement,
  });
  const path = join(options.stateDir, "first-fiscal-documents", `${MODULE}.recovery.json`);
  const bytes = await readFile(path);
  const manifest = JSON.parse(bytes.toString()) as Record<string, unknown>;
  const state = (await runtime.store.read())!;
  const snapshot = (value: unknown = manifest, modules = runtime.modules) =>
    readFirstSetupRecoveryDeliverySnapshot(
      MODULE,
      state,
      [
        {
          name: `state/first-fiscal-documents/${MODULE}.recovery.json`,
          bytes: Buffer.from(JSON.stringify(value)),
        },
      ],
      modules,
    );
  const kept = async () =>
    runtime.recoveryDelivery.confirmRecoveryDocumentKept(
      owner,
      { ...reference, kept: true },
      await runtime.owner.reconfirm(owner, PASSWORD, "activation"),
    );
  return {
    runtime,
    owner,
    state,
    staged,
    statement,
    reference,
    bytes,
    manifest,
    path,
    options,
    snapshot,
    kept,
  };
}

it("recovers the exact public delivery from retained bytes without granting activation", async () => {
  const f = await fixture();
  expect(f.snapshot()).toEqual(f.manifest);
  expect(await f.runtime.recoveryDelivery.readRecoveryDocument(f.owner, MODULE)).toEqual({
    ...f.reference,
    statement: f.statement,
  });
  await expect(f.runtime.recoveryDelivery.checkKept(f.owner, MODULE)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  expect(f.bytes.toString()).not.toContain(f.staged.key.secret);
  expect(f.bytes.toString()).not.toContain(PASSWORD);
  expect(await venue.db.execute("select count(*) as count from registro_sif")).toMatchObject({
    rows: [{ count: 0 }],
  });
});

it.each(["stageId", "inputDigest", "bindingDigest"] as const)(
  "refuses registration with a different %s and revokes the previous kept confirmation",
  async (field) => {
    const f = await fixture();
    await f.kept();
    await expect(
      f.runtime.recoveryDelivery.registerRecoveryDocumentDelivery(f.owner, {
        ...f.reference,
        [field]: field === "stageId" ? "00000000-0000-4000-8000-000000000000" : "b".repeat(64),
        statement: f.statement,
      }),
    ).rejects.toMatchObject({ code: "setup.not_ready" });
    expect(await readFile(f.path)).toEqual(f.bytes);
    await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).rejects.toMatchObject({
      code: "setup.not_ready",
    });
    await f.kept();
    await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).resolves.toBeUndefined();
  },
);

it("refuses replacement bytes for an already registered stage and preserves its original record", async () => {
  const f = await fixture();
  await expect(
    f.runtime.recoveryDelivery.registerRecoveryDocumentDelivery(f.owner, {
      ...f.reference,
      documentDigest: "b".repeat(64),
      statement: f.statement,
    }),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(await readFile(f.path)).toEqual(f.bytes);
  await f.kept();
  await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).resolves.toBeUndefined();
});

it("returns no document and refuses installation when the delivery record is absent", async () => {
  const f = await fixture();
  await unlink(f.path);
  expect(await f.runtime.recoveryDelivery.readRecoveryDocument(f.owner, MODULE)).toBeNull();
  await expect(
    f.runtime.coordinator.run((hold) =>
      f.runtime.recoveryDelivery.install(venue.db, f.state, f.owner, MODULE, hold),
    ),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  await writeFile(f.path, f.bytes);
  expect(await f.runtime.recoveryDelivery.readRecoveryDocument(f.owner, MODULE)).toEqual({
    ...f.reference,
    statement: f.statement,
  });
});

it("compares a module's rebuilt statement with retained and newly supplied statements", async () => {
  const f = await fixture();
  const changedModules = f.runtime.modules.map((module) =>
    module.name !== MODULE
      ? module
      : {
          ...module,
          provisioning: {
            ...module.provisioning,
            initialSetup: {
              ...module.provisioning!.initialSetup!,
              recoveryDocument: () => ({ ...f.statement, venueName: "Different venue" }),
            },
          },
        },
  );
  expect(() => f.snapshot(f.manifest, changedModules)).toThrow(
    expect.objectContaining({ code: "setup.not_ready" }),
  );
  const delivery = createFirstSetupRecoveryDelivery({
    ...f.options,
    modules: changedModules,
    store: f.runtime.store,
    coordinator: f.runtime.coordinator,
    owner: f.runtime.owner,
    keys: f.runtime.keys,
  });
  await unlink(f.path);
  await expect(
    delivery.registerRecoveryDocumentDelivery(f.owner, { ...f.reference, statement: f.statement }),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  await expect(readFile(f.path)).rejects.toMatchObject({ code: "ENOENT" });
  await writeFile(f.path, f.bytes);
  expect(f.snapshot()).toEqual(f.manifest);
});

it.each([
  ["version", 2],
  ["kind", "other-delivery"],
  ["module", "other-module"],
  ["attemptId", "other-attempt"],
  ["frozenDigest", "b".repeat(64)],
  ["revision", 0],
  ["revision", 999],
  ["revision", 1.5],
  ["ownerGeneration", 0],
  ["ownerGeneration", 999],
  ["ownerGeneration", 1.5],
  ["stageId", "00000000-0000-4000-8000-000000000000"],
  ["inputDigest", "b".repeat(64)],
  ["bindingDigest", "b".repeat(64)],
  ["documentDigest", "invalid"],
  ["extra", "unexpected"],
] as const)(
  "rejects retained %s = %j without changing the original delivery",
  async (field, value) => {
    const f = await fixture();
    expect(() => f.snapshot({ ...f.manifest, [field]: value })).toThrow(
      expect.objectContaining({ code: "setup.not_ready" }),
    );
    expect(await readFile(f.path)).toEqual(f.bytes);
    expect(f.snapshot()).toEqual(f.manifest);
  },
);

it.each(["taxpayerName", "venueName", "installationCodes", "nodeKey"] as const)(
  "rejects a self-consistently rehashed changed %s in retained delivery",
  async (field) => {
    const f = await fixture();
    const statement = {
      ...f.statement,
      [field]:
        field === "installationCodes"
          ? ["06RC"]
          : field === "nodeKey"
            ? { ...f.statement.nodeKey, name: "other-key" }
            : "Other venue",
    };
    expect(() =>
      f.snapshot({ ...f.manifest, statement, bindingDigest: firstFiscalPublicDigest(statement) }),
    ).toThrow(
      expect.objectContaining({
        code: "sif.allocation_invalid",
        params: { reason: "outside_confirmation_missing" },
      }),
    );
    expect(f.snapshot()).toEqual(f.manifest);
  },
);

it.each(["missing", "version", "document-seat"] as const)(
  "rejects a %s module when reading retained delivery",
  async (fault) => {
    const f = await fixture();
    const modules =
      fault === "missing"
        ? f.runtime.modules.filter((module) => module.name !== MODULE)
        : f.runtime.modules.map((module) =>
            module.name !== MODULE
              ? module
              : fault === "version"
                ? { ...module, version: "other-version" }
                : { ...module, provisioning: { ...module.provisioning, initialSetup: undefined } },
          );
    expect(() => f.snapshot(f.manifest, modules)).toThrow(
      expect.objectContaining({
        code: fault === "missing" ? "module.operation_invalid" : "setup.not_ready",
      }),
    );
    expect(f.snapshot()).toEqual(f.manifest);
  },
);

it("distinguishes absent snapshot bytes from malformed or oversized delivery", async () => {
  const f = await fixture();
  const read = (originals: { name: string; bytes: Uint8Array | null }[]) =>
    readFirstSetupRecoveryDeliverySnapshot(MODULE, f.state, originals, f.runtime.modules);
  const name = `state/first-fiscal-documents/${MODULE}.recovery.json`;
  expect(read([])).toBeNull();
  expect(read([{ name, bytes: null }])).toBeNull();
  expect(read([{ name: "state/other.recovery.json", bytes: f.bytes }])).toBeNull();
  for (const bytes of [Buffer.from("{"), Buffer.alloc(16385, 32)])
    expect(() => read([{ name, bytes }])).toThrow(
      expect.objectContaining({ code: "setup.not_ready" }),
    );
  expect(f.snapshot()).toEqual(f.manifest);
});

it.each(["checkKept", "consume"] as const)(
  "%s refuses an expired kept confirmation and accepts a fresh one",
  async (method) => {
    const f = await fixture();
    await f.kept();
    vi.advanceTimersByTime(299999);
    await expect(f.runtime.recoveryDelivery.checkKept(f.owner, MODULE)).resolves.toMatch(
      /^[a-f0-9]{64}$/,
    );
    vi.advanceTimersByTime(1);
    await expect(f.runtime.recoveryDelivery[method](f.owner, MODULE)).rejects.toMatchObject({
      code: "setup.not_ready",
    });
    expect(await readFile(f.path)).toEqual(f.bytes);
    await f.kept();
    await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).resolves.toBeUndefined();
    await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).rejects.toMatchObject({
      code: "setup.not_ready",
    });
  },
);

it("invalidates only the matching attempt's kept confirmation", async () => {
  const f = await fixture();
  await f.kept();
  f.runtime.recoveryDelivery.invalidate("another-attempt");
  await expect(f.runtime.recoveryDelivery.checkKept(f.owner, MODULE)).resolves.toMatch(
    /^[a-f0-9]{64}$/,
  );
  f.runtime.recoveryDelivery.invalidate(f.owner.attemptId);
  await expect(f.runtime.recoveryDelivery.checkKept(f.owner, MODULE)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  expect(await readFile(f.path)).toEqual(f.bytes);
});

it.each(["checkKept", "consume"] as const)(
  "%s refuses a changed delivery after kept confirmation",
  async (method) => {
    const f = await fixture();
    await f.kept();
    await writeFile(f.path, JSON.stringify({ ...f.manifest, documentDigest: "b".repeat(64) }));
    await expect(f.runtime.recoveryDelivery[method](f.owner, MODULE)).rejects.toMatchObject({
      code: "setup.not_ready",
    });
    await writeFile(f.path, f.bytes);
    await f.kept();
    await expect(f.runtime.recoveryDelivery.consume(f.owner, MODULE)).resolves.toBeUndefined();
  },
);
