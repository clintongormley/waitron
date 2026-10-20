import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "./modules.js";
import { FISCAL_OPERATIONS as historicalOperations } from "@waitron/fiscal-verifactu/src/allocation-configuration.js";
import type { ModuleOperationHost, ModuleRecoveryFacts } from "@waitron/module";
import * as release from "@waitron/fiscal-verifactu/src/hour-release.js";
import * as internet from "@waitron/fiscal-verifactu/src/hour-clock-internet.js";
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
import { seedTenants, TENANT_A } from "@waitron/fiscal-verifactu/test/fixtures.js";

import {
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
} from "@waitron/fiscal-verifactu/src/paper-evidence.js";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import { fixtureSifIdentities } from "@waitron/fiscal-verifactu/test/sif-fixture.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node: ProvisionedNode = {
  nodeId: TENANT_A.nodeId,
  locationId: TENANT_A.locationId as ProvisionedNode["locationId"],
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
  vi.stubEnv("WAITRON_FISCAL_CUSTODIAN_FILE", undefined);
  vi.stubEnv("WAITRON_FISCAL_CONFIRMATION_FILE", undefined);
  vi.stubEnv("WAITRON_FISCAL_CUSTODIAN_FINGERPRINT", undefined);
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await suite.db
    .insert(invoiceSeries)
    .values(bases.map((base) => ({ ...base, nodeId: node.nodeId })));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function configure(paths: { custodianPath: string; confirmationPath: string }) {
  vi.stubEnv("WAITRON_FISCAL_CUSTODIAN_FILE", paths.custodianPath);
  vi.stubEnv("WAITRON_FISCAL_CONFIRMATION_FILE", paths.confirmationPath);
  vi.stubEnv("WAITRON_FISCAL_CUSTODIAN_FINGERPRINT", fingerprint);
}
async function attempt() {
  const operations = historicalOperations;
  expect(operations).toBeDefined();
  return withOperationAuthority(binding, operatorId, (authority) =>
    operations!.prepare({ binding, authority, input }, (prepared) =>
      withTransaction(suite.db, (tx) => activatePreparedModuleAllocation(tx, node, prepared)),
    ),
  );
}
it("reads an independently configured historical paper source without production dispatch", async () => {
  await withFiles(async (paths) => {
    configure(paths);
    const result = await attempt();
    expect(result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
      { code: "A-P000042", purpose: "standard" },
      { code: "FF-P000042", purpose: "full" },
      { code: "R-P000042", purpose: "rectificative" },
    ]);
    expect(await fixtureSifIdentities(suite.db)).toEqual([{ identity: "P000042" }]);
    expect(
      await suite.db.select({ approval: fiscalAllocations.approval }).from(fiscalAllocations),
    ).toEqual([{ approval }]);
  });
});
it.each([
  "WAITRON_FISCAL_CUSTODIAN_FILE",
  "WAITRON_FISCAL_CONFIRMATION_FILE",
  "WAITRON_FISCAL_CUSTODIAN_FINGERPRINT",
])(
  "refuses missing or empty host configuration %s without accepting request evidence",
  async (variable) => {
    await withFiles(async (paths) => {
      configure(paths);
      for (const value of [undefined, "", "  "]) {
        vi.stubEnv(variable, value);
        await expect(attempt()).rejects.toMatchObject({
          code: "sif.allocation_invalid",
          params: { reason: "outside_confirmation_missing" },
        });
        expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
        expect(await fixtureSifIdentities(suite.db)).toEqual([]);
      }
    });
  },
);
it("requires a separately configured fingerprint even when the submitted files agree", async () => {
  await withFiles(async (paths) => {
    configure(paths);
    vi.stubEnv("WAITRON_FISCAL_CUSTODIAN_FINGERPRINT", "different-independent-fingerprint");
    await expect(attempt()).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_untrusted" },
    });
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  });
});
it("reads the current event file again on the next attempt", async () => {
  await withFiles(async (paths) => {
    configure(paths);
    await attempt();
    const ledger = await suite.db.select().from(fiscalAllocations);
    await writeFile(
      paths.confirmationPath,
      JSON.stringify({ ...confirmation, binding: { ...binding, eventId: "another-event" } }),
    );
    await expect(attempt()).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "event_mismatch" },
    });
    expect(await suite.db.select().from(fiscalAllocations)).toEqual(ledger);
  });
});

function hourHost(environment: ModuleOperationHost["environment"] = {}) {
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
    noParallelRecovery: true,
    priorActivation: "none",
  };
  const host: ModuleOperationHost = {
    environment,
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
  await withFiles(async (paths) => {
    configure(paths);
    const operations = ALL_MODULES.find((module) => module.name === binding.module)!.operations!;
    await withOperationAuthority(binding, operatorId, async (authority) => {
      await expect(
        operations.prepare({ binding, authority, input }, async () => "admitted"),
      ).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "outside_confirmation_missing" },
      });
    });
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
    expect(await fixtureSifIdentities(suite.db)).toEqual([]);
  });
});

it("refuses legacy paper input through a configured production host without durable hour intent", async () => {
  await withFiles(async (paths) => {
    const { operations, history } = hourHost({
      WAITRON_FISCAL_CUSTODIAN_FILE: paths.custodianPath,
      WAITRON_FISCAL_CONFIRMATION_FILE: paths.confirmationPath,
      WAITRON_FISCAL_CUSTODIAN_FINGERPRINT: fingerprint,
    });
    await withOperationAuthority(binding, operatorId, async (authority) => {
      await expect(
        operations.prepare({ binding, authority, input }, async () => "admitted"),
      ).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "clock_stale" },
      });
    });
    expect(history).toEqual([]);
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
    expect(await fixtureSifIdentities(suite.db)).toEqual([]);
  });
});

it("activates the current hour through production composition without signed-file authority", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
  vi.spyOn(release, "readHourRelease").mockReturnValue({
    instantMs: Date.parse("2026-10-15T00:00:00Z"),
    sourceCommit: "a".repeat(40),
    committedAt: "2026-10-15T00:00:00.000Z",
    generator: "scripts/generate-hour-release.mjs:v1",
    generatorSha256: "b".repeat(64),
  });
  vi.spyOn(internet, "observeInternetHourClock").mockResolvedValue({
    source: "internet",
    result: "unavailable",
    reason: "tls",
  });
  const { operations, history } = hourHost();
  await withOperationAuthority(binding, operatorId, async (authority) => {
    const operation = { binding, authority };
    const compared = (await operations.recovery!(operation, {
      action: "compare-clocks",
      browser: null,
    })) as { id: string };
    await operations.recovery!(operation, { action: "confirm-clock", comparisonId: compared.id });
    const selected = (await operations.recovery!(operation, {
      action: "select",
      answer: "no",
      installationCodes: ["06RA"],
    })) as { status: string; input: unknown };
    expect(selected.status).toBe("selected");
    expect(history).toHaveLength(1);
    const selectedHistory = structuredClone(history);
    const result = await operations.prepare({ ...operation, input: selected.input }, (prepared) =>
      withTransaction(suite.db, (tx) => activatePreparedModuleAllocation(tx, node, prepared)),
    );
    expect(result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
      { code: "A-06RB", purpose: "standard" },
      { code: "FF-06RB", purpose: "full" },
      { code: "R-06RB", purpose: "rectificative" },
    ]);
    expect(await fixtureSifIdentities(suite.db)).toEqual([{ identity: "06RB" }]);
    expect(
      (
        await suite.db.select({ allocation: fiscalAllocations.allocation }).from(fiscalAllocations)
      ).map(({ allocation }) => allocation.source),
    ).toEqual(["hour"]);
    expect(history).toEqual(selectedHistory);
    await expect(
      operations.prepare({ ...operation, input }, async () => "admitted"),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "event_mismatch" },
    });
    expect(history).toEqual(selectedHistory);
    expect(await fixtureSifIdentities(suite.db)).toEqual([{ identity: "06RB" }]);
  });
});
