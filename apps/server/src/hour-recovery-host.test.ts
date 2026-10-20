import {
  external,
  suite,
  node,
  binding,
  scope,
  root,
  key,
  host,
} from "../test/hour-recovery-host.js";
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
import { createFirstSetupCoordinator, readModulePreparationHistory } from "@waitron/provisioning";
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

it("persists a recovery hour before the real configured restore runner activates it", async () => {
  const f = await host();
  await f.compare();
  const selected = (await f.prepare({
    action: "select",
    answer: "no",
    installationCodes: ["06RB"],
  })) as {
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
  const selected = await first.prepare({
    action: "select",
    answer: "no",
    installationCodes: ["06RB"],
  });
  const next = await host();
  await expect(
    next.prepare({ action: "select", answer: "no", installationCodes: ["06RB"] }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "clock_stale" },
  });
  vi.setSystemTime(new Date("2026-10-16T13:10:00Z"));
  await next.compare();
  expect(
    await next.prepare({ action: "select", answer: "no", installationCodes: ["06RB"] }),
  ).toEqual(selected);
  expect(await readModulePreparationHistory(next.roots, binding.module)).toHaveLength(1);
});

it("replays the exact restore after reading the now-committed database history", async () => {
  const f = await host();
  await f.compare();
  const selected = (await f.prepare({
    action: "select",
    answer: "no",
    installationCodes: ["06RB"],
  })) as { input: unknown };
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
  await expect(
    f.prepare({ action: "select", answer: "no", installationCodes: ["06RB"] }),
  ).rejects.toMatchObject({
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
  await expect(
    f.prepare({ action: "select", answer: "no", installationCodes: ["06RB"] }),
  ).rejects.toMatchObject({
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
  await expect(
    service.prepare({ action: "select", answer: "no", installationCodes: ["06RB"] }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "hour_not_later" },
  });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
});

it("requires a real committed result when the host reports that replay is possible", async () => {
  const f = await host();
  await f.compare();
  const selected = (await f.prepare({
    action: "select",
    answer: "no",
    installationCodes: ["06RB"],
  })) as { input: unknown };
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
  await expect(
    service.prepare({ action: "select", answer: "no", installationCodes: ["06RB"] }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "hour_not_later" },
  });
  vi.setSystemTime(new Date("2026-10-16T14:40:00Z"));
  await compare();
  const outcome = (await service.prepare({
    action: "select",
    answer: "no",
    installationCodes: ["06RB"],
  })) as {
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
  const selected = (await first.prepare({
    action: "select",
    answer: "no",
    installationCodes: ["06RB"],
  })) as { input: unknown };
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
    const selected = (await f.prepare({
      action: "select",
      answer: "no",
      installationCodes: ["06RB"],
    })) as { input: unknown };
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
  await expect(
    f.prepare({ action: "select", answer: "no", installationCodes: ["06RB"] }),
  ).rejects.toMatchObject({
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
  expect(
    await f.prepare({ action: "select", answer: "no", installationCodes: ["06RB"] }),
  ).toMatchObject({
    status: "selected",
    identity: "06RC",
  });
  await f.prepare({ action: "clock-challenge" });
  await expect(
    f.prepare({ action: "select", answer: "no", installationCodes: ["06RB"] }),
  ).rejects.toMatchObject({
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
  expect(
    await service.prepare({ action: "select", answer: "no", installationCodes: ["06RB"] }),
  ).toMatchObject({
    status: "selected",
    identity: "06RC",
  });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toHaveLength(1);
});

it("retains the recovery wait's monotonic budget across fresh comparisons after a wall jump", async () => {
  const f = await host();
  await f.compare();
  expect(
    await f.prepare({ action: "select", answer: "yes", installationCodes: ["06RB"] }),
  ).toMatchObject({
    status: "waiting",
    targetMs: Date.parse("2026-10-16T13:00:00Z"),
    remainingMs: 1200000,
  });
  vi.setSystemTime(new Date("2026-10-16T13:10:00Z"));
  await f.compare();
  expect(
    await f.prepare({ action: "select", answer: "yes", installationCodes: ["06RB"] }),
  ).toMatchObject({
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
    const selected = (await f.service.prepare({
      action: "select",
      answer: "no",
      installationCodes: ["06RB"],
    })) as {
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
    const selected = (await first.service.prepare({
      action: "select",
      answer: "no",
      installationCodes: ["06RB"],
    })) as {
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
    await expect(
      f.service.prepare({ action: "select", answer: "no", installationCodes: ["06RB"] }),
    ).rejects.toMatchObject({
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
    const selected = await service.prepare({
      action: "select",
      answer: "no",
      installationCodes: ["06RB"],
    });
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

it("refuses an entered installation code newer than the selected backup, then accepts the next real hour", async () => {
  const f = await host();
  await f.compare();
  const beforeSeries = await suite.db.select().from(invoiceSeries);
  const beforeAllocations = await suite.db.select().from(fiscalAllocations);
  await expect(
    f.prepare({ action: "select", answer: "no", installationCodes: ["06rc"] }),
  ).rejects.toMatchObject({ code: "sif.allocation_invalid", params: { reason: "hour_not_later" } });
  expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual([]);
  expect(await suite.db.select().from(invoiceSeries)).toEqual(beforeSeries);
  expect(await suite.db.select().from(fiscalAllocations)).toEqual(beforeAllocations);
  vi.setSystemTime(new Date("2026-10-16T13:00:00Z"));
  await f.compare();
  const result = (await f.prepare({
    action: "select",
    answer: "no",
    installationCodes: ["06rc"],
  })) as { input: unknown };
  expect(result).toMatchObject({ identity: "06RD", reportedIdentities: ["06RC"] });
  await runRestoreHooks({
    db: suite.db,
    node,
    modules: f.configured,
    log: () => {},
    withModuleOperations: f.service.runner(result.input),
  });
  expect(
    (await suite.db.select().from(invoiceSeries))
      .filter((row) => row.retiredAt === null)
      .map((row) => row.code),
  ).toEqual(expect.arrayContaining(["A-06RD", "FF-06RD", "R-06RD"]));
});
