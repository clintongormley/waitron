import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deployment,
  invoiceSeries,
  nodeRoles,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { managementSessions, persons } from "@waitron/identity";
import { locationId } from "@waitron/shared";

import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { seedTenants, TENANT_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import * as allocation from "@waitron/fiscal-verifactu";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { withRecoveryModuleOperation } from "./recovery-module-operation.js";
import { runRestoreHooks } from "./restore.js";
import {
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
} from "@waitron/fiscal-verifactu/src/paper-evidence.js";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import { registroSif } from "@waitron/fiscal-verifactu/src/schema/sif.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { readOperationAuthority, type ModuleOperationInput } from "@waitron/module";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const fingerprint = paperCustodianFingerprint(publicKey)!;
const binding = {
  module: "fiscal-verifactu",
  action: "restore",
  eventId: "host-paper-recovery",
  sourceId: "selected-backup",
  targetNodeId: node.nodeId,
};
const operatorId = { kind: "recovery-key" as const, nodeId: node.nodeId, eventId: binding.eventId };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const candidate = {
  version: 1 as const,
  allocationId: "paper-source-42",
  taxpayerNif: "89890001K",
  softwareId: "W1",
  environment: "preproduction" as const,
  installationIdentity: "P000042",
  series: [
    { code: "A-P000042", purpose: "standard" },
    { code: "FF-P000042", purpose: "full" },
    { code: "R-P000042", purpose: "rectificative" },
  ],
  source: "paper" as const,
  issuedAt: "2026-10-13T10:00:00.000Z",
};
const block = signPaperBlock(
  {
    version: 1,
    custodianId: "external-custodian",
    generationId: "current-generation",
    blockId: "current-block",
    packVersion: 1,
    recipientVenueId: "source-venue",
    allocations: [candidate],
  },
  privateKey,
);
const approval = {
  version: 1 as const,
  eventId: binding.eventId,
  operatorId,
  sourceId: binding.sourceId,
  targetNodeId: binding.targetNodeId,
  oldMachineOffline: true,
  oldMachineAbsent: false,
  noParallelRecovery: true,
  confirmedAt: "2026-10-13T11:00:00.000Z",
  incidentEvidence: "outside/source-42",
};
const consumption = signPaperConsumptionForBlock(
  block,
  candidate.allocationId,
  {
    eventId: binding.eventId,
    operatorId,
    sourceId: binding.sourceId,
    targetNodeId: binding.targetNodeId,
    incidentEvidence: approval.incidentEvidence,
    consumedAt: approval.confirmedAt,
  },
  privateKey,
);
const input = {
  allocation: { ...candidate, reservationEvidence: { block, consumption } },
  approval,
};
const confirmation = {
  version: 1,
  allocationId: "paper-source-42",
  binding,
  operatorId,
  priorActivation: "none",
  incidentEvidence: approval.incidentEvidence,
  requiredBases: bases,
  recipientVenueId: "source-venue",
  generationId: "current-generation",
  blockId: "current-block",
  currentRegisterConfirmed: true,
  consumptionConfirmed: true,
  currentEntryState: "consumed-for-event",
};
const custodian = { custodianId: "external-custodian", publicKey, fingerprint };

async function withFiles(
  run: (paths: { custodianPath: string; confirmationPath: string }) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), "recovery-paper-source-"));
  try {
    const paths = {
      custodianPath: join(dir, "public.json"),
      confirmationPath: join(dir, "current.json"),
    };
    await writeFile(paths.custodianPath, JSON.stringify(custodian));
    await writeFile(paths.confirmationPath, JSON.stringify(confirmation));
    await run(paths);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

let secret: string;

beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await suite.db
    .insert(invoiceSeries)
    .values(bases.map((base) => ({ ...base, nodeId: node.nodeId })));
  secret = await mintBreakGlassSecret(suite.db, node.nodeId);
});

async function restore(paths: { custodianPath: string; confirmationPath: string }, rotate = false) {
  const configured = allocation.createPaperAllocationPreparation({
    ...paths,
    confirmedFingerprint: fingerprint,
  });
  const module = {
    ...fakeModule(binding.module, {
      operations: {
        async prepare<T>(
          operation: ModuleOperationInput,
          run: (ready: ModuleOperationInput) => Promise<T>,
        ) {
          return configured.prepare(operation, async (ready) => {
            if (rotate) await mintBreakGlassSecret(suite.db, node.nodeId);
            else
              await withTransaction(suite.db, (tx) =>
                tx.update(nodeRoles).set({ breakGlassKeyName: "source-collected-before-lock" }),
              );
            return run(ready);
          });
        },
      },
    }),
    backup: {
      restore: async (tx: Transaction, target: typeof node, operation?: ModuleOperationInput) => {
        expect(readOperationAuthority(operation!.authority, binding)?.operatorId).toEqual(
          operatorId,
        );
        const result = await allocation.activatePreparedModuleAllocation(tx, target, operation!);
        return { report: `activated ${result.activationEventId}` };
      },
    },
  };
  return runRestoreHooks({
    db: suite.db,
    node,
    modules: [module],
    log: () => {},
    withModuleOperations: (context, run) =>
      withRecoveryModuleOperation(
        { ...context, modules: [module] },
        { binding, input, secret },
        run,
      ),
  });
}

it("restores through the real key runner, public paper selection and the complete generic hook transaction", async () => {
  await withFiles(async (paths) => {
    const outside = await readFile(paths.confirmationPath, "utf8");
    const attempt = restore(paths);
    await expect(attempt).resolves.toHaveProperty("seriesId");
    const result = await attempt;
    const retained = await suite.db.select().from(fiscalAllocations);
    expect(retained).toHaveLength(1);
    expect(result.reports).toEqual([
      `fiscal-verifactu: activated ${retained[0]!.result.activationEventId}`,
    ]);
    expect(retained[0]!.approval).toEqual(approval);
    expect(retained[0]!.result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
      { code: "A-P000042", purpose: "standard" },
      { code: "FF-P000042", purpose: "full" },
      { code: "R-P000042", purpose: "rectificative" },
    ]);
    expect(result.seriesId).toBe(
      retained[0]!.result.series.find((row) => row.purpose === "standard")!.id,
    );
    expect(await suite.db.select().from(persons)).toEqual([]);
    expect(await suite.db.select().from(managementSessions)).toEqual([]);
    expect(await readFile(paths.confirmationPath, "utf8")).toBe(outside);
  });
});

it("rejects a replacement key before the real restore hook can activate anything", async () => {
  await withFiles(async (paths) => {
    const before = await suite.db.select().from(invoiceSeries);
    await expect(restore(paths, true)).rejects.toMatchObject({
      code: "promotion.break_glass_invalid",
    });
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
    expect(await suite.db.select().from(registroSif)).toEqual([]);
    expect(await suite.db.select().from(invoiceSeries)).toEqual(before);
  });
});

it("uses the fiscal restore hook with node-key authentication without recreating its series", async () => {
  await withTransaction(suite.db, (tx) =>
    allocation.registerSif(tx, {
      nodeId: node.nodeId,
      nif: "89890001K",
      idSistemaInformatico: "W1",
    }),
  );
  await suite.db.update(invoiceSeries).set({ nextNumber: 23 });
  const oldSifs = await suite.db.select().from(registroSif);
  const oldSeries = await suite.db.select().from(invoiceSeries);
  await withFiles(async (paths) => {
    const module = {
      ...fakeModule(binding.module, {
        operations: allocation.createPaperAllocationPreparation({
          ...paths,
          confirmedFingerprint: fingerprint,
        }),
      }),
      backup: { restore: allocation.ALLOCATED_FISCAL_RESTORE },
    };
    const result = await runRestoreHooks({
      db: suite.db,
      node,
      modules: [module],
      log: () => {},
      withModuleOperations: (context, run) =>
        withRecoveryModuleOperation(
          { ...context, modules: [module] },
          { binding, input, secret },
          run,
        ),
    });
    const retained = await suite.db.select().from(fiscalAllocations);
    expect(retained).toHaveLength(1);
    expect(retained[0]!.approval).toEqual(approval);
    const expected = retained[0]!.result;
    expect(result.seriesId).toBe(expected.series.find((row) => row.purpose === "standard")!.id);
    expect(result.reports).toEqual([
      `fiscal-verifactu: SIF ${expected.sifId} (installation P000042); series A-P000042, FF-P000042, R-P000042`,
    ]);
    const series = await suite.db.select().from(invoiceSeries);
    expect(series).toHaveLength(6);
    for (const old of oldSeries)
      expect(series.find((row) => row.id === old.id)).toEqual({
        ...old,
        retiredAt: expect.any(Date),
      });
    expect(
      series
        .filter((row) => row.retiredAt === null)
        .map(({ id, code, purpose }) => ({ id, code, purpose }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    ).toEqual(expected.series);
    expect(
      series
        .filter((row) => row.retiredAt === null)
        .map(({ code, purpose, nextNumber }) => ({ code, purpose, nextNumber }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    ).toEqual([
      { code: "A-P000042", purpose: "standard", nextNumber: 1 },
      { code: "FF-P000042", purpose: "full", nextNumber: 1 },
      { code: "R-P000042", purpose: "rectificative", nextNumber: 1 },
    ]);
    const sifs = await suite.db.select().from(registroSif);
    expect(sifs).toHaveLength(2);
    expect(sifs.find((row) => row.id === oldSifs[0]!.id)).toEqual({
      ...oldSifs[0]!,
      revocadoEn: expect.any(Date),
    });
    expect(sifs.find((row) => row.id === expected.sifId)).toMatchObject({
      numeroInstalacion: "P000042",
      revocadoEn: null,
    });
    expect(await suite.db.select().from(persons)).toEqual([]);
    expect(await suite.db.select().from(managementSessions)).toEqual([]);
  });
});
