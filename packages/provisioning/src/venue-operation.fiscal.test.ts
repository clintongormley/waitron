import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { isNull, sql } from "drizzle-orm";
import { deployment, invoiceSeries, nodes, tenants } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons } from "@waitron/identity";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { activateAuthenticatedAllocation } from "@waitron/fiscal-verifactu/src/allocation.js";
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

async function establish(input = { allocation, approval, context }, managesSeries = false) {
  const module = fakeModule("fiscal-verifactu", {
    fiscal: FISCAL_SLOT,
    provisioning: {
      seed: {
        summary: "qualify initial allocation inside setup",
        series: managesSeries ? { resolve: readModuleAllocationSeries } : undefined,
        run: async (tx, node, operation) => {
          const supplied = operation!.input as typeof input;
          const result = await activateAuthenticatedAllocation(
            tx,
            node,
            supplied.allocation,
            supplied.approval,
            supplied.context,
            operation!.authority,
            "setup",
          );
          return result.activationEventId;
        },
      },
    },
  });
  return applyVenue(planVenue(request, [module]), {
    db: suite.db,
    modules: [module],
    initialNodeId: NODE,
    initialAdministratorId: ADMIN,
    moduleInputs: new Map([
      [module.name, { eventId: approval.eventId, sourceId: approval.sourceId, input }],
    ]),
  });
}

describe("internal fresh setup with a signed synthetic allocation", () => {
  it("writes exactly the signed initial identity and every purpose, attributed to the new account", async () => {
    const result = await establish();
    expect(result.seeded).toEqual([{ module: "fiscal-verifactu", report: "setup-42" }]);
    expect((await suite.db.execute(sql`select numero_instalacion from registro_sif`)).rows).toEqual(
      [{ numero_instalacion: "S000042" }],
    );
    expect(
      await suite.db
        .select({ code: invoiceSeries.code, purpose: invoiceSeries.purpose })
        .from(invoiceSeries)
        .where(isNull(invoiceSeries.retiredAt))
        .orderBy(invoiceSeries.code),
    ).toEqual([
      { code: "A-S000042", purpose: "standard" },
      { code: "FF-S000042", purpose: "full" },
      { code: "R-S000042", purpose: "rectificative" },
    ]);
    const [held] = await suite.db.select().from(fiscalAllocations);
    expect(held!.approval.operatorId).toBe(ADMIN);
    expect(held!.nodeId).toBe(NODE);
    expect((await suite.db.select().from(persons)).map((row) => row.id)).toEqual([ADMIN]);
  });

  it("refuses to attribute the signed setup to another submitted operator and rolls everything back", async () => {
    await expect(
      establish({ allocation, approval, context: { ...context, operatorId: "other" } }),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reauthentication_required" },
    });
    for (const table of [persons, tenants, nodes, invoiceSeries, fiscalAllocations])
      expect(await suite.db.select().from(table)).toEqual([]);
  });

  it("refuses absent current outside consumption, even after the host created a real account", async () => {
    await expect(
      establish({
        allocation,
        approval,
        context: {
          ...context,
          authority: {
            ...context.authority,
            consumptionConfirmed: false,
          } as AllocationContext["authority"],
        },
      }),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
    for (const table of [persons, tenants, nodes, invoiceSeries, fiscalAllocations])
      expect(await suite.db.select().from(table)).toEqual([]);
  });
});

it("hands setup the signed allocation's active references with no unsuffixed scaffolds", async () => {
  const result = await establish(undefined, true);
  const [ledger] = await suite.db.select().from(fiscalAllocations);
  expect(result.seriesIds).toEqual(ledger!.result.series.map((series) => series.id));
  expect(
    (await suite.db.select().from(invoiceSeries))
      .map(({ id, code, purpose, retiredAt, nextNumber }) => ({
        id,
        code,
        purpose,
        retiredAt,
        nextNumber,
      }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  ).toEqual(ledger!.result.series.map((row) => ({ ...row, retiredAt: null, nextNumber: 1 })));
  expect(await suite.db.select().from(invoiceSeries)).toHaveLength(3);
});

it("reapplies allocated setup without creating another SIF, allocation or series", async () => {
  const first = await establish(undefined, true);
  await suite.db.update(invoiceSeries).set({ nextNumber: 15 });
  const before = await suite.db.select().from(invoiceSeries);
  const retry = await establish(undefined, true);
  expect(retry.seriesIds).toEqual(first.seriesIds);
  expect(retry.seeded).toEqual([]);
  expect(await suite.db.select().from(invoiceSeries)).toEqual(before);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
  expect(
    (await suite.db.execute(sql`select numero_instalacion, revocado_en from registro_sif`)).rows,
  ).toEqual([{ numero_instalacion: "S000042", revocado_en: null }]);
});
