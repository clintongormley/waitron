import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  invoiceSeries,
  openVenueDatabase,
  readBreakGlassVerifier,
  setBreakGlassVerifierTx,
  stampDeployment,
  withTransaction,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ALL_MODULES } from "@waitron/composition";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { withOperationAuthority, type OperationBinding } from "@waitron/module";
import { createFirstSetupCoordinator, readModulePreparationHistory } from "@waitron/provisioning";
import { createHourPreparation } from "@waitron/fiscal-verifactu/src/hour-preparation.js";
import { compareHourClocks } from "@waitron/fiscal-verifactu/src/hour-clock.js";
import { readHourHistory } from "@waitron/fiscal-verifactu/src/hour-history-reader.js";
import { activatePreparedModuleAllocation } from "@waitron/fiscal-verifactu/src/allocation-preparation.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { seedTenants, TENANT_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import { AppError, locationId, seriesId } from "@waitron/shared";
import { mintBreakGlassKey } from "./break-glass.js";
import { createRecoveryRestoreRunner } from "./recovery-module-operation.js";
import { runRestoreHooks, restoreFromArtifact, restoreFromArtifactFile } from "./restore.js";
import { createSelectedRecoveryPreparation } from "./recovery-preparation.js";
import { withRecoveryKeyAuthority } from "./operation-authentication.js";
import { buildManifest } from "./backup-manifest.js";
import { packArchive, unpackArchive } from "./backup-archive.js";
import { decryptArtifact, encryptArtifact } from "./artifact-cipher.js";
import { previewRecoveryArchive, previewRecoveryStream } from "./recovery-backup-preview.js";
import { restoreFromStream, writeStreamRestore } from "./restore-stream.js";
import { recoveryStreamSourceId } from "./recovery-source.js";
import { runRestore } from "./restore-command.js";
import { encodeArchiveRecoveryPack } from "./archive-recovery-pack.js";
import { runStagedRestore, stageRestoreRequest } from "./restore-request.js";
import { eq, sql } from "drizzle-orm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { recordSale } from "@waitron/core";
import { assertValid, computeHuella } from "@waitron/verifactu";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { VerifactuBackend } from "@waitron/fiscal-verifactu/src/backend.js";
import { drain } from "@waitron/fiscal-verifactu/src/drain.js";
import { decodeRegistroRow, fromRegistroRow } from "@waitron/fiscal-verifactu/src/registro-row.js";
import { saleInput, steadyClock } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { createCloudRecoveryClient } from "./cloud-recovery.js";
import { generateNodeKeyPair } from "@waitron/membership";
import { encodeRecoveryKit, signPointer, writePointer } from "@waitron/stream";
import { createMemoryObjectStore } from "@waitron/stream/testing/memory-store.js";
import { sealNodeState, writeSealedStateRow } from "./sealed-state.js";

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

describe("module-owned recovery facts from the actual database", () => {
  async function databaseHost() {
    const f = await host();
    const { readRecoveryFacts: omitted, ...options } = f.options;
    void omitted;
    const isolation = {
      oldMachineAbsent: false,
      oldMachineOffline: true,
      noParallelRecovery: true,
    };
    const service = createSelectedRecoveryPreparation({
      ...options,
      readIsolation: async () => isolation,
    });
    const compare = async () => {
      const challenge = (await service.prepare({ action: "clock-challenge" })) as { id: string };
      return service.prepare({
        action: "compare-clocks",
        browser: { challengeId: challenge.id, instantMs: Date.now() },
      });
    };
    return { ...f, service, compare, isolation, options };
  }

  it("selects from retained full-purpose bases and history without a supplied fiscal facts callback", async () => {
    const f = await databaseHost();
    const before = await suite.db.select().from(invoiceSeries);
    await f.compare();
    const selected = (await f.service.prepare({ action: "select", answer: "no" })) as {
      identity: string;
      input: unknown;
    };
    expect(selected.identity).toBe("06RC");
    expect(await suite.db.select().from(invoiceSeries)).toEqual(before);
    await runRestoreHooks({
      db: suite.db,
      node,
      modules: f.service.modules,
      log: () => {},
      withModuleOperations: f.service.runner(selected.input),
    });
    const after = await suite.db.select().from(invoiceSeries);
    expect(
      after
        .filter((row) => row.retiredAt === null)
        .map(({ code, purpose, nextNumber }) => ({
          code,
          purpose,
          nextNumber,
        })),
    ).toEqual([
      { code: "A-06RC", purpose: "standard", nextNumber: 1 },
      { code: "FF-06RC", purpose: "full", nextNumber: 1 },
      { code: "R-06RC", purpose: "rectificative", nextNumber: 1 },
    ]);
    for (const row of before)
      expect(after.find((entry) => entry.id === row.id)).toEqual({
        ...row,
        retiredAt: expect.any(Date),
      });
  });

  it("recognises an exact committed restore after reconstruction without trusting a caller's replay flag", async () => {
    const first = await databaseHost();
    await first.compare();
    const selected = (await first.service.prepare({ action: "select", answer: "no" })) as {
      input: unknown;
    };
    await runRestoreHooks({
      db: suite.db,
      node,
      modules: first.service.modules,
      log: () => {},
      withModuleOperations: first.service.runner(selected.input),
    });
    const before = await suite.db.select().from(invoiceSeries);
    const next = await databaseHost();
    external.internet.mockClear();
    await runRestoreHooks({
      db: suite.db,
      node,
      modules: next.service.modules,
      log: () => {},
      withModuleOperations: next.service.runner(selected.input),
      resumeOperation: binding,
    });
    expect(await suite.db.select().from(invoiceSeries)).toEqual(before);
    expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(2);
    expect(await readModulePreparationHistory(next.roots, binding.module)).toHaveLength(1);
    expect(external.internet).not.toHaveBeenCalled();
  });

  it("refuses a live old seller supplied by the real isolation reader before spending an hour", async () => {
    const f = await databaseHost();
    f.isolation.oldMachineOffline = false;
    await f.compare();
    await expect(f.service.prepare({ action: "select", answer: "no" })).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "old_machine_active" },
    });
    expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
    expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
  });

  it("keeps fiscal bases owned by the database when an isolation callback returns extra fields", async () => {
    const f = await databaseHost();
    const service = createSelectedRecoveryPreparation({
      ...f.options,
      readIsolation: async () => ({
        ...f.isolation,
        bases: [{ code: "WRONG", purpose: "standard" }],
      }),
    });
    const challenge = (await service.prepare({ action: "clock-challenge" })) as { id: string };
    await service.prepare({
      action: "compare-clocks",
      browser: { challengeId: challenge.id, instantMs: Date.now() },
    });
    const selected = await service.prepare({ action: "select", answer: "no" });
    expect(selected).toMatchObject({
      input: {
        allocation: {
          series: [
            { code: "A-06RC", purpose: "standard" },
            { code: "FF-06RC", purpose: "full" },
            { code: "R-06RC", purpose: "rectificative" },
          ],
        },
      },
    });
  });
});

describe("selected-hour admission before archive placement", () => {
  async function archiveHost(kind: "archive" | "stream" = "archive") {
    const f = await host();
    const manifest = await buildManifest({
      db: suite.db,
      modules: ALL_MODULES,
      environment: "preproduction",
      now: new Date(),
    });
    const database = join(root, "archive.db");
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
        { name: "secrets/node-key.enc", bytes: Buffer.from("synthetic sealed node key") },
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
      ]),
      "archive password",
    );
    const restore = {
      ...f.roots,
      stagingDir: root,
      migrationsRoot: null,
      modules: ALL_MODULES,
      environment: "preproduction" as const,
      artifact,
      recoveryKey: "archive password",
      log: () => {},
    };
    let selected = await previewRecoveryArchive(restore);
    const entries = unpackArchive(decryptArtifact(artifact, "archive password")).filter(
      (entry) => entry.name !== "db.dump",
    );
    if (kind === "stream")
      selected = {
        ...selected,
        sourceId: "stream:venue:original-generation",
        activationSourceId: await recoveryStreamSourceId(database, entries),
      };
    const { readRecoveryFacts: omitted, ...base } = f.options;
    void omitted;
    const isolation = {
      oldMachineAbsent: false,
      oldMachineOffline: true,
      noParallelRecovery: true,
    };
    const options = {
      ...base,
      modules: ALL_MODULES,
      selected,
      binding: { ...binding, sourceId: selected.activationSourceId ?? selected.sourceId },
      readIsolation: async () => isolation,
    };
    const service = createSelectedRecoveryPreparation(options);
    const challenge = (await service.prepare({ action: "clock-challenge" })) as { id: string };
    await service.prepare({
      action: "compare-clocks",
      browser: { challengeId: challenge.id, instantMs: Date.now() },
    });
    const outcome = (await service.prepare({ action: "select", answer: "no" })) as {
      input: unknown;
    };
    return { ...f, restore, options, isolation, service, outcome, database, entries };
  }

  it.each(["archive", "file"])(
    "preserves the original database and identity when the %s key admission fails",
    async (kind) => {
      const f = await archiveHost();
      await writeFile(join(f.roots.venueDir, "venue.db"), "original destination database");
      await writeFile(join(f.roots.stateDir, "trading.env"), "original destination identity");
      const wrong = createSelectedRecoveryPreparation({ ...f.options, secret: "wrong node key" });
      const withModuleOperations = wrong.runner(f.outcome.input);
      const attempt =
        kind === "archive"
          ? restoreFromArtifact({ ...f.restore, modules: wrong.modules, withModuleOperations })
          : (async () => {
              const artifactPath = join(root, "incoming.wbk");
              await writeFile(artifactPath, f.restore.artifact);
              return restoreFromArtifactFile({
                ...f.restore,
                artifactPath,
                modules: wrong.modules,
                withModuleOperations,
              });
            })();
      await expect(attempt).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
      expect(await readFile(join(f.roots.venueDir, "venue.db"), "utf8")).toBe(
        "original destination database",
      );
      expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
        "original destination identity",
      );
    },
  );

  it("the default restore command refuses a wrong node key before replacing the destination", async () => {
    const f = await archiveHost();
    const artifactPath = join(root, "command.backup.enc");
    const operationPath = join(root, "command-operation.json");
    await writeFile(artifactPath, f.restore.artifact);
    await writeFile(
      operationPath,
      JSON.stringify({ binding: f.options.binding, input: f.outcome.input }),
    );
    await writeFile(join(f.roots.venueDir, "venue.db"), "original destination database");
    await writeFile(join(f.roots.stateDir, "trading.env"), "original destination identity");
    const output: string[] = [];
    expect(
      await runRestore({
        argv: ["restore", artifactPath, "--confirm-old-box-gone"],
        env: {
          WAITRON_ENV: "dev",
          WAITRON_STATE_DIR: f.roots.stateDir,
          WAITRON_VENUE_DIR: f.roots.venueDir,
          WAITRON_BACKUP_RECOVERY_KEY: "archive password",
          WAITRON_RECOVERY_OPERATION_FILE: operationPath,
          WAITRON_NODE_RECOVERY_KEY: "wrong node key",
        },
        out: (line) => output.push(line),
        restore: (request) => restoreFromArtifactFile({ ...request, migrationsRoot: null }),
      }),
    ).toBe(1);
    expect(await readFile(join(f.roots.venueDir, "venue.db"), "utf8")).toBe(
      "original destination database",
    );
    expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
      "original destination identity",
    );
    expect(output.join("\n")).toContain(
      "restore failed: promotion.break_glass_invalid — use the selected backup's node recovery key",
    );
  });

  it("a valid node key without module preparation refuses before replacing the destination", async () => {
    const f = await archiveHost();
    await writeFile(join(f.roots.venueDir, "venue.db"), "original destination database");
    await writeFile(join(f.roots.stateDir, "trading.env"), "original destination identity");
    await expect(
      restoreFromArtifact({
        ...f.restore,
        withModuleOperations: createRecoveryRestoreRunner(
          ALL_MODULES,
          { binding: f.options.binding, input: f.outcome.input },
          key.secret,
        ),
      }),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
    expect(await readFile(join(f.roots.venueDir, "venue.db"), "utf8")).toBe(
      "original destination database",
    );
    expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
      "original destination identity",
    );
  });

  it.each(["archive", "stream"] as const)(
    "the default staged %s restore refuses a wrong node key before replacing the destination",
    async (kind) => {
      const f = await archiveHost(kind);
      const recoveryOperation = { binding: f.options.binding, input: f.outcome.input };
      await stageRestoreRequest(
        f.roots.stateDir,
        kind === "archive"
          ? {
              artifact: f.restore.artifact,
              recoveryKey: "archive password",
              environment: "preproduction",
              recoveryOperation,
              nodeRecoverySecret: "wrong node key",
            }
          : {
              kind: "stream",
              databasePath: f.database,
              entries: f.entries,
              environment: "preproduction",
              recoveryOperation,
              nodeRecoverySecret: "wrong node key",
            },
      );
      await writeFile(join(f.roots.venueDir, "venue.db"), "original destination database");
      await writeFile(join(f.roots.stateDir, "trading.env"), "original destination identity");
      await expect(runStagedRestore(f.restore)).rejects.toMatchObject({
        code: "promotion.break_glass_invalid",
      });
      expect(await readFile(join(f.roots.venueDir, "venue.db"), "utf8")).toBe(
        "original destination database",
      );
      expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
        "original destination identity",
      );
    },
  );

  it.each([
    ["archive", "key"],
    ["stream", "key"],
    ["archive", "preparation"],
    ["stream", "preparation"],
  ] as const)(
    "retries a staged %s %s refusal against the selected copy after reconstruction",
    async (kind, refusal) => {
      const f = await archiveHost(kind);
      const recoveryOperation = { binding: f.options.binding, input: f.outcome.input };
      await stageRestoreRequest(
        f.roots.stateDir,
        kind === "archive"
          ? {
              artifact: f.restore.artifact,
              recoveryKey: "archive password",
              environment: "preproduction",
              recoveryOperation,
              nodeRecoverySecret: refusal === "key" ? "wrong node key" : key.secret,
            }
          : {
              kind: "stream",
              databasePath: f.database,
              entries: f.entries,
              environment: "preproduction",
              recoveryOperation,
              nodeRecoverySecret: refusal === "key" ? "wrong node key" : key.secret,
            },
      );
      await writeFile(join(f.roots.venueDir, "venue.db"), "original destination database");
      await writeFile(join(f.roots.stateDir, "trading.env"), "original destination identity");
      const marker = await readFile(join(f.roots.stateDir, "restore-request.json"), "utf8");
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(runStagedRestore({ ...f.restore })).rejects.toMatchObject({
          code: refusal === "key" ? "promotion.break_glass_invalid" : "sif.allocation_invalid",
          ...(refusal === "preparation"
            ? { params: { reason: "outside_confirmation_missing" } }
            : {}),
        });
        expect(await readFile(join(f.roots.stateDir, "restore-request.json"), "utf8")).toBe(marker);
        expect(await readFile(join(f.roots.venueDir, "venue.db"), "utf8")).toBe(
          "original destination database",
        );
        expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
          "original destination identity",
        );
      }
    },
  );

  it.each(["archive", "stream"] as const)(
    "retains fresh staged %s admission across two separate processes",
    async (kind) => {
      const f = await archiveHost(kind);
      const credentials = {
        environment: "preproduction" as const,
        recoveryOperation: { binding: f.options.binding, input: f.outcome.input },
        nodeRecoverySecret: "wrong node key",
      };
      await stageRestoreRequest(
        f.roots.stateDir,
        kind === "archive"
          ? { ...credentials, artifact: f.restore.artifact, recoveryKey: "archive password" }
          : { ...credentials, kind: "stream", databasePath: f.database, entries: f.entries },
      );
      await writeFile(join(f.roots.venueDir, "venue.db"), "original destination database");
      await writeFile(join(f.roots.stateDir, "trading.env"), "original destination identity");
      const marker = await readFile(join(f.roots.stateDir, "restore-request.json"), "utf8");
      const source = `
        import { runStagedRestore } from ${JSON.stringify(new URL("./restore-request.ts", import.meta.url).href)};
        try {
          await runStagedRestore({ ...JSON.parse(process.argv[1]), log() {} });
          process.stdout.write(JSON.stringify({ outcome: "restored" }));
        } catch (error) {
          process.stdout.write(JSON.stringify({ code: error.code }));
        }
      `;
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await promisify(execFile)(
          process.execPath,
          [
            "--import",
            import.meta.resolve("tsx"),
            "--input-type=module",
            "-e",
            source,
            JSON.stringify({ ...f.roots, migrationsRoot: null }),
          ],
          { timeout: 45_000 },
        );
        expect(JSON.parse(result.stdout)).toEqual({ code: "promotion.break_glass_invalid" });
        expect(await readFile(join(f.roots.stateDir, "restore-request.json"), "utf8")).toBe(marker);
        expect(await readFile(join(f.roots.venueDir, "venue.db"), "utf8")).toBe(
          "original destination database",
        );
        expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
          "original destination identity",
        );
      }
    },
    120_000,
  );

  it("clears an unstored-credential request after its injected admission refuses", async () => {
    const f = await archiveHost();
    await stageRestoreRequest(f.roots.stateDir, {
      artifact: f.restore.artifact,
      recoveryKey: "archive password",
      environment: "preproduction",
    });
    const wrong = createSelectedRecoveryPreparation({ ...f.options, secret: "wrong node key" });
    await expect(
      runStagedRestore({ ...f.restore, withModuleOperations: wrong.runner(f.outcome.input) }),
    ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
    await expect(readFile(join(f.roots.stateDir, "restore-request.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(f.roots.stateDir, "restore-request.key"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("checks fresh isolation before replacing the destination or its identity", async () => {
    const f = await archiveHost();
    await writeFile(join(f.roots.venueDir, "venue.db"), "original destination database");
    await writeFile(join(f.roots.stateDir, "trading.env"), "original destination identity");
    f.isolation.oldMachineOffline = false;
    await expect(
      restoreFromArtifact({
        ...f.restore,
        modules: f.service.modules,
        withModuleOperations: f.service.runner(f.outcome.input),
      }),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "old_machine_active" },
    });
    expect(await readFile(join(f.roots.venueDir, "venue.db"), "utf8")).toBe(
      "original destination database",
    );
    expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
      "original destination identity",
    );
  });

  it("refuses another encrypted archive with the same database and key before replacement", async () => {
    const f = await archiveHost();
    await writeFile(join(f.roots.venueDir, "venue.db"), "original destination database");
    const artifact = encryptArtifact(
      decryptArtifact(f.restore.artifact, "archive password"),
      "archive password",
    );
    await expect(
      restoreFromArtifact({
        ...f.restore,
        artifact,
        modules: f.service.modules,
        withModuleOperations: f.service.runner(f.outcome.input),
      }),
    ).rejects.toMatchObject({ code: "module.operation_invalid" });
    expect(await readFile(join(f.roots.venueDir, "venue.db"), "utf8")).toBe(
      "original destination database",
    );
  });

  it.each(["archive", "stream"] as const)(
    "refuses an older selected hour before replacing a newer surviving %s destination",
    async (kind) => {
      const f = await archiveHost(kind);
      vi.setSystemTime(new Date("2026-10-16T13:40:00Z"));
      const newerState = join(root, "newer-state");
      await mkdir(newerState);
      const newer = createSelectedRecoveryPreparation({
        ...f.options,
        stateDir: newerState,
        binding: { ...f.options.binding, eventId: "newer-surviving-target" },
      });
      const challenge = (await newer.prepare({ action: "clock-challenge" })) as { id: string };
      await newer.prepare({
        action: "compare-clocks",
        browser: { challengeId: challenge.id, instantMs: Date.now() },
      });
      const selected = (await newer.prepare({ action: "select", answer: "no" })) as {
        identity: string;
        input: unknown;
      };
      expect(selected.identity).toBe("06RD");
      await runRestoreHooks({
        db: suite.db,
        node,
        modules: newer.modules,
        log: () => {},
        withModuleOperations: newer.runner(selected.input),
      });
      const before = await suite.db.select().from(invoiceSeries);
      const fresh = (await f.service.prepare({ action: "clock-challenge" })) as { id: string };
      await f.service.prepare({
        action: "compare-clocks",
        browser: { challengeId: fresh.id, instantMs: Date.now() },
      });
      await suite.db.archiveTo(join(f.roots.venueDir, "venue.db"));
      await writeFile(join(f.roots.stateDir, "trading.env"), "surviving destination identity");
      await expect(
        kind === "archive"
          ? restoreFromArtifact({
              ...f.restore,
              modules: f.service.modules,
              withModuleOperations: f.service.runner(f.outcome.input),
            })
          : writeStreamRestore({
              ...f.restore,
              databasePath: f.database,
              entries: f.entries,
              modules: f.service.modules,
              withModuleOperations: f.service.runner(f.outcome.input),
            }),
      ).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "hour_not_later" },
      });
      const retained = await openVenueDatabase(f.roots.venueDir);
      try {
        expect(await retained.venue.select().from(invoiceSeries)).toEqual(before);
        expect(await retained.venue.select().from(fiscalAllocations)).toHaveLength(2);
      } finally {
        await retained.close();
      }
      expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
        "surviving destination identity",
      );
    },
  );

  it.each(["archive", "stream"] as const)(
    "allows a lower surviving %s history while retaining the recovered counters",
    async (kind) => {
      const f = await archiveHost(kind);
      await suite.db.update(invoiceSeries).set({ nextNumber: 456 });
      await suite.db.archiveTo(join(f.roots.venueDir, "venue.db"));
      if (kind === "archive")
        await restoreFromArtifact({
          ...f.restore,
          modules: f.service.modules,
          withModuleOperations: f.service.runner(f.outcome.input),
        });
      else
        await writeStreamRestore({
          ...f.restore,
          databasePath: f.database,
          entries: f.entries,
          modules: f.service.modules,
          withModuleOperations: f.service.runner(f.outcome.input),
        });
      const result = await openVenueDatabase(f.roots.venueDir);
      try {
        const rows = await result.venue.select().from(invoiceSeries);
        expect(
          rows
            .filter((row) => row.retiredAt !== null)
            .map(({ code, nextNumber }) => ({ code, nextNumber })),
        ).toEqual([
          { code: "A-06RB", nextNumber: 123 },
          { code: "FF-06RB", nextNumber: 123 },
          { code: "R-06RB", nextNumber: 123 },
        ]);
        expect(
          rows
            .filter((row) => row.retiredAt === null)
            .map(({ code, nextNumber }) => ({ code, nextNumber })),
        ).toEqual([
          { code: "A-06RC", nextNumber: 1 },
          { code: "FF-06RC", nextNumber: 1 },
          { code: "R-06RC", nextNumber: 1 },
        ]);
        expect(await result.venue.select().from(fiscalAllocations)).toHaveLength(2);
      } finally {
        await result.close();
      }
    },
  );

  it("refuses unreadable surviving history before changing the destination or its identity", async () => {
    const f = await archiveHost();
    await writeFile(join(f.roots.venueDir, "venue.db"), "damaged surviving database");
    await writeFile(join(f.roots.stateDir, "trading.env"), "surviving destination identity");
    await expect(
      restoreFromArtifact({
        ...f.restore,
        modules: f.service.modules,
        withModuleOperations: f.service.runner(f.outcome.input),
      }),
    ).rejects.toMatchObject({ code: "module.operation_invalid" });
    expect(await readFile(join(f.roots.venueDir, "venue.db"), "utf8")).toBe(
      "damaged surviving database",
    );
    expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
      "surviving destination identity",
    );
  });

  it("refuses a destination whose database path is a directory", async () => {
    const f = await archiveHost();
    await mkdir(join(f.roots.venueDir, "venue.db"));
    await writeFile(join(f.roots.stateDir, "trading.env"), "surviving destination identity");
    await expect(
      restoreFromArtifact({
        ...f.restore,
        modules: f.service.modules,
        withModuleOperations: f.service.runner(f.outcome.input),
      }),
    ).rejects.toMatchObject({ code: "module.operation_invalid" });
    expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
      "surviving destination identity",
    );
  });

  it.each(["missing", "refusing"] as const)(
    "refuses a %s module history reader without replacing the surviving database",
    async (kind) => {
      const f = await archiveHost();
      await suite.db.archiveTo(join(f.roots.venueDir, "venue.db"));
      const before = await suite.db.select().from(invoiceSeries);
      const modules = f.options.modules.map((module) =>
        module.name !== binding.module
          ? module
          : {
              ...module,
              operations: {
                ...module.operations!,
                readRecoveryHistory:
                  kind === "missing"
                    ? undefined
                    : async () => {
                        throw new AppError("sif.allocation_invalid", { reason: "history_invalid" });
                      },
              },
            },
      );
      const service = createSelectedRecoveryPreparation({ ...f.options, modules });
      await expect(
        restoreFromArtifact({
          ...f.restore,
          modules: service.modules,
          withModuleOperations: service.runner(f.outcome.input),
        }),
      ).rejects.toMatchObject(
        kind === "missing"
          ? { code: "module.operation_invalid" }
          : {
              code: "sif.allocation_invalid",
              params: { reason: "history_invalid" },
            },
      );
      const retained = await openVenueDatabase(f.roots.venueDir);
      try {
        expect(await retained.venue.select().from(invoiceSeries)).toEqual(before);
      } finally {
        await retained.close();
      }
    },
  );

  it("places an admitted archive and retires recovered series without changing their counters", async () => {
    const f = await archiveHost();
    const original = await suite.db.select().from(invoiceSeries);
    await restoreFromArtifact({
      ...f.restore,
      modules: f.service.modules,
      withModuleOperations: f.service.runner(f.outcome.input),
    });
    const placed = await openVenueDatabase(f.roots.venueDir);
    try {
      const after = await placed.venue.select().from(invoiceSeries);
      for (const row of original)
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
      expect(await placed.venue.select().from(fiscalAllocations)).toHaveLength(2);
    } finally {
      await placed.close();
    }
  });

  it("finishes a placed archive after service reconstruction without new clocks or another identity", async () => {
    const f = await archiveHost();
    await restoreFromArtifact({
      ...f.restore,
      modules: f.service.modules,
      withModuleOperations: f.service.runner(f.outcome.input),
    });
    const placed = await openVenueDatabase(f.roots.venueDir);
    let before: (typeof invoiceSeries.$inferSelect)[];
    try {
      await placed.venue
        .update(invoiceSeries)
        .set({ nextNumber: 124 })
        .where(eq(invoiceSeries.code, "A-06RC"));
      before = await placed.venue.select().from(invoiceSeries);
    } finally {
      await placed.close();
    }
    const next = createSelectedRecoveryPreparation(f.options);
    external.internet.mockClear();
    await restoreFromArtifact({
      ...f.restore,
      modules: next.modules,
      withModuleOperations: next.runner(f.outcome.input),
      resumeOperation: f.options.binding,
    });
    const result = await openVenueDatabase(f.roots.venueDir);
    try {
      expect(await result.venue.select().from(invoiceSeries)).toEqual(before);
      expect(await result.venue.select().from(fiscalAllocations)).toHaveLength(2);
    } finally {
      await result.close();
    }
    expect(external.internet).not.toHaveBeenCalled();
    expect(await readModulePreparationHistory(f.roots, binding.module)).toHaveLength(1);
  });

  it.each(["key", "source", "seller"])(
    "retains the original destination on a bucket point's %s refusal",
    async (refusal) => {
      const f = await archiveHost("stream");
      const original = Buffer.from("original destination database");
      await writeFile(join(f.roots.venueDir, "venue.db"), original);
      const service =
        refusal === "key"
          ? createSelectedRecoveryPreparation({ ...f.options, secret: "wrong key" })
          : f.service;
      if (refusal === "seller") f.isolation.oldMachineOffline = false;
      const entries =
        refusal === "source"
          ? [...f.entries, { name: "secrets/extra.txt", bytes: Buffer.from("different-point") }]
          : f.entries;
      const expected =
        refusal === "key"
          ? { code: "promotion.break_glass_invalid" }
          : refusal === "source"
            ? { code: "module.operation_invalid" }
            : { code: "sif.allocation_invalid", params: { reason: "old_machine_active" } };
      await expect(
        writeStreamRestore({
          ...f.restore,
          databasePath: f.database,
          entries,
          modules: service.modules,
          withModuleOperations: service.runner(f.outcome.input),
        }),
      ).rejects.toMatchObject(expected);
      expect((await readFile(join(f.roots.venueDir, "venue.db"))).equals(original)).toBe(true);
    },
  );

  it("places the selected bucket point and preserves every recovered counter", async () => {
    const f = await archiveHost("stream");
    const original = await suite.db.select().from(invoiceSeries);
    await writeStreamRestore({
      ...f.restore,
      databasePath: f.database,
      entries: f.entries,
      modules: f.service.modules,
      withModuleOperations: f.service.runner(f.outcome.input),
    });
    const placed = await openVenueDatabase(f.roots.venueDir);
    try {
      const after = await placed.venue.select().from(invoiceSeries);
      for (const row of original)
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
      expect(await placed.venue.select().from(fiscalAllocations)).toHaveLength(2);
    } finally {
      await placed.close();
    }
  });

  it.each(["archive", "file", "stream", "managed"] as const)(
    "%s recovery retains issued invoices and filing receipts before selling on the fresh hour",
    async (source) => {
      const clock = {
        ...steadyClock,
        now: () => ({ ...steadyClock.now(), instant: new Date(), offsetMinutes: 120 }),
      };
      const aeat = createFakeAeat({ serverNow: new Date() });
      const backend = (db: Database) =>
        new VerifactuBackend({
          db,
          clock,
          deploymentEnvironment: "preproduction",
          environment: "preproduction",
          resolveClient: async () => aeat.client(),
        });
      const sell = (db: Database, id: string) =>
        withTransaction(db, (tx) =>
          recordSale(
            tx,
            backend(db),
            saleInput({
              nodeId: node.nodeId,
              seriesId: seriesId(id),
              clock,
              settlement: {
                kind: "immediate",
                tenders: [
                  { method: "card", amount: "16.31", tipAmount: "1.90", settledAt: new Date() },
                ],
              },
            }),
          ),
        );
      const [standard] = await suite.db
        .select()
        .from(invoiceSeries)
        .where(eq(invoiceSeries.code, "A-06RB"));
      const first = await sell(suite.db, standard!.id);
      const submitted = await drain(
        {
          db: suite.db,
          resolveClient: async () => aeat.client(),
          environment: "preproduction",
          skipRetryMs: 300_000,
        },
        new Date(),
      );
      expect(submitted.recordsAccepted).toBe(1);
      const second = await sell(suite.db, standard!.id);
      const snapshot = async (db: Database) => ({
        sales: (await db.execute(sql`select * from sales order by id`)).rows,
        lines: (await db.execute(sql`select * from sale_lines order by sale_id, line_no`)).rows,
        tenders: (await db.execute(sql`select * from tenders order by id`)).rows,
        settlements: (await db.execute(sql`select * from sale_settlements order by id`)).rows,
        records: (await db.execute(sql`select * from registros_facturacion order by secuencia`))
          .rows,
        submissions: (await db.execute(sql`select * from envios order by registro_id`)).rows,
      });
      const before = await snapshot(suite.db);
      expect(before.records.map((row) => row.num_serie_factura)).toEqual([
        "A-06RB/123",
        "A-06RB/124",
      ]);
      expect(before.records[1]?.anterior_huella).toBe(before.records[0]?.huella);
      expect(
        before.submissions.find((row) => row.registro_id === before.records[0]?.id),
      ).toMatchObject({
        estado: "aceptado",
        intentos: 1,
        csv: expect.any(String),
        confirmado_en: expect.any(String),
      });
      expect(
        before.submissions.find((row) => row.registro_id === before.records[1]?.id),
      ).toMatchObject({
        estado: "pendiente",
        intentos: 0,
        csv: null,
        confirmado_en: null,
      });
      for (const row of before.records) {
        const record = fromRegistroRow(decodeRegistroRow(row));
        assertValid(record);
        expect(computeHuella(record)).toBe(row.huella);
      }
      const originalSeries = await suite.db.select().from(invoiceSeries);
      const f = await archiveHost(source === "stream" ? "stream" : "archive");
      const common = {
        ...f.restore,
        modules: f.service.modules,
        withModuleOperations: f.service.runner(f.outcome.input),
      };
      if (source === "stream") {
        await writeStreamRestore({ ...common, databasePath: f.database, entries: f.entries });
      } else if (source === "file") {
        const artifactPath = join(root, "historical.backup.enc");
        await writeFile(artifactPath, f.restore.artifact);
        await restoreFromArtifactFile({ ...common, artifactPath });
      } else if (source === "managed") {
        const pointId = "047bacd4-df70-4881-a835-c6dd75ae7ecf";
        const point = {
          id: pointId,
          venueId: node.locationId,
          capturedAt: new Date().toISOString(),
          modules: (
            await buildManifest({
              db: suite.db,
              modules: ALL_MODULES,
              environment: "preproduction",
              now: new Date(),
            })
          ).modules,
          digest: createHash("sha256").update(f.restore.artifact).digest("hex"),
          size: f.restore.artifact.length,
          objectKey: `snapshots/${pointId}`,
          verification: "verified",
          kind: "snapshot",
          deleting: false,
          deletedAt: null,
        };
        const expiresAt = new Date(Date.now() + 900_000).toISOString();
        const client = createCloudRecoveryClient({
          stateDir: f.roots.stateDir,
          origin: "https://cloud.example.test",
          environment: "preproduction",
          fetch: async (url, init) => {
            const action = new URL(String(url)).pathname.split("/").at(-1);
            const body = JSON.parse(String(init?.body)) as { payload: string };
            if (action === "start" || action === "status")
              return Response.json({
                requestId: JSON.parse(Buffer.from(body.payload, "base64url").toString())[2],
                state: action === "start" ? "awaiting_owner" : "approved",
                expiresAt,
                operationId:
                  action === "start"
                    ? null
                    : JSON.parse(Buffer.from(body.payload, "base64url").toString())[2],
              });
            if (action === "info") return Response.json({ point, operationExpiresAt: expiresAt });
            if (action === "read")
              return Response.json({
                point,
                location: {
                  endpoint: "https://store.example.test",
                  bucket: "copy",
                  region: "local",
                },
                credentials: {
                  accessKeyId: "unused",
                  secretAccessKey: "unused",
                  sessionToken: "unused",
                },
                recoveryKey: "archive password",
                expiresAt,
                operationExpiresAt: expiresAt,
              });
            throw new Error(`unexpected Cloud recovery action ${action}`);
          },
          download: async () => f.restore.artifact,
        });
        await client.start();
        await client.restore(async (request) => {
          await restoreFromArtifact({ ...common, ...request });
        }, pointId);
      } else {
        await restoreFromArtifact(common);
      }
      const placed = await openVenueDatabase(f.roots.venueDir);
      try {
        expect(await snapshot(placed.venue)).toEqual(before);
        const series = await placed.venue.select().from(invoiceSeries);
        for (const row of originalSeries)
          expect(series.find((entry) => entry.id === row.id)).toEqual({
            ...row,
            retiredAt: expect.any(Date),
          });
        expect(
          series
            .filter((row) => row.retiredAt === null)
            .map(({ code, nextNumber }) => ({ code, nextNumber })),
        ).toEqual([
          { code: "A-06RC", nextNumber: 1 },
          { code: "FF-06RC", nextNumber: 1 },
          { code: "R-06RC", nextNumber: 1 },
        ]);
        await expect(sell(placed.venue, standard!.id)).rejects.toMatchObject({
          code: "sale.series_retired",
        });
        const fresh = series.find((row) => row.code === "A-06RC")!;
        const resumed = await sell(placed.venue, fresh.id);
        const afterSale = await snapshot(placed.venue);
        expect(afterSale.sales.filter((row) => row.id !== resumed.saleId)).toEqual(before.sales);
        expect(afterSale.lines.filter((row) => row.sale_id !== resumed.saleId)).toEqual(
          before.lines,
        );
        expect(afterSale.tenders.filter((row) => row.sale_id !== resumed.saleId)).toEqual(
          before.tenders,
        );
        expect(afterSale.settlements.filter((row) => row.sale_id !== resumed.saleId)).toEqual(
          before.settlements,
        );
        expect(afterSale.records.filter((row) => row.sale_id !== resumed.saleId)).toEqual(
          before.records,
        );
        expect(
          afterSale.submissions.filter(
            (row) =>
              !afterSale.records.some(
                (record) => record.sale_id === resumed.saleId && record.id === row.registro_id,
              ),
          ),
        ).toEqual(before.submissions);
        expect(afterSale.records.find((row) => row.sale_id === resumed.saleId)).toMatchObject({
          num_serie_factura: "A-06RC/1",
          primer_registro: 1,
          anterior_huella: null,
        });
        expect(afterSale.sales.map((row) => row.id).sort()).toEqual(
          [first.saleId, second.saleId, resumed.saleId].sort(),
        );
        expect(await placed.venue.select().from(fiscalAllocations)).toHaveLength(2);
      } finally {
        await placed.close();
      }
      const committed = await openVenueDatabase(f.roots.venueDir);
      let afterIssuance: Awaited<ReturnType<typeof snapshot>>;
      let afterSeries: (typeof invoiceSeries.$inferSelect)[];
      try {
        afterIssuance = await snapshot(committed.venue);
        afterSeries = await committed.venue.select().from(invoiceSeries);
      } finally {
        await committed.close();
      }
      const next = createSelectedRecoveryPreparation(f.options);
      vi.setSystemTime(new Date("2026-10-17T13:10:00Z"));
      external.internet.mockClear();
      const replay = {
        ...f.restore,
        modules: next.modules,
        withModuleOperations: next.runner(f.outcome.input),
        resumeOperation: f.options.binding,
      };
      if (source === "stream") {
        await writeFile(
          f.database,
          unpackArchive(decryptArtifact(f.restore.artifact, "archive password")).find(
            (entry) => entry.name === "db.dump",
          )!.bytes,
        );
        await writeStreamRestore({ ...replay, databasePath: f.database, entries: f.entries });
      } else {
        await restoreFromArtifact(replay);
      }
      const reopened = await openVenueDatabase(f.roots.venueDir);
      try {
        expect(await snapshot(reopened.venue)).toEqual(afterIssuance);
        expect(await reopened.venue.select().from(invoiceSeries)).toEqual(afterSeries);
        expect(await reopened.venue.select().from(fiscalAllocations)).toHaveLength(2);
      } finally {
        await reopened.close();
      }
      expect(external.internet).not.toHaveBeenCalled();
      expect(await readModulePreparationHistory(f.roots, binding.module)).toHaveLength(1);
    },
  );

  it("refreshes reconstructed recovery clocks before archive admission without changing its hour", async () => {
    const f = await archiveHost();
    const before = await readModulePreparationHistory(f.roots, binding.module);
    external.internet.mockImplementation(async () => ({
      source: "internet",
      result: "usable",
      instantMs: Date.now(),
      uncertaintyMs: 0,
      wallStartedMs: Date.now(),
      wallFinishedMs: Date.now(),
      monotonicStartedMs: performance.now(),
      monotonicFinishedMs: performance.now(),
    }));
    const reconstructed = createSelectedRecoveryPreparation(f.options);
    await restoreFromArtifact({
      ...f.restore,
      withModuleOperations: reconstructed.runner(f.outcome.input, { refresh: true }),
    });
    const restored = await openVenueDatabase(f.roots.venueDir);
    try {
      expect(
        (await restored.venue.select().from(invoiceSeries))
          .filter((row) => row.retiredAt === null)
          .map(({ code, nextNumber }) => ({ code, nextNumber })),
      ).toEqual([
        { code: "A-06RC", nextNumber: 1 },
        { code: "FF-06RC", nextNumber: 1 },
        { code: "R-06RC", nextNumber: 1 },
      ]);
    } finally {
      await restored.close();
    }
    expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual(before);
  });

  async function archiveCommand(f: Awaited<ReturnType<typeof archiveHost>>) {
    const artifactPath = join(root, "entry.backup.enc");
    const operationPath = join(root, "entry-operation.json");
    const migrationRoot = join(root, "migrations");
    await mkdir(migrationRoot);
    const sets = manifestSets();
    const folders = migrationOptionsFor(sets, null);
    for (const [index, set] of sets.entries())
      await symlink(folders[index]!.migrationsFolder, join(migrationRoot, set.name));
    await writeFile(artifactPath, f.restore.artifact);
    await writeFile(
      operationPath,
      JSON.stringify({ binding: f.options.binding, input: f.outcome.input }),
    );
    return {
      artifactPath,
      operationPath,
      argv: ["restore", artifactPath, "--confirm-old-box-gone", "--confirm-sole-recovery"],
      env: {
        WAITRON_ENV: "dev",
        WAITRON_STATE_DIR: f.roots.stateDir,
        WAITRON_VENUE_DIR: f.roots.venueDir,
        WAITRON_MIGRATIONS_DIR: migrationRoot,
        WAITRON_BACKUP_RECOVERY_KEY: "archive password",
        WAITRON_RECOVERY_OPERATION_FILE: operationPath,
        WAITRON_NODE_RECOVERY_KEY: key.secret,
      },
    };
  }

  it("the default archive command reconstructs selected-hour preparation with explicit isolation", async () => {
    const f = await archiveHost();
    const command = await archiveCommand(f);
    const journal = await readModulePreparationHistory(f.roots, binding.module);
    external.internet.mockImplementation(async () => ({
      source: "internet",
      result: "usable",
      instantMs: Date.now(),
      uncertaintyMs: 0,
      wallStartedMs: Date.now(),
      wallFinishedMs: Date.now(),
      monotonicStartedMs: performance.now(),
      monotonicFinishedMs: performance.now(),
    }));
    const output: string[] = [];
    const result = await runRestore({
      ...command,
      out: (line) => output.push(line),
    });
    expect(output.join("\n")).toContain(`restored ${command.artifactPath}`);
    expect(result).toBe(0);
    const restored = await openVenueDatabase(f.roots.venueDir);
    try {
      const rows = await restored.venue.select().from(invoiceSeries);
      expect(rows.filter((row) => row.retiredAt === null).map((row) => row.code)).toEqual([
        "A-06RC",
        "FF-06RC",
        "R-06RC",
      ]);
      expect(rows.filter((row) => row.retiredAt !== null).map((row) => row.nextNumber)).toEqual([
        123, 123, 123,
      ]);
      expect(await restored.venue.select().from(fiscalAllocations)).toHaveLength(2);
    } finally {
      await restored.close();
    }
    expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual(journal);
    expect(output.join("\n")).not.toContain(key.secret);
    expect(output.join("\n")).not.toContain("archive password");
  });

  it.each([
    "offline",
    "disagreement",
    "old seller",
    "wrong node key",
    "wrong archive password",
    "wrong source",
    "missing sole confirmation",
  ])("the default archive command refuses %s before replacing the destination", async (reason) => {
    const f = await archiveHost();
    const command = await archiveCommand(f);
    external.internet.mockImplementation(async () =>
      reason === "offline"
        ? { source: "internet", result: "unavailable", reason: "offline" }
        : {
            source: "internet",
            result: "usable",
            instantMs: Date.now() + (reason === "disagreement" ? 180_000 : 0),
            uncertaintyMs: 0,
            wallStartedMs: Date.now(),
            wallFinishedMs: Date.now(),
            monotonicStartedMs: performance.now(),
            monotonicFinishedMs: performance.now(),
          },
    );
    if (reason === "old seller")
      command.argv = command.argv.filter((arg) => arg !== "--confirm-old-box-gone");
    if (reason === "missing sole confirmation")
      command.argv = command.argv.filter((arg) => arg !== "--confirm-sole-recovery");
    if (reason === "wrong node key") command.env.WAITRON_NODE_RECOVERY_KEY = "wrong node key";
    if (reason === "wrong archive password")
      command.env.WAITRON_BACKUP_RECOVERY_KEY = "wrong archive password";
    if (reason === "wrong source")
      await writeFile(
        command.operationPath,
        JSON.stringify({
          binding: { ...f.options.binding, sourceId: "another artifact" },
          input: f.outcome.input,
        }),
      );
    await suite.db.update(invoiceSeries).set({ nextNumber: 456 });
    await suite.db.archiveTo(join(f.roots.venueDir, "venue.db"));
    const previous = await suite.db.select().from(invoiceSeries);
    const previousAllocations = await suite.db.select().from(fiscalAllocations);
    external.internet.mockClear();
    await writeFile(join(f.roots.stateDir, "trading.env"), "untouched identity");
    const journal = await readModulePreparationHistory(f.roots, binding.module);
    const output: string[] = [];
    expect(await runRestore({ ...command, out: (line) => output.push(line) })).toBe(1);
    const retained = await openVenueDatabase(f.roots.venueDir);
    try {
      expect(await retained.venue.select().from(invoiceSeries)).toEqual(previous);
      expect(await retained.venue.select().from(fiscalAllocations)).toEqual(previousAllocations);
    } finally {
      await retained.close();
    }
    expect(external.internet).toHaveBeenCalledTimes(
      ["offline", "disagreement", "old seller"].includes(reason) ? 1 : 0,
    );
    expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
      "untouched identity",
    );
    expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual(journal);
    expect(output.join("\n")).not.toContain(key.secret);
    expect(output.join("\n")).not.toContain(command.env.WAITRON_BACKUP_RECOVERY_KEY);
  });

  it("a reconstructed committed recovery refreshes no clocks or hour intent", async () => {
    const f = await archiveHost();
    await restoreFromArtifact({
      ...f.restore,
      withModuleOperations: f.service.runner(f.outcome.input),
    });
    const restored = await openVenueDatabase(f.roots.venueDir);
    try {
      await restored.venue.update(invoiceSeries).set({ nextNumber: 917 });
      const rows = await restored.venue.select().from(invoiceSeries);
      const allocations = await restored.venue.select().from(fiscalAllocations);
      const journal = await readModulePreparationHistory(f.roots, binding.module);
      vi.setSystemTime(new Date("2026-10-17T14:40:00Z"));
      external.internet.mockClear();
      const reconstructed = createSelectedRecoveryPreparation(f.options);
      await runRestoreHooks({
        db: restored.venue,
        node,
        modules: ALL_MODULES,
        log: () => {},
        withModuleOperations: reconstructed.runner(f.outcome.input, { refresh: true }),
        resumeOperation: f.options.binding,
      });
      expect(external.internet).not.toHaveBeenCalled();
      expect(await restored.venue.select().from(invoiceSeries)).toEqual(rows);
      expect(await restored.venue.select().from(fiscalAllocations)).toEqual(allocations);
      expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual(journal);
    } finally {
      await restored.close();
    }
  });

  it("refreshes again when the same reconstructed runner retries refused clock admission", async () => {
    const f = await archiveHost();
    const reconstructed = createSelectedRecoveryPreparation(f.options);
    const runner = reconstructed.runner(f.outcome.input, { refresh: true });
    await expect(
      restoreFromArtifact({ ...f.restore, withModuleOperations: runner }),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "clock_unconfirmed" },
    });
    external.internet.mockImplementation(async () => ({
      source: "internet",
      result: "usable",
      instantMs: Date.now(),
      uncertaintyMs: 0,
      wallStartedMs: Date.now(),
      wallFinishedMs: Date.now(),
      monotonicStartedMs: performance.now(),
      monotonicFinishedMs: performance.now(),
    }));
    await restoreFromArtifact({ ...f.restore, withModuleOperations: runner });
    const restored = await openVenueDatabase(f.roots.venueDir);
    try {
      expect(
        (await restored.venue.select().from(invoiceSeries))
          .filter((row) => row.retiredAt === null)
          .map((row) => row.code),
      ).toEqual(["A-06RC", "FF-06RC", "R-06RC"]);
      expect(await restored.venue.select().from(fiscalAllocations)).toHaveLength(2);
    } finally {
      await restored.close();
    }
  });

  it("the archive-pack command uses the downloaded exact archive and the pack password", async () => {
    const f = await archiveHost();
    const command = await archiveCommand(f);
    const packPath = join(root, "archive-pack.txt");
    const archiveKey = "waitron-20261016T114000Z-00000000-0000-4000-8000-000000000001.backup.enc";
    await writeFile(
      packPath,
      encodeArchiveRecoveryPack({
        version: 1,
        format: "WBK1",
        venueId: "olivo",
        bucket: {
          region: "eu-west-1",
          bucket: "synthetic-bucket",
          prefix: "",
          accessKeyId: "synthetic-access",
          secretAccessKey: "synthetic-secret",
        },
        archivePrefix: "archives/olivo/",
        recoveryKey: "archive password",
      }),
    );
    external.internet.mockImplementation(async () => ({
      source: "internet",
      result: "usable",
      instantMs: Date.now(),
      uncertaintyMs: 0,
      wallStartedMs: Date.now(),
      wallFinishedMs: Date.now(),
      monotonicStartedMs: performance.now(),
      monotonicFinishedMs: performance.now(),
    }));
    command.env.WAITRON_BACKUP_RECOVERY_KEY = "unused environment password";
    const output: string[] = [];
    const unexpected = async (): Promise<never> => {
      throw new Error("unexpected archive transport call");
    };
    const result = await runRestore({
      env: command.env,
      argv: [
        "restore",
        "--from-archive",
        packPath,
        "--archive-key",
        archiveKey,
        "--confirm-old-box-gone",
        "--confirm-sole-recovery",
      ],
      out: (line) => output.push(line),
      openArchiveFiles: (bucket) => {
        expect(bucket.prefix).toBe("archives/olivo/");
        return {
          putFile: unexpected,
          putBytes: unexpected,
          readStream: unexpected,
          deleteMany: unexpected,
          list: async (prefix) => {
            expect(prefix).toBe(archiveKey);
            return [{ key: archiveKey, size: f.restore.artifact.length, lastModified: new Date() }];
          },
          getFile: async (name, path) => {
            expect(name).toBe(archiveKey);
            await writeFile(path, f.restore.artifact);
          },
          close() {},
        };
      },
    });
    expect(result).toBe(0);
    expect(output.at(-1)).toBe(
      `restored archive ${archiveKey} from the bucket named in ${packPath}`,
    );
    const restored = await openVenueDatabase(f.roots.venueDir);
    try {
      const rows = await restored.venue.select().from(invoiceSeries);
      expect(rows.filter((row) => row.retiredAt === null).map((row) => row.code)).toEqual([
        "A-06RC",
        "FF-06RC",
        "R-06RC",
      ]);
      expect(rows.filter((row) => row.retiredAt !== null).map((row) => row.nextNumber)).toEqual([
        123, 123, 123,
      ]);
    } finally {
      await restored.close();
    }
    expect(await readdir(join(f.roots.stateDir, "restore-staging"))).toEqual([]);
  });

  it("refreshes each new placement admission when a reconstructed runner is reused", async () => {
    const f = await archiveHost();
    external.internet.mockImplementation(async () => ({
      source: "internet",
      result: "usable",
      instantMs: Date.now(),
      uncertaintyMs: 0,
      wallStartedMs: Date.now(),
      wallFinishedMs: Date.now(),
      monotonicStartedMs: performance.now(),
      monotonicFinishedMs: performance.now(),
    }));
    const reconstructed = createSelectedRecoveryPreparation(f.options);
    const runner = reconstructed.runner(f.outcome.input, { refresh: true });
    const context = { db: suite.db, node, sourceId: f.options.binding.sourceId };
    await runner.checkBeforePlacement!(context);
    vi.advanceTimersByTime(31_000);
    await runner.checkBeforePlacement!(context);
    expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
    expect((await suite.db.select().from(invoiceSeries)).map((row) => row.nextNumber)).toEqual([
      123, 123, 123,
    ]);
  });

  async function bucketCommand() {
    const f = await archiveHost("stream");
    const command = await archiveCommand(f);
    const signer = generateNodeKeyPair();
    const generation = `gen-0-${node.nodeId}-20261016T124000Z`;
    const kit = {
      version: 1 as const,
      venueId: node.locationId,
      bucket: {
        region: "eu-west-1",
        bucket: "synthetic-hour-recovery",
        prefix: "",
        accessKeyId: "synthetic-access",
        secretAccessKey: "synthetic-secret",
      },
      recoveryKey: "separate bucket password",
      pointerSignerPublicKey: signer.publicKey,
    };
    await writeSealedStateRow(
      suite.db,
      node.nodeId,
      await sealNodeState(f.entries, kit.recoveryKey),
      new Date(),
    );
    await suite.db.archiveTo(f.database);
    const kitPath = join(root, "bucket-kit.txt");
    await writeFile(kitPath, encodeRecoveryKit(kit));
    const store = createMemoryObjectStore({ now: () => new Date() });
    await writePointer(
      store,
      kit.venueId,
      signPointer(
        {
          venueId: kit.venueId,
          nodeId: node.nodeId,
          generation,
          term: 0,
          writtenAt: new Date().toISOString(),
        },
        signer.privateKey,
      ),
      null,
    );
    const selected = await previewRecoveryStream({
      ...f.restore,
      kit,
      oldBoxGone: true,
      now: () => new Date(),
      litestreamBin: "/unused",
      openStore: () => store,
      restoreGeneration: async ({ outPath }) => {
        await copyFile(f.database, outPath);
      },
    });
    const operationBinding = {
      ...f.options.binding,
      sourceId: selected.activationSourceId!,
      eventId: "bucket-entry",
    };
    vi.setSystemTime(new Date("2026-10-16T13:40:00Z"));
    const service = createSelectedRecoveryPreparation({
      ...f.options,
      binding: operationBinding,
      selected,
    });
    const challenge = (await service.prepare({ action: "clock-challenge" })) as { id: string };
    await service.prepare({
      action: "compare-clocks",
      browser: { challengeId: challenge.id, instantMs: Date.now() },
    });
    const outcome = (await service.prepare({ action: "select", answer: "no" })) as {
      input: unknown;
    };
    await writeFile(
      command.operationPath,
      JSON.stringify({ binding: operationBinding, input: outcome.input }),
    );
    external.internet.mockImplementation(async () => ({
      source: "internet",
      result: "usable",
      instantMs: Date.now(),
      uncertaintyMs: 0,
      wallStartedMs: Date.now(),
      wallFinishedMs: Date.now(),
      monotonicStartedMs: performance.now(),
      monotonicFinishedMs: performance.now(),
    }));
    const failures: unknown[] = [];
    return {
      f,
      command,
      kitPath,
      kit,
      failures,
      deps: {
        env: command.env,
        argv: [
          "restore",
          "--from-bucket",
          kitPath,
          "--confirm-venue",
          scope.taxpayerNif,
          "--confirm-old-box-gone",
          "--confirm-sole-recovery",
        ],
        openStore: () => store,
        restoreStream: (args: Parameters<typeof restoreFromStream>[0]) =>
          restoreFromStream({
            ...args,
            restoreGeneration: async ({ outPath }) => {
              await copyFile(f.database, outPath);
            },
          }).catch((error) => {
            failures.push(error);
            throw error;
          }),
      },
    };
  }

  it("the bucket command reconstructs selected-hour admission from the downloaded exact point", async () => {
    const { f, deps, kitPath } = await bucketCommand();
    const journal = await readModulePreparationHistory(f.roots, binding.module);
    const output: string[] = [];
    const downloader = join(root, "synthetic-litestream.cjs");
    await writeFile(
      downloader,
      `#!${process.execPath}\nrequire("node:fs").copyFileSync(${JSON.stringify(f.database)}, process.argv[process.argv.indexOf("-o") + 1]);\n`,
      { mode: 0o700 },
    );
    const result = await runRestore({
      ...deps,
      env: { ...deps.env, WAITRON_LITESTREAM_BIN: downloader },
      restoreStream: undefined,
      out: (line) => output.push(line),
    });
    expect(output.at(-1)).toBe(`restored from the bucket named in ${kitPath}`);
    expect(result).toBe(0);
    const restored = await openVenueDatabase(f.roots.venueDir);
    try {
      const rows = await restored.venue.select().from(invoiceSeries);
      expect(rows.filter((row) => row.retiredAt === null).map((row) => row.code)).toEqual([
        "A-06RD",
        "FF-06RD",
        "R-06RD",
      ]);
      expect(rows.filter((row) => row.retiredAt !== null).map((row) => row.nextNumber)).toEqual([
        123, 123, 123,
      ]);
      expect(await restored.venue.select().from(fiscalAllocations)).toHaveLength(2);
    } finally {
      await restored.close();
    }
    expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual(journal);
    expect(output.join("\n")).not.toContain(key.secret);
    expect(output.join("\n")).not.toContain("separate bucket password");
    expect(
      (await readdir(f.roots.stateDir)).filter((name) => name.startsWith("stream-restore-")),
    ).toEqual([]);
  });

  it.each([
    ["offline", "sif.allocation_invalid"],
    ["disagreement", "sif.allocation_invalid"],
    ["old seller", "sif.allocation_invalid"],
    ["missing sole confirmation", "sif.allocation_invalid"],
    ["wrong node key", "promotion.break_glass_invalid"],
    ["wrong bucket password", "recovery.passphrase_invalid"],
    ["changed point", "module.operation_invalid"],
    ["unconfirmed venue", "restore.stream_venue_unconfirmed"],
  ])("the bucket command retains the destination after %s", async (reason, code) => {
    const { f, command, kitPath, kit, deps, failures } = await bucketCommand();
    if (reason === "offline")
      external.internet.mockResolvedValue({
        source: "internet",
        result: "unavailable",
        reason: "offline",
      });
    if (reason === "disagreement")
      external.internet.mockImplementation(async () => ({
        source: "internet",
        result: "usable",
        instantMs: Date.now() + 180_000,
        uncertaintyMs: 0,
        wallStartedMs: Date.now(),
        wallFinishedMs: Date.now(),
        monotonicStartedMs: performance.now(),
        monotonicFinishedMs: performance.now(),
      }));
    if (reason === "old seller")
      deps.argv = deps.argv.filter((arg) => arg !== "--confirm-old-box-gone");
    if (reason === "missing sole confirmation")
      deps.argv = deps.argv.filter((arg) => arg !== "--confirm-sole-recovery");
    if (reason === "wrong node key") command.env.WAITRON_NODE_RECOVERY_KEY = "wrong node key";
    if (reason === "wrong bucket password")
      await writeFile(kitPath, encodeRecoveryKit({ ...kit, recoveryKey: "wrong bucket password" }));
    if (reason === "unconfirmed venue")
      deps.argv[deps.argv.indexOf("--confirm-venue") + 1] = "another taxpayer";
    if (reason === "changed point") {
      await suite.db.update(invoiceSeries).set({ nextNumber: 789 });
      await suite.db.archiveTo(f.database);
    }
    await suite.db.update(invoiceSeries).set({ nextNumber: 456 });
    await suite.db.archiveTo(join(f.roots.venueDir, "venue.db"));
    const previous = await suite.db.select().from(invoiceSeries);
    const allocations = await suite.db.select().from(fiscalAllocations);
    await writeFile(join(f.roots.stateDir, "trading.env"), "untouched bucket destination");
    const journal = await readModulePreparationHistory(f.roots, binding.module);
    const output: string[] = [];
    expect(await runRestore({ ...deps, out: (line) => output.push(line) })).toBe(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ code });
    const retained = await openVenueDatabase(f.roots.venueDir);
    try {
      expect(await retained.venue.select().from(invoiceSeries)).toEqual(previous);
      expect(await retained.venue.select().from(fiscalAllocations)).toEqual(allocations);
    } finally {
      await retained.close();
    }
    expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
      "untouched bucket destination",
    );
    expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual(journal);
    expect(output.join("\n")).not.toContain(key.secret);
    expect(output.join("\n")).not.toContain(kit.recoveryKey);
    expect(
      (await readdir(f.roots.stateDir)).filter((name) => name.startsWith("stream-restore-")),
    ).toEqual([]);
  });

  it.each(["archive", "stream"] as const)(
    "reconstructs selected-hour preparation for staged %s recovery",
    async (kind) => {
      const f = await archiveHost(kind);
      const credentials = {
        environment: "preproduction" as const,
        recoveryOperation: { binding: f.options.binding, input: f.outcome.input },
        nodeRecoverySecret: key.secret,
        recoveryContext: {
          selectedSourceId: f.options.selected.sourceId,
          oldBoxGone: true,
          soleRecovery: true,
        },
      };
      await stageRestoreRequest(
        f.roots.stateDir,
        kind === "archive"
          ? { ...credentials, artifact: f.restore.artifact, recoveryKey: "archive password" }
          : { ...credentials, kind: "stream", databasePath: f.database, entries: f.entries },
      );
      external.internet.mockImplementation(async () => ({
        source: "internet",
        result: "usable",
        instantMs: Date.now(),
        uncertaintyMs: 0,
        wallStartedMs: Date.now(),
        wallFinishedMs: Date.now(),
        monotonicStartedMs: performance.now(),
        monotonicFinishedMs: performance.now(),
      }));
      const journal = await readModulePreparationHistory(f.roots, binding.module);
      expect(await runStagedRestore(f.restore)).toBe(true);
      const restored = await openVenueDatabase(f.roots.venueDir);
      try {
        const rows = await restored.venue.select().from(invoiceSeries);
        expect(rows.filter((row) => row.retiredAt === null).map((row) => row.code)).toEqual([
          "A-06RC",
          "FF-06RC",
          "R-06RC",
        ]);
        expect(rows.filter((row) => row.retiredAt !== null).map((row) => row.nextNumber)).toEqual([
          123, 123, 123,
        ]);
        expect(await restored.venue.select().from(fiscalAllocations)).toHaveLength(2);
      } finally {
        await restored.close();
      }
      expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual(journal);
      expect(await runStagedRestore(f.restore)).toBe(false);
      expect(
        (await readdir(f.roots.stateDir)).filter((name) => name.startsWith("restore-request")),
      ).toEqual([]);
    },
  );

  it.each(["bad source", "coerced old-box flag", "coerced sole flag", "missing key"])(
    "refuses staged recovery context with %s before writing a request",
    async (reason) => {
      const f = await archiveHost();
      const context = {
        selectedSourceId: reason === "bad source" ? "" : f.options.selected.sourceId,
        oldBoxGone: reason === "coerced old-box flag" ? "true" : true,
        soleRecovery: reason === "coerced sole flag" ? "true" : true,
      };
      const before = await readdir(f.roots.stateDir);
      await expect(
        stageRestoreRequest(f.roots.stateDir, {
          artifact: f.restore.artifact,
          recoveryKey: "archive password",
          environment: "preproduction",
          recoveryOperation: { binding: f.options.binding, input: f.outcome.input },
          ...(reason === "missing key" ? {} : { nodeRecoverySecret: key.secret }),
          recoveryContext: context as never,
        }),
      ).rejects.toMatchObject({ code: "server.config_invalid" });
      expect(await readdir(f.roots.stateDir)).toEqual(before);
    },
  );

  it.each([
    ["archive", "offline"],
    ["stream", "offline"],
    ["archive", "old seller"],
    ["stream", "old seller"],
    ["archive", "parallel recovery"],
    ["stream", "parallel recovery"],
    ["archive", "wrong key"],
    ["stream", "wrong key"],
  ] as const)(
    "retains staged %s recovery after a reconstructed %s refusal",
    async (kind, reason) => {
      const f = await archiveHost(kind);
      const credentials = {
        environment: "preproduction" as const,
        recoveryOperation: { binding: f.options.binding, input: f.outcome.input },
        nodeRecoverySecret: reason === "wrong key" ? "wrong node key" : key.secret,
        recoveryContext: {
          selectedSourceId: f.options.selected.sourceId,
          oldBoxGone: reason !== "old seller",
          soleRecovery: reason !== "parallel recovery",
        },
      };
      await stageRestoreRequest(
        f.roots.stateDir,
        kind === "archive"
          ? { ...credentials, artifact: f.restore.artifact, recoveryKey: "archive password" }
          : { ...credentials, kind: "stream", databasePath: f.database, entries: f.entries },
      );
      await suite.db.update(invoiceSeries).set({ nextNumber: 456 });
      await suite.db.archiveTo(join(f.roots.venueDir, "venue.db"));
      await writeFile(join(f.roots.stateDir, "trading.env"), "staged destination identity");
      const previous = await suite.db.select().from(invoiceSeries);
      const allocations = await suite.db.select().from(fiscalAllocations);
      const marker = await readFile(join(f.roots.stateDir, "restore-request.json"), "utf8");
      const journal = await readModulePreparationHistory(f.roots, binding.module);
      if (reason !== "offline")
        external.internet.mockImplementation(async () => ({
          source: "internet",
          result: "usable",
          instantMs: Date.now(),
          uncertaintyMs: 0,
          wallStartedMs: Date.now(),
          wallFinishedMs: Date.now(),
          monotonicStartedMs: performance.now(),
          monotonicFinishedMs: performance.now(),
        }));
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(runStagedRestore(f.restore)).rejects.toMatchObject({
          code: reason === "wrong key" ? "promotion.break_glass_invalid" : "sif.allocation_invalid",
        });
        const retained = await openVenueDatabase(f.roots.venueDir);
        try {
          expect(await retained.venue.select().from(invoiceSeries)).toEqual(previous);
          expect(await retained.venue.select().from(fiscalAllocations)).toEqual(allocations);
        } finally {
          await retained.close();
        }
        expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
          "staged destination identity",
        );
        expect(await readFile(join(f.roots.stateDir, "restore-request.json"), "utf8")).toBe(marker);
        expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual(journal);
        expect(
          (await readdir(f.roots.stateDir)).filter((name) => name.startsWith("restore-entry-")),
        ).toEqual([]);
      }
    },
  );

  it.each(["archive", "stream"] as const)(
    "replays staged %s recovery after process death following committed placement",
    async (kind) => {
      const f = await archiveHost(kind);
      const credentials = {
        environment: "preproduction" as const,
        recoveryOperation: { binding: f.options.binding, input: f.outcome.input },
        nodeRecoverySecret: key.secret,
        recoveryContext: {
          selectedSourceId: f.options.selected.sourceId,
          oldBoxGone: true,
          soleRecovery: true,
        },
      };
      await stageRestoreRequest(
        f.roots.stateDir,
        kind === "archive"
          ? { ...credentials, artifact: f.restore.artifact, recoveryKey: "archive password" }
          : { ...credentials, kind: "stream", databasePath: f.database, entries: f.entries },
      );
      const internetModule = `export async function observeInternetHourClock() {
        return { source: "internet", result: "usable", instantMs: Date.now(), uncertaintyMs: 0,
          wallStartedMs: Date.now(), wallFinishedMs: Date.now(),
          monotonicStartedMs: performance.now(), monotonicFinishedMs: performance.now() };
      }`;
      const releaseModule = `export function readHourRelease() { return { instantMs: Date.parse("2026-10-15T00:00:00Z") }; }`;
      const source = `
        import { registerHooks } from "node:module";
        const realDate = Date;
        globalThis.Date = class extends realDate {
          constructor(...args) { super(...(args.length ? args : ["2026-10-16T12:40:00Z"])); }
          static now() { return realDate.parse("2026-10-16T12:40:00Z"); }
        };
        registerHooks({ resolve(specifier, context, next) {
          if (specifier.endsWith("/hour-clock-internet.js")) return { shortCircuit: true, url: ${JSON.stringify(`data:text/javascript,${encodeURIComponent(internetModule)}`)} };
          if (specifier.endsWith("/hour-release.js")) return { shortCircuit: true, url: ${JSON.stringify(`data:text/javascript,${encodeURIComponent(releaseModule)}`)} };
          return next(specifier, context);
        }});
        const { runStagedRestore } = await import(${JSON.stringify(new URL("./restore-request.ts", import.meta.url).href)});
        const { restoreFromArtifactFile } = await import(${JSON.stringify(new URL("./restore.ts", import.meta.url).href)});
        const { writeStreamRestore } = await import(${JSON.stringify(new URL("./restore-stream.ts", import.meta.url).href)});
        await runStagedRestore({ ...JSON.parse(process.argv[1]), log() {} },
          async (args) => { await restoreFromArtifactFile(args); process.kill(process.pid, "SIGKILL"); },
          async (args) => { await writeStreamRestore(args); process.kill(process.pid, "SIGKILL"); });
      `;
      await expect(
        promisify(execFile)(
          process.execPath,
          [
            "--import",
            import.meta.resolve("tsx"),
            "--input-type=module",
            "-e",
            source,
            JSON.stringify({ ...f.roots, migrationsRoot: null }),
          ],
          { timeout: 45_000 },
        ),
      ).rejects.toMatchObject({ signal: "SIGKILL" });
      expect(
        JSON.parse(await readFile(join(f.roots.stateDir, "restore-request.json"), "utf8")),
      ).toMatchObject({ placementStarted: true });
      const restored = await openVenueDatabase(f.roots.venueDir);
      let rows;
      let allocations;
      try {
        expect(
          (await restored.venue.select().from(invoiceSeries))
            .filter((row) => row.retiredAt === null)
            .map((row) => row.code),
        ).toEqual(["A-06RC", "FF-06RC", "R-06RC"]);
        await restored.venue.update(invoiceSeries).set({ nextNumber: 917 });
        rows = await restored.venue.select().from(invoiceSeries);
        allocations = await restored.venue.select().from(fiscalAllocations);
      } finally {
        await restored.close();
      }
      const journal = await readModulePreparationHistory(f.roots, binding.module);
      vi.setSystemTime(new Date("2026-10-17T14:40:00Z"));
      external.internet.mockClear();
      expect(await runStagedRestore(f.restore)).toBe(true);
      expect(external.internet).not.toHaveBeenCalled();
      const replayed = await openVenueDatabase(f.roots.venueDir);
      try {
        expect(await replayed.venue.select().from(invoiceSeries)).toEqual(rows);
        expect(await replayed.venue.select().from(fiscalAllocations)).toEqual(allocations);
      } finally {
        await replayed.close();
      }
      expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual(journal);
      expect(await runStagedRestore(f.restore)).toBe(false);
    },
    120_000,
  );
});
