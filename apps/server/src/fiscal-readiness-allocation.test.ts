import { generateKeyPairSync } from "node:crypto";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { openVenueDatabase } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { enabledModules } from "@waitron/module";
import { venueFiscalSelection, type VenueRequest } from "@waitron/provisioning";
import { emptyDrainResult } from "@waitron/fiscal";
import {
  ALLOCATED_FISCAL_SEED,
  FISCAL_SLOT,
  createPaperAllocationPreparation,
} from "@waitron/fiscal-verifactu";
import { registroSif } from "@waitron/fiscal-verifactu/src/schema/sif.js";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import { registrosFacturacion } from "@waitron/fiscal-verifactu/src/schema/registros.js";
import {
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
} from "@waitron/fiscal-verifactu/src/paper-evidence.js";
import { submitFiscalReadiness, fiscalReadinessDatabaseKey } from "./fiscal-readiness-runner.js";
const NODE = "c0000000-0000-4000-8000-000000000001";
const ADMIN = "c0000000-0000-4000-8000-000000000002";
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const fingerprint = paperCustodianFingerprint(publicKey)!;
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const request: VenueRequest = {
  country: "ES",
  taxId: "50000000R",
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

const initialOperations = {
  nodeId: NODE,
  administratorId: ADMIN,
  inputs: [
    {
      module: "fiscal-verifactu",
      eventId: approval.eventId,
      sourceId: approval.sourceId,
      input: { allocation, approval },
    },
  ],
};
const confirmation = {
  version: 1,
  allocationId: candidate.allocationId,
  binding: {
    module: "fiscal-verifactu",
    action: "setup",
    eventId: approval.eventId,
    sourceId: approval.sourceId,
    targetNodeId: NODE,
  },
  operatorId: ADMIN,
  priorActivation: "none",
  incidentEvidence: approval.incidentEvidence,
  requiredBases: bases,
  recipientVenueId: "venue-1",
  generationId: "generation-1",
  blockId: "block-1",
  currentRegisterConfirmed: true,
  consumptionConfirmed: true,
  currentEntryState: "consumed-for-event",
};

it("creates the retained preproduction readiness chain from its supplied allocation and reuses it after a lost response", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "waitron-readiness-allocation-"));
  const custodianPath = join(stateDir, "custodian.json");
  const confirmationPath = join(stateDir, "current.json");
  const readinessInput = {
    requirement: "accepted-test-submission" as const,
    fiscalModule: "verifactu",
    country: "ES",
    taxId: request.taxId,
    legalName: request.legalName,
    fiscalTerritory: "ES-common",
    submissionTarget: null,
    certificateFingerprint: null,
    certificateKind: null,
    moduleVersions: { core: 1 },
    applicationVersion: "test",
  };
  try {
    await writeFile(
      custodianPath,
      JSON.stringify({ custodianId: "custodian", publicKey, fingerprint }),
    );
    await writeFile(confirmationPath, JSON.stringify(confirmation));
    const sourceSets = migrationOptionsFor(manifestSets(), null);
    const migrationsRoot = join(stateDir, "migrations");
    for (const [index, set] of manifestSets().entries())
      await cp(sourceSets[index]!.migrationsFolder, join(migrationsRoot, set.name), {
        recursive: true,
      });
    const selected = venueFiscalSelection(ALL_MODULES, "ES-common");
    const modules = enabledModules(ALL_MODULES, selected.config).map((module) =>
      module.name !== "fiscal-verifactu"
        ? module
        : {
            ...module,
            provisioning: { seed: ALLOCATED_FISCAL_SEED },
            operations: createPaperAllocationPreparation({
              custodianPath,
              confirmationPath,
              confirmedFingerprint: fingerprint,
            }),
          },
    );
    const contribution = {
      ...FISCAL_SLOT,
      provisioningSecret: { required: () => false, validate: () => {}, seal: async () => {} },
      drain: async () => ({ ...emptyDrainResult(), recordsAccepted: 1 }),
    };
    const args = {
      stateDir,
      migrationsRoot,
      modules,
      contribution,
      venue: request,
      initialOperations,
      secret: undefined,
      ring: {} as never,
      readinessInput,
    };
    await expect(submitFiscalReadiness(args)).resolves.toEqual({ status: "accepted" });
    const databaseDir = join(
      stateDir,
      `fiscal-readiness-db-${fiscalReadinessDatabaseKey(readinessInput)}`,
    );
    const inspect = async () => {
      const store = await openVenueDatabase(databaseDir);
      try {
        const identities = await store.venue.select().from(registroSif);
        const ledger = await store.venue.select().from(fiscalAllocations);
        const records = await store.venue.select().from(registrosFacturacion);
        return { identities, ledger, records };
      } finally {
        await store.close();
      }
    };
    const first = await inspect();
    expect(
      first.identities.map((row) => ({ nodeId: row.nodeId, identity: row.numeroInstalacion })),
    ).toEqual([{ nodeId: NODE, identity: "S000042" }]);
    expect(first.ledger.map((row) => row.allocation.allocationId)).toEqual(["initial-42"]);
    expect(first.records).toHaveLength(1);
    expect(first.records[0]?.entorno).toBe("preproduction");
    expect(first.records[0]?.numSerieFactura).toBe("A-S000042/1");
    // A saved readiness attempt reuses its committed references without a fresh outside claim.
    await rm(confirmationPath);
    await expect(submitFiscalReadiness(args)).resolves.toEqual({ status: "accepted" });
    expect(await inspect()).toEqual(first);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
}, 60_000);
it.each([
  null,
  { ...initialOperations, nodeId: "invalid" },
  { ...initialOperations, inputs: [{ ...initialOperations.inputs[0], module: "disabled-regime" }] },
])(
  "refuses malformed or unselected readiness allocation input before creating its database %#",
  async (supplied) => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-readiness-invalid-"));
    const readinessInput = {
      requirement: "accepted-test-submission" as const,
      fiscalModule: "verifactu",
      country: "ES",
      taxId: request.taxId,
      legalName: request.legalName,
      fiscalTerritory: "ES-common",
      submissionTarget: null,
      certificateFingerprint: null,
      certificateKind: null,
      moduleVersions: { core: 1 },
      applicationVersion: "test",
    };
    try {
      await expect(
        submitFiscalReadiness({
          stateDir,
          modules: ALL_MODULES,
          venue: request,
          contribution: FISCAL_SLOT,
          initialOperations: supplied as never,
          secret: undefined,
          ring: {} as never,
          readinessInput,
        }),
      ).rejects.toMatchObject({
        code: "setup.request_invalid",
        params: { field: "initialOperations" },
      });
      const { readdir } = await import("node:fs/promises");
      expect(await readdir(stateDir)).toEqual([]);
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  },
);
