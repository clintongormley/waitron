import {
  external,
  suite,
  node,
  binding,
  scope,
  root,
  key,
  host,
  clock,
  compareWith,
  agreeInternet,
} from "../test/hour-recovery-host.js";
import { recoverySelectPastWaits } from "./testing/hour-test-clock.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  invoiceSeries,
  readBreakGlassVerifier,
  setBreakGlassVerifierTx,
  stampDeployment,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ALL_MODULES } from "@waitron/composition";
import {
  createFirstSetupCoordinator,
  raiseStartAgainNote,
  readModulePreparationHistory,
} from "@waitron/provisioning";
import { readHourHistory } from "@waitron/fiscal-verifactu/src/hour-history-reader.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { seedTenants } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import { createRecoveryRestoreRunner } from "./recovery-module-operation.js";
import { runRestoreHooks } from "./restore.js";
import { createSelectedRecoveryPreparation } from "./recovery-preparation.js";
import { withRecoveryKeyAuthority } from "./operation-authentication.js";
import { buildManifest } from "./backup-manifest.js";
import { packArchive } from "./backup-archive.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { previewRecoveryArchive } from "./recovery-backup-preview.js";
import { eq } from "drizzle-orm";
import { recordSale } from "@waitron/core";
import { seriesId } from "@waitron/shared";
import { VerifactuBackend } from "@waitron/fiscal-verifactu/src/backend.js";
import {
  fakeClient,
  saleInput,
  staticResolver,
  steadyClock,
} from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";

it("persists a recovery hour before the real configured restore runner activates it", async () => {
  const f = await host();
  const selected = (await f.selectPastWaits()) as {
    status: string;
    identity: string;
    input: unknown;
  };
  expect(selected.status).toBe("selected");
  expect(selected.identity).toBe("0CNQT");
  const journal = await readModulePreparationHistory(f.roots, binding.module);
  expect(journal).toHaveLength(2);
  expect(JSON.stringify(journal)).toContain('"identity":"0CNQT"');
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
    { code: "A-0CNQT", nextNumber: 1 },
    { code: "FF-0CNQT", nextNumber: 1 },
    { code: "R-0CNQT", nextNumber: 1 },
  ]);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(2);
});

it("reopens the same selected hour after host restart and requires a fresh clock comparison", async () => {
  const first = await host();
  const selected = await first.selectPastWaits();
  const next = await host();
  await expect(next.select()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "clock_stale" },
  });
  vi.setSystemTime(new Date("2026-10-16T13:10:00Z"));
  await next.compare();
  expect(await next.select()).toEqual(selected);
  expect(await readModulePreparationHistory(next.roots, binding.module)).toHaveLength(2);
});

it("hands the module whether the recovering browser is on the box", async () => {
  const f = await host();
  const compare = async (onBox: boolean) => {
    const challenge = (await f.service.prepare({ action: "clock-challenge" }, { onBox })) as {
      id: string;
    };
    return (await f.service.prepare(
      {
        action: "compare-clocks",
        browser: { challengeId: challenge.id, instantMs: Date.now() },
      },
      { onBox },
    )) as { clock: { secondClock: boolean; unavailable: unknown[] } };
  };
  const box = await compare(true);
  expect(box.clock.secondClock).toBe(false);
  expect(box.clock.unavailable).toContainEqual(
    expect.objectContaining({ source: "browser", reason: "same_machine" }),
  );
  expect((await compare(false)).clock.secondClock).toBe(true);
});

it("replays the exact restore after reading the now-committed database history", async () => {
  const f = await host();
  const selected = (await f.selectPastWaits()) as { input: unknown };
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
  expect(await readModulePreparationHistory(f.roots, binding.module)).toHaveLength(2);
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
  await expect(f.select()).rejects.toMatchObject({
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
        identity: "0CNRP",
        recordedAtMs: Date.parse("2026-10-16T13:10:00Z"),
      },
    ],
  });
  await f.compare();
  await expect(f.select()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "minute_not_later" },
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
  await expect(
    service.prepare({ action: "clock-challenge" }, { onBox: true }),
  ).rejects.toMatchObject({
    code: "module.operation_invalid",
  });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
});

it("adds the selected copy's opaque public floor to surviving host evidence", async () => {
  const f = await host();
  agreeInternet();
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
                identity: "0CNRP",
                recordedAtMs: Date.parse("2026-10-16T13:10:00Z"),
              },
            ],
          },
        },
      },
    },
  });
  const comparisonId = await compareWith(service);
  await expect(
    service.prepare({ action: "select", comparisonId }, { onBox: true }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "minute_not_later" },
  });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
});

it("requires a real committed result when the host reports that replay is possible", async () => {
  const f = await host();
  const selected = (await f.selectPastWaits()) as { input: unknown };
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
  await expect(
    service.prepare({ action: "clock-challenge" }, { onBox: true }),
  ).rejects.toMatchObject({
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
  await expect(
    service.prepare({ action: "clock-challenge" }, { onBox: true }),
  ).rejects.toMatchObject({
    code: "module.operation_invalid",
  });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
});

it("admits recovery from the real validated archive preview with its public spent-hour floor", async () => {
  const f = await host();
  agreeInternet();
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
                identity: "0CNRP",
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
  const comparisonId = await compareWith(service);
  await expect(
    service.prepare({ action: "select", comparisonId }, { onBox: true }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "minute_not_later" },
  });
  clock.set(Date.parse("2026-10-16T14:40:00Z"));
  const outcome = (await recoverySelectPastWaits(clock, service, { onBox: true })) as {
    identity: string;
    input: unknown;
  };
  expect(outcome.identity).toBe("0CNVJ");
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
  ).toEqual(["A-0CNVJ", "FF-0CNVJ", "R-0CNVJ"]);
});

it("finishes an already committed restore after restart without selecting or comparing clocks again", async () => {
  const first = await host();
  const selected = (await first.selectPastWaits()) as { input: unknown };
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
  expect(await readModulePreparationHistory(next.roots, binding.module)).toHaveLength(2);
  expect(external.internet).not.toHaveBeenCalled();
});

describe("the database supplied by the placement runner", () => {
  const placed = useVenueDb({ migrations: TEST_MIGRATIONS });
  it("checks the selected named key against the placed copy rather than a still-open preview", async () => {
    const f = await host();
    const selected = (await f.selectPastWaits()) as { input: unknown };
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
        contribution.recovery!(
          { binding: other, authority },
          { action: "clock-challenge" },
          { onBox: true },
        ),
    ),
  ).rejects.toMatchObject({ code: "module.operation_invalid" });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
});

it("refuses a selected module that has no configured recovery contribution", async () => {
  const f = await host();
  const service = createSelectedRecoveryPreparation({ ...f.options, modules: [] });
  await expect(
    service.prepare({ action: "clock-challenge" }, { onBox: true }),
  ).rejects.toMatchObject({
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
  await expect(
    service.prepare({ action: "clock-challenge" }, { onBox: true }),
  ).rejects.toMatchObject({
    code: "module.operation_invalid",
  });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
});

it("with only the box's clock a recovery has no confirmation to give, and selects once a second clock agrees", async () => {
  const f = await host();
  const comparison = (await f.prepare({ action: "compare-clocks", browser: null })) as {
    id: string;
  };
  await expect(f.prepare({ action: "select", comparisonId: comparison.id })).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "second_clock_missing" },
  });
  await expect(
    f.prepare({ action: "confirm-clock", comparisonId: comparison.id }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "event_mismatch" },
  });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
  agreeInternet();
  expect(await f.selectPastWaits()).toMatchObject({
    status: "selected",
    identity: "0CNQT",
  });
  await f.prepare({ action: "clock-challenge" });
  await expect(f.select()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "clock_stale" },
  });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toHaveLength(2);
});

it("binds a bucket selection to its exact activation point rather than its generation label", async () => {
  const f = await host();
  agreeInternet();
  const service = createSelectedRecoveryPreparation({
    ...f.options,
    selected: {
      ...f.selected,
      sourceId: "stream:venue:generation",
      activationSourceId: binding.sourceId,
    },
  });
  expect(await recoverySelectPastWaits(clock, service, { onBox: true })).toMatchObject({
    status: "selected",
    identity: "0CNQT",
  });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toHaveLength(2);
});

it("retains the recovery wait's monotonic budget across fresh comparisons after a wall jump", async () => {
  const f = await host();
  await f.compare();
  expect(await f.select()).toMatchObject({
    status: "waiting",
    targetMs: Date.parse("2026-10-16T12:42:00Z"),
    remainingMs: 120000,
  });
  vi.setSystemTime(new Date("2026-10-16T12:42:30Z"));
  await f.compare();
  expect(await f.select()).toMatchObject({
    status: "waiting",
    targetMs: Date.parse("2026-10-16T12:42:00Z"),
    remainingMs: 120000,
  });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toHaveLength(1);
});

describe("module-owned recovery facts from the actual database", () => {
  async function databaseHost() {
    const f = await host();
    agreeInternet();
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
    let comparisonId = "no-comparison";
    const compare = async () => {
      comparisonId = await compareWith(service);
    };
    const select = () => service.prepare({ action: "select", comparisonId }, { onBox: true });
    const selectPastWaits = () => recoverySelectPastWaits(clock, service, { onBox: true });
    return { ...f, service, compare, select, selectPastWaits, isolation, options };
  }

  it("selects from retained full-purpose bases and history without a supplied fiscal facts callback", async () => {
    const f = await databaseHost();
    const before = await suite.db.select().from(invoiceSeries);
    const selected = (await f.selectPastWaits()) as {
      identity: string;
      input: unknown;
    };
    expect(selected.identity).toBe("0CNQT");
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
      { code: "A-0CNQT", purpose: "standard", nextNumber: 1 },
      { code: "FF-0CNQT", purpose: "full", nextNumber: 1 },
      { code: "R-0CNQT", purpose: "rectificative", nextNumber: 1 },
    ]);
    for (const row of before)
      expect(after.find((entry) => entry.id === row.id)).toEqual({
        ...row,
        retiredAt: expect.any(Date),
      });
  });

  it("recognises an exact committed restore after reconstruction without trusting a caller's replay flag", async () => {
    const first = await databaseHost();
    const selected = (await first.selectPastWaits()) as {
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
    expect(await readModulePreparationHistory(next.roots, binding.module)).toHaveLength(2);
    expect(external.internet).not.toHaveBeenCalled();
  });

  it("refuses a live old seller supplied by the real isolation reader before spending an hour", async () => {
    const f = await databaseHost();
    f.isolation.oldMachineOffline = false;
    await f.compare();
    await expect(f.select()).rejects.toMatchObject({
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
    const selected = await recoverySelectPastWaits(clock, service, { onBox: true });
    expect(selected).toMatchObject({
      input: {
        allocation: {
          series: [
            { code: "A-0CNQT", purpose: "standard" },
            { code: "FF-0CNQT", purpose: "full" },
            { code: "R-0CNQT", purpose: "rectificative" },
          ],
        },
      },
    });
  });
});

it("refuses a selection that still carries an installation code, writing nothing", async () => {
  const f = await host();
  const compared = await f.compare();
  const beforeSeries = await suite.db.select().from(invoiceSeries);
  const beforeAllocations = await suite.db.select().from(fiscalAllocations);
  await expect(
    f.prepare({ action: "select", comparisonId: compared.id, installationCodes: ["0CNQX"] }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "event_mismatch" },
  });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
  expect(await suite.db.select().from(invoiceSeries)).toEqual(beforeSeries);
  expect(await suite.db.select().from(fiscalAllocations)).toEqual(beforeAllocations);
});

async function sellAt(instant: string) {
  const saleClock = {
    ...steadyClock,
    now: () => ({ ...steadyClock.now(), instant: new Date(instant) }),
  };
  const backend = new VerifactuBackend({
    deploymentEnvironment: "preproduction",
    clock: saleClock,
    db: suite.db,
    resolveClient: staticResolver(fakeClient),
  });
  const [standard] = await suite.db
    .select()
    .from(invoiceSeries)
    .where(eq(invoiceSeries.code, "A-0CNNY"));
  await withTransaction(suite.db, (tx) =>
    recordSale(
      tx,
      backend,
      saleInput({ nodeId: node.nodeId, seriesId: seriesId(standard!.id), clock: saleClock }),
    ),
  );
}

describe("a backup's own floors", () => {
  const asBrowser = { onBox: false };
  const restoreService = (f: Awaited<ReturnType<typeof host>>, createdAt = f.selected.createdAt) =>
    createSelectedRecoveryPreparation({ ...f.options, selected: { ...f.selected, createdAt } });

  it("refuses a minute before the backup's newest fiscal record, naming the record's time", async () => {
    await sellAt("2026-10-22T20:15:00Z");
    clock.set(Date.parse("2026-10-21T10:00:00Z"));
    const f = await host();
    await expect(
      recoverySelectPastWaits(clock, restoreService(f), asBrowser),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "minute_not_later", allowedFromMs: Date.parse("2026-10-22T20:15:00Z") },
    });
    expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
  });

  it("refuses a minute before the backup was created, naming its creation time", async () => {
    clock.set(Date.parse("2026-10-23T07:50:00Z"));
    const f = await host();
    await expect(
      recoverySelectPastWaits(clock, restoreService(f, "2026-10-23T08:00:00Z"), asBrowser),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "minute_not_later", allowedFromMs: Date.parse("2026-10-23T08:00:00Z") },
    });
    expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
  });

  it("waits and then selects once both clocks are past both floors", async () => {
    await sellAt("2026-10-22T20:15:00Z");
    clock.set(Date.parse("2026-10-24T09:00:00Z"));
    const f = await host();
    const service = restoreService(f, "2026-10-23T08:00:00Z");
    const challenge = (await service.prepare({ action: "clock-challenge" }, asBrowser)) as {
      id: string;
    };
    const compared = (await service.prepare(
      { action: "compare-clocks", browser: { challengeId: challenge.id, instantMs: clock.wall() } },
      asBrowser,
    )) as { id: string };
    expect(
      await service.prepare({ action: "select", comparisonId: compared.id }, asBrowser),
    ).toMatchObject({ status: "waiting", targetMs: Date.parse("2026-10-24T09:02:00Z") });
    expect(await recoverySelectPastWaits(clock, service, asBrowser)).toMatchObject({
      status: "selected",
    });
  });
});

describe("the start-again note", () => {
  const asBrowser = { onBox: false };
  const noteAt = (stateDir: string, floorMs: number) =>
    raiseStartAgainNote(stateDir, { floorMs, lastName: "0CNQT", module: binding.module });

  it("a restore with the clock set back behind the start-again note is refused, not given a repeated name", async () => {
    const floorMs = Date.parse("2026-10-23T08:00:00Z");
    clock.set(floorMs - 10 * 60_000);
    const f = await host();
    await noteAt(f.roots.stateDir, floorMs);
    await expect(recoverySelectPastWaits(clock, f.service, asBrowser)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "minute_not_later", allowedFromMs: floorMs },
    });
    expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
  });

  it("a backup whose history is later than the note wins", async () => {
    clock.set(Date.parse("2026-10-23T07:50:00Z"));
    const f = await host();
    await noteAt(f.roots.stateDir, Date.parse("2026-10-20T00:00:00Z"));
    await expect(
      recoverySelectPastWaits(
        clock,
        createSelectedRecoveryPreparation({
          ...f.options,
          selected: { ...f.selected, createdAt: "2026-10-23T08:00:00Z" },
        }),
        asBrowser,
      ),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "minute_not_later", allowedFromMs: Date.parse("2026-10-23T08:00:00Z") },
    });
  });
});
