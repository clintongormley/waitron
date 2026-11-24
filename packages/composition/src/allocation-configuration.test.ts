import { allocationRows } from "@waitron/fiscal-verifactu/test/allocation-rows.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "./modules.js";
import {
  configuredOperations,
  type HistoricalAllocationPaths,
} from "@waitron/fiscal-verifactu/src/allocation-configuration.js";
import type { ModuleOperationHost, ModuleRecoveryFacts } from "@waitron/module";
import * as release from "@waitron/fiscal-verifactu/src/hour-release.js";
import * as internet from "@waitron/fiscal-verifactu/src/hour-clock-time-service.js";
import { activatePreparedModuleAllocation } from "@waitron/fiscal-verifactu";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deployment, invoiceSeries, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withOperationAuthority } from "@waitron/module";
import type { ProvisionedNode } from "@waitron/module";

import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { seedTaxpayers, TAXPAYER_A } from "@waitron/fiscal-verifactu/test/fixtures.js";

import {
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
} from "@waitron/fiscal-verifactu/src/paper-evidence.js";
import { fixtureSifIdentities } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { SERIES_BASES } from "@waitron/db/testing/series-bases.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node: ProvisionedNode = {
  nodeId: TAXPAYER_A.nodeId,
};
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const fingerprint = paperCustodianFingerprint(publicKey)!;
const binding = {
  module: "fiscal-verifactu",
  action: "restore",
  eventId: "source-recovery",
  sourceId: "selected-backup",
  targetNodeId: node.nodeId,
};
const operatorId = { kind: "recovery-key" as const, nodeId: node.nodeId, eventId: binding.eventId };
const bases = SERIES_BASES;
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
    { code: "R-P000042", purpose: "corrective" },
    { code: "RF-P000042", purpose: "full_corrective" },
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
  const dir = await mkdtemp(join(tmpdir(), "allocation-paper-source-"));
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

beforeEach(async () => {
  await seedTaxpayers(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await suite.db
    .insert(invoiceSeries)
    .values(bases.map((base) => ({ ...base, nodeId: node.nodeId })));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function historicalPaths(paths: { custodianPath: string; confirmationPath: string }) {
  return {
    custodianFile: paths.custodianPath,
    confirmationFile: paths.confirmationPath,
    custodianFingerprint: fingerprint,
  };
}
async function attempt(paths: HistoricalAllocationPaths) {
  const operations = configuredOperations(paths);
  expect(operations).toBeDefined();
  return withOperationAuthority(binding, operatorId, (authority) =>
    operations!.prepare({ binding, authority, input }, (prepared) =>
      withTransaction(suite.db, (tx) => activatePreparedModuleAllocation(tx, node, prepared)),
    ),
  );
}
it("reads an independently configured historical paper source without production dispatch", async () => {
  await withFiles(async (paths) => {
    const result = await attempt(historicalPaths(paths));
    expect(result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
      { code: "A-P000042", purpose: "standard" },
      { code: "FF-P000042", purpose: "full" },
      { code: "R-P000042", purpose: "corrective" },
      { code: "RF-P000042", purpose: "full_corrective" },
    ]);
    expect(await fixtureSifIdentities(suite.db)).toEqual([{ identity: "P000042" }]);
    expect((await allocationRows(suite.db)).map(({ approval }) => ({ approval }))).toEqual([
      { approval },
    ]);
  });
});
it.each(["custodianFile", "confirmationFile", "custodianFingerprint"])(
  "refuses missing or empty host configuration %s without accepting request evidence",
  async (field) => {
    await withFiles(async (paths) => {
      for (const value of [undefined, "", "  "]) {
        await expect(attempt({ ...historicalPaths(paths), [field]: value })).rejects.toMatchObject({
          code: "sif.allocation_invalid",
          params: { reason: "outside_confirmation_missing" },
        });
        expect(await allocationRows(suite.db)).toEqual([]);
        expect(await fixtureSifIdentities(suite.db)).toEqual([]);
      }
    });
  },
);
it("requires a separately configured fingerprint even when the submitted files agree", async () => {
  await withFiles(async (paths) => {
    await expect(
      attempt({
        ...historicalPaths(paths),
        custodianFingerprint: "different-independent-fingerprint",
      }),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_untrusted" },
    });
    expect(await allocationRows(suite.db)).toEqual([]);
  });
});
it("reads the current event file again on the next attempt", async () => {
  await withFiles(async (paths) => {
    await attempt(historicalPaths(paths));
    const ledger = await allocationRows(suite.db);
    await writeFile(
      paths.confirmationPath,
      JSON.stringify({ ...confirmation, binding: { ...binding, eventId: "another-event" } }),
    );
    await expect(attempt(historicalPaths(paths))).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "event_mismatch" },
    });
    expect(await allocationRows(suite.db)).toEqual(ledger);
  });
});

function hourHost() {
  let value: unknown = null;
  const history: unknown[] = [];
  let held = false;
  const facts: ModuleRecoveryFacts = {
    country: "ES",
    taxId: "89890001K",
    environment: "preproduction",
    bases,
    contextKey: "selected-backup/current-key/sole-recovery",
    history: [{ reference: "selected-backup", complete: true, records: [] }],
    oldMachineOffline: true,
    oldMachineAbsent: false,
    oldMachineRelinquished: false,
    noParallelRecovery: true,
    priorActivation: "none",
  };
  const host: ModuleOperationHost = {
    environment: {},
    readPublicEvidence: async () => ({ trust: custodian, current: confirmation }),
    readRecoveryFacts: async () => {
      if (!held) throw new Error("recovery facts read outside exclusion");
      return facts;
    },
    withPreparationState: async (_binding, run) => {
      if (held) throw new Error("nested preparation");
      held = true;
      try {
        return await run({
          get value() {
            return structuredClone(value);
          },
          get history() {
            return structuredClone(history);
          },
          async replace(next) {
            value = structuredClone(next);
            history.push(structuredClone(next));
          },
        });
      } finally {
        held = false;
      }
    },
  };
  const operations = ALL_MODULES.find((module) => module.name === binding.module)!.operations!
    .configure!(host);
  return { operations, history };
}

it("refuses legacy paper input through unconfigured production composition", async () => {
  const operations = ALL_MODULES.find((module) => module.name === binding.module)!.operations!;
  await withOperationAuthority(binding, operatorId, async (authority) => {
    await expect(
      operations.prepare({ binding, authority, input }, async () => "admitted"),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
  });
  expect(await allocationRows(suite.db)).toEqual([]);
  expect(await fixtureSifIdentities(suite.db)).toEqual([]);
});

it("refuses legacy paper input through a configured production host without durable hour intent", async () => {
  const { operations, history } = hourHost();
  await withOperationAuthority(binding, operatorId, async (authority) => {
    await expect(
      operations.prepare({ binding, authority, input }, async () => "admitted"),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "clock_stale" },
    });
  });
  expect(history).toEqual([]);
  expect(await allocationRows(suite.db)).toEqual([]);
  expect(await fixtureSifIdentities(suite.db)).toEqual([]);
});

it("activates the current hour through production composition without signed-file authority", async () => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
  vi.spyOn(release, "readHourRelease").mockReturnValue({
    instantMs: Date.parse("2026-10-15T00:00:00Z"),
    sourceCommit: "a".repeat(40),
    committedAt: "2026-10-15T00:00:00.000Z",
    generator: "scripts/generate-hour-release.mjs:v1",
    generatorSha256: "b".repeat(64),
  });
  vi.spyOn(internet, "observeTimeServiceHourClock").mockImplementation(async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 0,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }));
  const { operations, history } = hourHost();
  await withOperationAuthority(binding, operatorId, async (authority) => {
    const operation = { binding, authority };
    const compareAndSelect = async () => {
      const compared = (await operations.recovery!(
        operation,
        {
          action: "compare-clocks",
          browser: null,
        },
        { onBox: true },
      )) as { id: string };
      return (await operations.recovery!(
        operation,
        {
          action: "select",
          comparisonId: compared.id,
        },
        { onBox: true },
      )) as { status: string; targetMs?: number; input: unknown };
    };
    let selected = await compareAndSelect();
    expect(selected).toMatchObject({
      status: "waiting",
      targetMs: Date.parse("2026-10-16T11:42:00Z"),
    });
    vi.advanceTimersByTime(selected.targetMs! + 1 - Date.now());
    selected = await compareAndSelect();
    expect(selected.status).toBe("selected");
    expect(history).toHaveLength(2);
    const selectedHistory = structuredClone(history);
    const result = await operations.prepare({ ...operation, input: selected.input }, (prepared) =>
      withTransaction(suite.db, (tx) => activatePreparedModuleAllocation(tx, node, prepared)),
    );
    expect(result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
      { code: "A-0CNNY", purpose: "standard" },
      { code: "FF-0CNNY", purpose: "full" },
      { code: "R-0CNNY", purpose: "corrective" },
      { code: "RF-0CNNY", purpose: "full_corrective" },
    ]);
    expect(await fixtureSifIdentities(suite.db)).toEqual([{ identity: "0CNNY" }]);
    expect((await allocationRows(suite.db)).map(({ allocation }) => allocation.source)).toEqual([
      "hour",
    ]);
    expect(history).toEqual(selectedHistory);
    await expect(
      operations.prepare({ ...operation, input }, async () => "admitted"),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "event_mismatch" },
    });
    expect(history).toEqual(selectedHistory);
    expect(await fixtureSifIdentities(suite.db)).toEqual([{ identity: "0CNNY" }]);
  });
});
