import { FISCAL_OPERATIONS as historicalFiscalOperations } from "@waitron/fiscal-verifactu/src/allocation-configuration.js";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { invoiceSeries, nodes, tenants } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing } from "@waitron/credentials";
import { persons } from "@waitron/identity";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { FISCAL_SLOT, ALLOCATED_FISCAL_SEED } from "@waitron/fiscal-verifactu";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import { registroSif } from "@waitron/fiscal-verifactu/src/schema/sif.js";
import {
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
} from "@waitron/fiscal-verifactu/src/paper-evidence.js";
import type { VenueRequest } from "@waitron/provisioning";
import type { WaitronModule } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { provisionVenue, recoverProvisionedVenue, venueModuleConfig } from "./provision.js";
import { mountSetup, type SetupDeps } from "./setup-api.js";
import { createSetupOperationStore } from "./setup-operation.js";
const modules = vi.hoisted(() => [] as WaitronModule[]);
vi.mock("./modules.js", () => ({ ALL_MODULES: modules }));
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
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
let stateDir: string;
beforeEach(async () => {
  modules.splice(
    0,
    modules.length,
    fakeModule("fiscal-verifactu", {
      fiscal: FISCAL_SLOT,
      operations: historicalFiscalOperations,
      provisioning: { seed: ALLOCATED_FISCAL_SEED },
    }),
  );
  stateDir = await mkdtemp(join(tmpdir(), "waitron-public-allocation-"));
  const custodianPath = join(stateDir, "custodian.json");
  const confirmationPath = join(stateDir, "current.json");
  await writeFile(
    custodianPath,
    JSON.stringify({ custodianId: "custodian", publicKey, fingerprint }),
  );
  await writeFile(confirmationPath, JSON.stringify(confirmation));
  vi.stubEnv("WAITRON_FISCAL_CUSTODIAN_FILE", custodianPath);
  vi.stubEnv("WAITRON_FISCAL_CONFIRMATION_FILE", confirmationPath);
  vi.stubEnv("WAITRON_FISCAL_CUSTODIAN_FINGERPRINT", fingerprint);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(stateDir, { recursive: true, force: true });
});
function deps(beforeCommit?: (tx: import("@waitron/db").Transaction) => Promise<void>) {
  return {
    ownerDb: suite.db,
    moduleConfig: venueModuleConfig({ overrides: new Map() }, "ES-common"),
    database: stateDir,
    stateDir,
    beforeCommit,
  };
}
function establish(beforeCommit?: (tx: import("@waitron/db").Transaction) => Promise<void>) {
  return provisionVenue(deps(beforeCommit), {
    environment: "preproduction",
    venue: request,
    initialOperations,
  });
}
async function emptyVenue() {
  expect(await suite.db.select().from(tenants)).toEqual([]);
  expect(await suite.db.select().from(nodes)).toEqual([]);
  expect(await suite.db.select().from(persons)).toEqual([]);
  expect(await suite.db.select().from(registroSif)).toEqual([]);
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  expect(await suite.db.select().from(invoiceSeries)).toEqual([]);
}
async function allocatedVenue() {
  expect((await suite.db.select().from(nodes)).map((row) => row.id)).toEqual([NODE]);
  expect((await suite.db.select().from(persons)).map((row) => row.id)).toEqual([ADMIN]);
  expect(
    await suite.db.select({ identity: registroSif.numeroInstalacion }).from(registroSif),
  ).toEqual([{ identity: "S000042" }]);
  expect(
    (await suite.db.select().from(invoiceSeries))
      .map(({ code, purpose, nextNumber }) => ({ code, purpose, nextNumber }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  ).toEqual([
    { code: "A-S000042", purpose: "standard", nextNumber: 1 },
    { code: "FF-S000042", purpose: "full", nextNumber: 1 },
    { code: "R-S000042", purpose: "rectificative", nextNumber: 1 },
  ]);
  expect(
    await suite.db.select({ approval: fiscalAllocations.approval }).from(fiscalAllocations),
  ).toEqual([{ approval }]);
}
it("carries the supplied setup identities and signed input through the historical provisionVenue harness", async () => {
  const pending = establish();
  await expect(pending).resolves.toMatchObject({ nodeId: NODE });
  const result = await pending;
  expect(result.nodeId).toBe(NODE);
  expect(result.seeded).toEqual([
    { module: "fiscal-verifactu", report: expect.stringContaining("installation S000042") },
  ]);
  await allocatedVenue();
});
it("returns committed allocated references after an interrupted setup without another outside consultation", async () => {
  const result = await establish();
  await suite.db.update(invoiceSeries).set({ nextNumber: 37 });
  const before = await suite.db.select().from(invoiceSeries);
  const ledger = await suite.db.select().from(fiscalAllocations);
  await rm(process.env.WAITRON_FISCAL_CONFIRMATION_FILE!);
  const repeated = await recoverProvisionedVenue(suite.db, {
    environment: "preproduction",
    venue: request,
    initialOperations,
  });
  expect(repeated.nodeId).toBe(NODE);
  expect(repeated.seriesIds).toEqual(result.seriesIds);
  expect(await suite.db.select().from(invoiceSeries)).toEqual(before);
  expect(await suite.db.select().from(fiscalAllocations)).toEqual(ledger);
});
it("rolls back initial activation if the host's final write refuses", async () => {
  await expect(
    establish(async () => {
      throw new AppError("setup.request_invalid", { field: "configurationImport" });
    }),
  ).rejects.toMatchObject({
    code: "setup.request_invalid",
    params: { field: "configurationImport" },
  });
  await emptyVenue();
});
it("refuses unknown module input before opening a venue", async () => {
  await expect(
    provisionVenue(deps(), {
      environment: "preproduction",
      venue: request,
      initialOperations: {
        ...initialOperations,
        inputs: [{ ...initialOperations.inputs[0]!, module: "unselected-regime" }],
      },
    }),
  ).rejects.toMatchObject({
    code: "setup.request_invalid",
    params: { field: "initialOperations" },
  });
  await emptyVenue();
});
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
function app(overrides: Partial<SetupDeps> = {}) {
  const mounted = new Hono();
  mountSetup(
    mounted,
    {
      environment: "preproduction",
      db: suite.db,
      ring,
      provision: (req) => provisionVenue(deps(), req),
      recoverProvision: (req) => recoverProvisionedVenue(suite.db, req),
      seedDemo: async () => {},
      establishIdentity: async () => {},
      seedMembership: async () => {},
      persistTrading: async () => {},
      requestRestart: () => {},
      ...overrides,
    },
    () => {},
  );
  return mounted;
}
function body(input: unknown = initialOperations) {
  return {
    mode: "demo",
    initialOperations: input,
    venue: {
      ...request,
      fullSeriesCode: "FF",
      admin: {
        displayName: "Owner",
        pin: "1234",
        password: "correct-horse-battery",
        email: "owner@example.test",
      },
    },
  };
}
it("forwards signed input and planned identities from the public setup route", async () => {
  const response = await app().request("/setup-api/provision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body()),
  });
  expect(await response.clone().json()).toEqual({ provisioned: true, restarting: true });
  expect(response.status).toBe(200);
  await allocatedVenue();
});
it.each([
  null,
  {},
  { ...initialOperations, nodeId: "bad" },
  { ...initialOperations, authority: { forged: true } },
  { ...initialOperations, inputs: [initialOperations.inputs[0], initialOperations.inputs[0]] },
])("refuses malformed initialOperations at the public boundary %#", async (input) => {
  const response = await app().request("/setup-api/provision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body(input)),
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: { code: "setup.request_invalid", params: { field: "initialOperations" } },
  });
  await emptyVenue();
});

it.each(["nodeId", "administratorId"] as const)(
  "refuses interrupted recovery for another planned %s",
  async (field) => {
    await establish();
    await expect(
      recoverProvisionedVenue(suite.db, {
        environment: "preproduction",
        venue: request,
        initialOperations: {
          ...initialOperations,
          [field]: "c0000000-0000-4000-8000-000000000009",
        },
      }),
    ).rejects.toMatchObject({ code: "setup.already_provisioned" });
    await allocatedVenue();
  },
);
it("checks the module's recovered ids against the actual committed rows", async () => {
  await establish();
  const seed = modules[0]!.provisioning!.seed!;
  const resolve = seed.series!.resolve;
  modules[0] = {
    ...modules[0]!,
    provisioning: {
      seed: {
        ...seed,
        series: {
          resolve: async (tx, node, bases) =>
            (await resolve(tx, node, bases)).map((reference) => ({
              ...reference,
              id: "c0000000-0000-4000-8000-000000000009",
            })),
        },
      },
    },
  };
  await expect(
    recoverProvisionedVenue(suite.db, {
      environment: "preproduction",
      venue: request,
      initialOperations,
    }),
  ).rejects.toMatchObject({ code: "setup.already_provisioned" });
  await allocatedVenue();
});

it("resumes the actual persisted setup request after a committed venue lost its first response", async () => {
  let first = true;
  const mounted = app({
    operations: createSetupOperationStore(stateDir),
    provision: async (req) => {
      const result = await provisionVenue(deps(), req);
      if (first) {
        first = false;
        throw new Error("lost-response-after-commit");
      }
      return result;
    },
  });
  const send = () =>
    mounted.request("/setup-api/provision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body()),
    });
  expect((await send()).status).toBe(500);
  await allocatedVenue();
  const before = await suite.db.select().from(invoiceSeries);
  const ledger = await suite.db.select().from(fiscalAllocations);
  await rm(process.env.WAITRON_FISCAL_CONFIRMATION_FILE!);
  const recovered = await send();
  expect(recovered.status).toBe(200);
  expect(await recovered.json()).toEqual({ provisioned: true, restarting: true });
  expect(await suite.db.select().from(invoiceSeries)).toEqual(before);
  expect(await suite.db.select().from(fiscalAllocations)).toEqual(ledger);
  expect((await createSetupOperationStore(stateDir).read())?.phase).toBe("complete");
});
