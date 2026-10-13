import { generateKeyPairSync } from "node:crypto";
import { beforeEach, expect, it } from "vitest";
import { isNull } from "drizzle-orm";
import { deployment, invoiceSeries, nodes, tenants, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons } from "@waitron/identity";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import {
  createAllocationPreparation,
  activatePreparedModuleAllocation,
} from "@waitron/fiscal-verifactu";
import { readModuleAllocationSeries } from "@waitron/fiscal-verifactu/src/allocation-operation.js";
import { FISCAL_SLOT } from "@waitron/fiscal-verifactu";
import type { AllocationContext } from "@waitron/fiscal-verifactu/src/allocation-envelope.js";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import {
  enrolPaperCustodian,
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
} from "@waitron/fiscal-verifactu/src/paper-evidence.js";
import { applyVenue } from "./venue-apply.js";
import { planVenue, type VenueRequest } from "./venue-plan.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const NODE = "c0000000-0000-4000-8000-000000000001";
const ADMIN = "c0000000-0000-4000-8000-000000000002";
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const trust = enrolPaperCustodian("custodian", publicKey, paperCustodianFingerprint(publicKey))!;
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const request: VenueRequest = {
  country: "ES",
  taxId: "B12345678",
  legalName: "Restaurant SL",
  location: {
    name: "Restaurant",
    fiscalTerritory: "ES-common",
    invoiceLocales: ["es-ES"],
    operationDescription: "Venta",
    addressLine1: "Calle Mayor 1",
    addressLine2: null,
    postalCode: "28013",
    city: "Madrid",
    province: "Madrid",
    timeZone: "Europe/Madrid",
    dayCutover: "06:00:00",
  },
  seriesCode: "A",
  fullSeriesCode: "FF",
  rectificativeSeriesCode: "R",
  admin: {
    displayName: "Owner",
    pinHash: "hash",
    passwordHash: "hash",
    email: "owner@example.test",
  },
};
const candidate = {
  version: 1 as const,
  allocationId: "initial-42",
  taxpayerNif: request.taxId,
  softwareId: "W1",
  environment: "preproduction" as const,
  installationIdentity: "S000042",
  source: "initial-paper" as const,
  issuedAt: "2026-10-12T08:00:00.000Z",
  series: [
    { code: "A-S000042", purpose: "standard" },
    { code: "FF-S000042", purpose: "full" },
    { code: "R-S000042", purpose: "rectificative" },
  ],
};
const approval = {
  version: 1 as const,
  eventId: "setup-42",
  operatorId: ADMIN,
  sourceId: "new-venue-42",
  targetNodeId: NODE,
  oldMachineOffline: false,
  oldMachineAbsent: true,
  noParallelRecovery: true,
  confirmedAt: "2026-10-12T09:00:00.000Z",
  incidentEvidence: "master/setup-42",
};
const block = signPaperBlock(
  {
    version: 1,
    custodianId: "custodian",
    generationId: "generation-1",
    blockId: "block-1",
    packVersion: 1,
    recipientVenueId: "venue-1",
    allocations: [candidate],
  },
  privateKey,
);
const allocation = {
  ...candidate,
  reservationEvidence: {
    block,
    consumption: signPaperConsumptionForBlock(
      block,
      candidate.allocationId,
      {
        eventId: approval.eventId,
        operatorId: ADMIN,
        sourceId: approval.sourceId,
        targetNodeId: NODE,
        incidentEvidence: approval.incidentEvidence,
        consumedAt: approval.confirmedAt,
      },
      privateKey,
    ),
  },
};
const context: AllocationContext = {
  taxpayerNif: candidate.taxpayerNif,
  softwareId: "W1",
  environment: "preproduction",
  mode: "initial-setup",
  eventId: approval.eventId,
  operatorId: ADMIN,
  sourceId: approval.sourceId,
  targetNodeId: NODE,
  incidentEvidence: approval.incidentEvidence,
  requiredBases: bases,
  reauthentication: null,
  priorActivation: "none",
  authority: {
    kind: "paper",
    trust,
    recipientVenueId: "venue-1",
    generationId: "generation-1",
    blockId: "block-1",
    currentRegisterConfirmed: true,
    consumptionConfirmed: true,
    currentEntryState: "consumed-for-event",
  },
};

beforeEach(async () => {
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
});

let sourceRead = 0;
function owner() {
  return fakeModule("fiscal-verifactu", {
    fiscal: FISCAL_SLOT,
    operations: createAllocationPreparation(async (request) => {
      sourceRead++;
      expect(request).toEqual({
        binding: {
          module: "fiscal-verifactu",
          action: "setup",
          eventId: "setup-42",
          sourceId: "new-venue-42",
          targetNodeId: NODE,
        },
        operatorId: ADMIN,
      });
      await withTransaction(suite.db, (tx) =>
        tx.update(deployment).set({ environment: "preproduction" }),
      );
      return {
        ...request,
        evidence: {
          incidentEvidence: approval.incidentEvidence,
          priorActivation: "none",
          requiredBases: bases,
          authority: context.authority,
        },
      };
    }),
    provisioning: {
      seed: {
        summary: "activate signed initial allocation",
        series: { resolve: readModuleAllocationSeries },
        run: async (tx, node, operation) => {
          const result = await activatePreparedModuleAllocation(tx, node, operation!);
          return result.activationEventId;
        },
      },
    },
  });
}
function establish(
  module = owner(),
  beforeCommit?: import("./venue-apply.js").VenueApplyDeps["beforeCommit"],
) {
  return applyVenue(planVenue(request, [module]), {
    db: suite.db,
    modules: [module],
    initialNodeId: NODE,
    initialAdministratorId: ADMIN,
    moduleInputs: new Map([
      [
        module.name,
        { eventId: approval.eventId, sourceId: approval.sourceId, input: { allocation, approval } },
      ],
    ]),
    beforeCommit,
  });
}

it("joins initial outside collection with the new account and exactly the allocated purpose set", async () => {
  sourceRead = 0;
  const module = owner();
  const result = await establish(module);
  const series = await suite.db.select().from(invoiceSeries).where(isNull(invoiceSeries.retiredAt));
  expect(
    series
      .map(({ code, purpose }) => ({ code, purpose }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  ).toEqual([
    { code: "A-S000042", purpose: "standard" },
    { code: "FF-S000042", purpose: "full" },
    { code: "R-S000042", purpose: "rectificative" },
  ]);
  expect(result.seriesIds).toEqual(
    ["standard", "full", "rectificative"].map(
      (purpose) => series.find((row) => row.purpose === purpose)!.id,
    ),
  );
  const ledger = await suite.db.select().from(fiscalAllocations);
  expect(ledger).toHaveLength(1);
  expect(ledger[0]!.approval.operatorId).toBe(ADMIN);
  expect(ledger[0]!.allocation).toEqual(allocation);
  const repeated = await establish(module);
  expect(repeated.seriesIds).toEqual(result.seriesIds);
  expect(sourceRead).toBe(1);
  expect(await suite.db.select().from(fiscalAllocations)).toEqual(ledger);
  expect(await suite.db.select().from(invoiceSeries)).toHaveLength(3);
  expect((await suite.db.select().from(persons)).map((row) => row.id)).toEqual([ADMIN]);
});

it("rolls back the signed allocation and initial account on a final host refusal", async () => {
  await expect(
    establish(owner(), async () => {
      throw new Error("last-host-refusal");
    }),
  ).rejects.toThrow("last-host-refusal");
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  expect(await suite.db.select().from(invoiceSeries)).toEqual([]);
  expect(await suite.db.select().from(nodes)).toEqual([]);
  expect(await suite.db.select().from(tenants)).toEqual([]);
  expect(await suite.db.select().from(persons)).toEqual([]);
});
