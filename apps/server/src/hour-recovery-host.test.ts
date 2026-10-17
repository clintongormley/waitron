import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  invoiceSeries,
  readBreakGlassVerifier,
  setBreakGlassVerifierTx,
  stampDeployment,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ALL_MODULES } from "@waitron/composition";
import { withOperationAuthority, type OperationBinding } from "@waitron/module";
import { createFirstSetupCoordinator, readModulePreparationHistory } from "@waitron/provisioning";
import { createHourPreparation } from "@waitron/fiscal-verifactu/src/hour-preparation.js";
import { compareHourClocks } from "@waitron/fiscal-verifactu/src/hour-clock.js";
import { readHourHistory } from "@waitron/fiscal-verifactu/src/hour-history-reader.js";
import { activatePreparedModuleAllocation } from "@waitron/fiscal-verifactu/src/allocation-preparation.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { seedTenants, TENANT_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import { locationId } from "@waitron/shared";
import { mintBreakGlassKey } from "./break-glass.js";
import { createRecoveryRestoreRunner } from "./recovery-module-operation.js";
import { runRestoreHooks } from "./restore.js";
import { createSelectedRecoveryPreparation } from "./recovery-preparation.js";
import { withRecoveryKeyAuthority } from "./operation-authentication.js";
import { buildManifest } from "./backup-manifest.js";
import { packArchive } from "./backup-archive.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { previewRecoveryArchive } from "./recovery-backup-preview.js";

const external = vi.hoisted(() => ({ internet: vi.fn() }));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: external.internet,
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const binding: OperationBinding = {
  module: "fiscal-verifactu",
  action: "restore",
  eventId: "durable-recovery",
  sourceId: "exact-selected-backup",
  targetNodeId: node.nodeId,
};
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const scope = { taxpayerNif: "89890001K", environment: "preproduction" as const };
let root: string;
let key: { secret: string; name: string };
let value: unknown;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hour-recovery-host-"));
  await mkdir(join(root, "state"));
  await mkdir(join(root, "venue"));
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
  external.internet.mockImplementation(async () => ({
    source: "internet",
    result: "unavailable",
    reason: "offline",
  }));
  await seedTenants(suite.db);
  await stampDeployment(suite.db, "preproduction");
  key = await mintBreakGlassKey(suite.db, node.nodeId);
  value = null;
  const first = { ...binding, action: "setup", eventId: "original" };
  const setup = createHourPreparation({
    withState: async (_binding, run) =>
      run({
        get value() {
          return value;
        },
        history: [],
        async replace(next) {
          value = next;
        },
      }),
    monotonicNow: () => 0,
    read: async () => ({
      scope,
      bases,
      contextKey: "first",
      history: [{ reference: "empty", complete: true, records: [] }],
      clock: compareHourClocks(
        [
          {
            source: "box",
            result: "usable",
            instantMs: Date.now(),
            uncertaintyMs: 0,
            wallStartedMs: Date.now(),
            wallFinishedMs: Date.now(),
            monotonicStartedMs: 0,
            monotonicFinishedMs: 0,
          },
          {
            source: "browser",
            result: "usable",
            instantMs: Date.now(),
            uncertaintyMs: 0,
            wallStartedMs: Date.now(),
            wallFinishedMs: Date.now(),
            monotonicStartedMs: 0,
            monotonicFinishedMs: 0,
          },
        ],
        Date.parse("2026-10-15T00:00:00Z"),
      ),
    }),
  });
  await withOperationAuthority(first, "administrator", async (authority) => {
    const selected = await setup.select({ binding: first, authority, answer: "no" });
    if (selected.status !== "selected") throw new Error("initial selection");
    await setup.prepare({ binding: first, authority, input: selected.input }, (prepared) =>
      withTransaction(suite.db, (tx) => activatePreparedModuleAllocation(tx, node, prepared)),
    );
  });
  await suite.db.update(invoiceSeries).set({ nextNumber: 123 });
  vi.setSystemTime(new Date("2026-10-16T12:40:00Z"));
});
afterEach(async () => {
  vi.useRealTimers();
  external.internet.mockReset();
  if (root) await rm(root, { recursive: true, force: true });
});
async function host() {
  const roots = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  const facts = {
    country: "ES",
    taxId: scope.taxpayerNif,
    environment: scope.environment,
    bases,
    contextKey: JSON.stringify([binding, key.name]),
    history: [await withTransaction(suite.db, (tx) => readHourHistory(tx, "preproduction"))],
    oldMachineAbsent: false,
    oldMachineOffline: true,
    noParallelRecovery: true,
    priorActivation: "none" as "none" | "committed",
  };
  const selected = {
    sourceId: binding.sourceId,
    createdAt: "2026-10-16T11:40:00Z",
    environment: "preproduction" as const,
    nodeId: node.nodeId,
    nodeRecoveryKeyName: key.name,
    taxpayer: { legalName: "Selected business", taxId: scope.taxpayerNif },
    locationName: "Selected venue",
    fiscalSelection: {
      country: "ES",
      fiscalTerritory: "ES-common",
      timeZone: "Europe/Madrid",
      module: binding.module,
    },
  };
  const options = {
    ...roots,
    coordinator: createFirstSetupCoordinator(),
    modules: ALL_MODULES.filter((module) => module.name === binding.module),
    binding,
    node,
    secret: key.secret,
    database: () => suite.db,
    selected,
    readRecoveryFacts: async () => facts,
  };
  const service = createSelectedRecoveryPreparation(options);
  const configured = service.modules;
  const prepare = (proposal: unknown, secret = key.secret) =>
    (secret === key.secret
      ? service
      : createSelectedRecoveryPreparation({ ...options, secret })
    ).prepare(proposal);
  const compare = async () => {
    const challenge = (await prepare({ action: "clock-challenge" })) as { id: string };
    return prepare({
      action: "compare-clocks",
      browser: { challengeId: challenge.id, instantMs: Date.now() },
    });
  };
  return { configured, facts, prepare, compare, roots, service, selected, options };
}

it("persists a recovery hour before the real configured restore runner activates it", async () => {
  const f = await host();
  await f.compare();
  const selected = (await f.prepare({ action: "select", answer: "no" })) as {
    status: string;
    identity: string;
    input: unknown;
  };
  expect(selected.status).toBe("selected");
  expect(selected.identity).toBe("06RC");
  const journal = await readModulePreparationHistory(f.roots, binding.module);
  expect(journal).toHaveLength(1);
  expect(JSON.stringify(journal)).toContain('"identity":"06RC"');
  expect(
    await readFile(join(f.roots.stateDir, "module-preparation-state.json"), "utf8"),
  ).not.toContain(key.secret);
  const old = await suite.db.select().from(invoiceSeries);
  await runRestoreHooks({
    db: suite.db,
    node,
    modules: f.configured,
    log: () => {},
    withModuleOperations: f.service.runner(selected.input),
  });
  const after = await suite.db.select().from(invoiceSeries);
  for (const row of old)
    expect(after.find((entry) => entry.id === row.id)).toEqual({
      ...row,
      retiredAt: expect.any(Date),
    });
  expect(
    after
      .filter((row) => row.retiredAt === null)
      .map(({ code, nextNumber }) => ({ code, nextNumber })),
  ).toEqual([
    { code: "A-06RC", nextNumber: 1 },
    { code: "FF-06RC", nextNumber: 1 },
    { code: "R-06RC", nextNumber: 1 },
  ]);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(2);
});

it("reopens the same selected hour after host restart and requires a fresh clock comparison", async () => {
  const first = await host();
  await first.compare();
  const selected = await first.prepare({ action: "select", answer: "no" });
  const next = await host();
  await expect(next.prepare({ action: "select", answer: "no" })).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "clock_stale" },
  });
  vi.setSystemTime(new Date("2026-10-16T13:10:00Z"));
  await next.compare();
  expect(await next.prepare({ action: "select", answer: "no" })).toEqual(selected);
  expect(await readModulePreparationHistory(next.roots, binding.module)).toHaveLength(1);
});

it("replays the exact restore after reading the now-committed database history", async () => {
  const f = await host();
  await f.compare();
  const selected = (await f.prepare({ action: "select", answer: "no" })) as { input: unknown };
  const runner = createRecoveryRestoreRunner(
    f.configured,
    { binding, input: selected.input },
    key.secret,
  );
  await runRestoreHooks({
    db: suite.db,
    node,
    modules: f.configured,
    log: () => {},
    withModuleOperations: runner,
  });
  const before = await suite.db.select().from(invoiceSeries);
  f.facts.priorActivation = "committed";
  f.facts.history = [await withTransaction(suite.db, (tx) => readHourHistory(tx, "preproduction"))];
  await runRestoreHooks({
    db: suite.db,
    node,
    modules: f.configured,
    log: () => {},
    withModuleOperations: runner,
    resumeOperation: binding,
  });
  expect(await suite.db.select().from(invoiceSeries)).toEqual(before);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(2);
  expect(await readModulePreparationHistory(f.roots, binding.module)).toHaveLength(1);
});

it("requires the backup's actual key before selecting or writing preparation history", async () => {
  const f = await host();
  await expect(f.prepare({ action: "clock-challenge" }, "wrong-key")).rejects.toMatchObject({
    code: "promotion.break_glass_invalid",
  });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
});

it.each([
  ["oldMachineOffline", false, "old_machine_active"],
  ["oldMachineAbsent", true, "old_machine_absence_unconfirmed"],
  ["noParallelRecovery", false, "parallel_recovery"],
] as const)("refuses missing %s before spending an hour", async (field, flag, reason) => {
  const f = await host();
  f.facts[field] = flag;
  await f.compare();
  await expect(f.prepare({ action: "select", answer: "no" })).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason },
  });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
});

it("retains a higher surviving hour when the supplied copy is older", async () => {
  const f = await host();
  f.facts.history.push({
    reference: "retired-workspace",
    complete: true,
    records: [
      {
        reference: "other-software/other-node",
        kind: "retirement",
        ...scope,
        softwareId: "OTHER",
        nodeId: "retired-node",
        identity: "06RD",
        recordedAtMs: Date.parse("2026-10-16T13:10:00Z"),
      },
    ],
  });
  await f.compare();
  await expect(f.prepare({ action: "select", answer: "no" })).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "hour_not_later" },
  });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
});

it("binds durable host admission to the selected source and refuses a different artifact", async () => {
  const f = await host();
  const service = createSelectedRecoveryPreparation({
    ...f.roots,
    coordinator: createFirstSetupCoordinator(),
    modules: ALL_MODULES,
    binding,
    node,
    secret: key.secret,
    database: () => suite.db,
    selected: {
      sourceId: "different-artifact",
      createdAt: "2026-10-16T11:40:00Z",
      environment: "preproduction",
      nodeId: node.nodeId,
      nodeRecoveryKeyName: key.name,
      taxpayer: { legalName: "Selected business", taxId: scope.taxpayerNif },
      locationName: "Selected venue",
      fiscalSelection: {
        country: "ES",
        fiscalTerritory: "ES-common",
        timeZone: "Europe/Madrid",
        module: binding.module,
      },
    },
    readRecoveryFacts: async () => f.facts,
  });
  await expect(service.prepare({ action: "clock-challenge" })).rejects.toMatchObject({
    code: "module.operation_invalid",
  });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
});

it("adds the selected copy's opaque public floor to surviving host evidence", async () => {
  const f = await host();
  const service = createSelectedRecoveryPreparation({
    ...f.options,
    selected: {
      ...f.selected,
      moduleEvidence: {
        [binding.module]: {
          "hour-history": {
            reference: "selected-copy",
            complete: true,
            records: [
              {
                ...scope,
                reference: "abandoned-remote-hour",
                kind: "intent",
                softwareId: "OTHER",
                nodeId: "remote-node",
                identity: "06RD",
                recordedAtMs: Date.parse("2026-10-16T13:10:00Z"),
              },
            ],
          },
        },
      },
    },
  });
  const challenge = (await service.prepare({ action: "clock-challenge" })) as { id: string };
  await service.prepare({
    action: "compare-clocks",
    browser: { challengeId: challenge.id, instantMs: Date.now() },
  });
  await expect(service.prepare({ action: "select", answer: "no" })).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "hour_not_later" },
  });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
});

it("requires a real committed result when the host reports that replay is possible", async () => {
  const f = await host();
  await f.compare();
  const selected = (await f.prepare({ action: "select", answer: "no" })) as { input: unknown };
  f.facts.priorActivation = "committed";
  const before = await suite.db.select().from(invoiceSeries);
  await expect(
    runRestoreHooks({
      db: suite.db,
      node,
      modules: f.configured,
      log: () => {},
      withModuleOperations: f.service.runner(selected.input),
      resumeOperation: binding,
    }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "prior_activation_requires_replay" },
  });
  expect(await suite.db.select().from(invoiceSeries)).toEqual(before);
});

it.each(["country", "taxId", "environment"] as const)(
  "refuses a recovery fact whose %s differs from the selected copy",
  async (field) => {
    const f = await host();
    Object.assign(f.facts, { [field]: field === "environment" ? "production" : "different" });
    await expect(f.prepare({ action: "clock-challenge" })).rejects.toMatchObject({
      code: "module.operation_invalid",
    });
    expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
  },
);

it("refuses unknown selected filing evidence before exposing clock or hour actions", async () => {
  const f = await host();
  const service = createSelectedRecoveryPreparation({
    ...f.options,
    selected: { ...f.selected, fiscalSelection: undefined },
  });
  await expect(service.prepare({ action: "clock-challenge" })).rejects.toMatchObject({
    code: "module.operation_invalid",
  });
  expect(() => service.runner(null)).toThrowError("module.operation_invalid");
  expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
});

it("refuses a selected backup whose named key no longer matches the database", async () => {
  const f = await host();
  const service = createSelectedRecoveryPreparation({
    ...f.options,
    selected: { ...f.selected, nodeRecoveryKeyName: "another retained key" },
  });
  await expect(service.prepare({ action: "clock-challenge" })).rejects.toMatchObject({
    code: "module.operation_invalid",
  });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
});

it("admits recovery from the real validated archive preview with its public spent-hour floor", async () => {
  const f = await host();
  const manifest = await buildManifest({
    db: suite.db,
    modules: ALL_MODULES,
    environment: "preproduction",
    now: new Date(),
  });
  const database = join(root, "backup.db");
  await suite.db.archiveTo(database);
  const artifact = encryptArtifact(
    packArchive([
      { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
      { name: "db.dump", bytes: await readFile(database) },
      {
        name: "secrets/trading.env",
        bytes: Buffer.from(
          `WAITRON_TILL_NODE_ID=${node.nodeId}\nWAITRON_TILL_LOCATION_ID=${node.locationId}\n`,
        ),
      },
      { name: "secrets/node-key.enc", bytes: Buffer.from("sealed") },
      { name: "secrets/cluster-id", bytes: Buffer.from("cluster") },
      {
        name: "secrets/credentials.key",
        bytes: Buffer.from(Buffer.alloc(32, 7).toString("base64")),
      },
      {
        name: "secrets/modules.json",
        bytes: Buffer.from(
          JSON.stringify({ modules: { "fiscal-verifactu": true, "fiscal-none": false } }),
        ),
      },
      {
        name: "secrets/module-evidence/fiscal-verifactu/hour-history.json",
        bytes: Buffer.from(
          JSON.stringify({
            reference: "prepared-hours",
            complete: true,
            records: [
              {
                ...scope,
                reference: "backup/abandoned-hour",
                kind: "intent",
                softwareId: "OTHER",
                nodeId: node.nodeId,
                identity: "06RD",
                recordedAtMs: Date.parse("2026-10-16T13:10:00Z"),
              },
            ],
          }),
        ),
      },
    ]),
    "separate archive password",
  );
  const selected = await previewRecoveryArchive({
    artifact,
    recoveryKey: "separate archive password",
    stateDir: f.roots.stateDir,
    stagingDir: join(root, "preview"),
    modules: ALL_MODULES,
    migrationsRoot: null,
    environment: "preproduction",
  });
  expect(selected.nodeRecoveryKeyName).toBe(key.name);
  expect(selected.fiscalSelection?.module).toBe(binding.module);
  const service = createSelectedRecoveryPreparation({
    ...f.options,
    binding: { ...binding, sourceId: selected.sourceId },
    selected,
  });
  const compare = async () => {
    const challenge = (await service.prepare({ action: "clock-challenge" })) as { id: string };
    await service.prepare({
      action: "compare-clocks",
      browser: { challengeId: challenge.id, instantMs: Date.now() },
    });
  };
  await compare();
  await expect(service.prepare({ action: "select", answer: "no" })).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "hour_not_later" },
  });
  vi.setSystemTime(new Date("2026-10-16T14:40:00Z"));
  await compare();
  const outcome = (await service.prepare({ action: "select", answer: "no" })) as {
    identity: string;
    input: unknown;
  };
  expect(outcome.identity).toBe("06RE");
  await runRestoreHooks({
    db: suite.db,
    node,
    modules: service.modules,
    log: () => {},
    withModuleOperations: service.runner(outcome.input),
  });
  expect(
    (await suite.db.select().from(invoiceSeries))
      .filter((row) => row.retiredAt === null)
      .map((row) => row.code),
  ).toEqual(["A-06RE", "FF-06RE", "R-06RE"]);
});

it("finishes an already committed restore after restart without selecting or comparing clocks again", async () => {
  const first = await host();
  await first.compare();
  const selected = (await first.prepare({ action: "select", answer: "no" })) as { input: unknown };
  await runRestoreHooks({
    db: suite.db,
    node,
    modules: first.configured,
    log: () => {},
    withModuleOperations: first.service.runner(selected.input),
  });
  const before = await suite.db.select().from(invoiceSeries);
  const next = await host();
  next.facts.priorActivation = "committed";
  external.internet.mockClear();
  await runRestoreHooks({
    db: suite.db,
    node,
    modules: next.configured,
    log: () => {},
    withModuleOperations: next.service.runner(selected.input),
    resumeOperation: binding,
  });
  expect(await suite.db.select().from(invoiceSeries)).toEqual(before);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(2);
  expect(await readModulePreparationHistory(next.roots, binding.module)).toHaveLength(1);
  expect(external.internet).not.toHaveBeenCalled();
});

describe("the database supplied by the placement runner", () => {
  const placed = useVenueDb({ migrations: TEST_MIGRATIONS });
  it("checks the selected named key against the placed copy rather than a still-open preview", async () => {
    const f = await host();
    await f.compare();
    const selected = (await f.prepare({ action: "select", answer: "no" })) as { input: unknown };
    await seedTenants(placed.db);
    await stampDeployment(placed.db, "preproduction");
    const verifier = await readBreakGlassVerifier(suite.db, node.nodeId);
    await withTransaction(placed.db, (tx) =>
      setBreakGlassVerifierTx(tx, node.nodeId, verifier!, "different-copy-key"),
    );
    await expect(
      runRestoreHooks({
        db: placed.db,
        node,
        modules: f.configured,
        log: () => {},
        withModuleOperations: f.service.runner(selected.input),
      }),
    ).rejects.toMatchObject({ code: "module.operation_invalid" });
    expect(await placed.db.select().from(invoiceSeries)).toEqual([]);
    expect(await placed.db.select().from(fiscalAllocations)).toEqual([]);
  });
});

it("refuses preparation through a configured module after its source binding changes", async () => {
  const f = await host();
  const other = { ...binding, sourceId: "another-copy" };
  const contribution = f.configured.find((module) => module.name === binding.module)!.operations!;
  await expect(
    withRecoveryKeyAuthority(
      { db: suite.db, nodeId: node.nodeId },
      other,
      key.secret,
      (authority) =>
        contribution.recovery!({ binding: other, authority }, { action: "clock-challenge" }),
    ),
  ).rejects.toMatchObject({ code: "module.operation_invalid" });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
});

it("refuses a selected module that has no configured recovery contribution", async () => {
  const f = await host();
  const service = createSelectedRecoveryPreparation({ ...f.options, modules: [] });
  await expect(service.prepare({ action: "clock-challenge" })).rejects.toMatchObject({
    code: "module.operation_invalid",
  });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
});

it("refuses an unnamed recovery verifier even when its secret matches", async () => {
  const f = await host();
  const verifier = await readBreakGlassVerifier(suite.db, node.nodeId);
  await withTransaction(suite.db, (tx) =>
    setBreakGlassVerifierTx(tx, node.nodeId, verifier!, null),
  );
  const service = createSelectedRecoveryPreparation({
    ...f.options,
    selected: { ...f.selected, nodeRecoveryKeyName: null },
  });
  await expect(service.prepare({ action: "clock-challenge" })).rejects.toMatchObject({
    code: "module.operation_invalid",
  });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
});

it("binds manual recovery clock confirmation to the displayed comparison", async () => {
  const f = await host();
  const comparison = (await f.prepare({ action: "compare-clocks", browser: null })) as {
    id: string;
  };
  await expect(f.prepare({ action: "select", answer: "no" })).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "clock_unconfirmed" },
  });
  await expect(
    f.prepare({ action: "confirm-clock", comparisonId: "other-comparison" }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "clock_confirmation_required" },
  });
  await f.prepare({ action: "confirm-clock", comparisonId: comparison.id });
  expect(await f.prepare({ action: "preview" })).toMatchObject({
    status: "preview",
    identity: "06RC",
  });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
  expect(await f.prepare({ action: "select", answer: "no" })).toMatchObject({
    status: "selected",
    identity: "06RC",
  });
  await f.prepare({ action: "clock-challenge" });
  await expect(f.prepare({ action: "select", answer: "no" })).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "clock_stale" },
  });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toHaveLength(1);
});

it("binds a bucket selection to its exact activation point rather than its generation label", async () => {
  const f = await host();
  const service = createSelectedRecoveryPreparation({
    ...f.options,
    selected: {
      ...f.selected,
      sourceId: "stream:venue:generation",
      activationSourceId: binding.sourceId,
    },
  });
  const challenge = (await service.prepare({ action: "clock-challenge" })) as { id: string };
  await service.prepare({
    action: "compare-clocks",
    browser: { challengeId: challenge.id, instantMs: Date.now() },
  });
  expect(await service.prepare({ action: "select", answer: "no" })).toMatchObject({
    status: "selected",
    identity: "06RC",
  });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toHaveLength(1);
});

it("retains the recovery wait's monotonic budget across fresh comparisons after a wall jump", async () => {
  const f = await host();
  await f.compare();
  expect(await f.prepare({ action: "select", answer: "yes" })).toMatchObject({
    status: "waiting",
    targetMs: Date.parse("2026-10-16T13:00:00Z"),
    remainingMs: 1200000,
  });
  vi.setSystemTime(new Date("2026-10-16T13:10:00Z"));
  await f.compare();
  expect(await f.prepare({ action: "select", answer: "yes" })).toMatchObject({
    status: "waiting",
    targetMs: Date.parse("2026-10-16T13:00:00Z"),
    remainingMs: 1200000,
  });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toHaveLength(1);
});
