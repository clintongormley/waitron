import { Hono } from "hono";
import { persons, hashPassword } from "@waitron/identity";
import { mountMirrorBundleApi } from "./mirror-bundle-api.js";
import { mountPromoteApi } from "./promote-api.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { loadKeyRing } from "@waitron/credentials";
import {
  deployment,
  invoiceSeries,
  locations,
  nodes,
  tenants,
  readSingletonRole,
  setDeploymentMode,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  ALLOCATED_FISCAL_STANDBY,
  createPaperAllocationPreparation,
  registerSif,
} from "@waitron/fiscal-verifactu";
import { registroSif } from "@waitron/fiscal-verifactu/src/schema/sif.js";
import { fiscalReservations } from "@waitron/fiscal-verifactu/src/schema/reservations.js";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import {
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperReservationForBlock,
  signPaperConsumptionForBlock,
} from "@waitron/fiscal-verifactu/src/paper-evidence.js";
import { withOperationAuthority, type WaitronModule } from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { nodeId } from "@waitron/shared";
import { type ReservedIdentity } from "./mirror-bundle.js";
import { establishNodeIdentity } from "./node-identity.js";
import { establishReservedStandbyIdentity, generateStandbyIdentity } from "./reserved-identity.js";
import { promoteMirrorToPrimary } from "./promote.js";
import { createDeploymentHolders } from "./deployment-holders.js";
import { mintBreakGlassSecret } from "./break-glass.js";

const modules = vi.hoisted(() => [] as WaitronModule[]);
vi.mock("./modules.js", () => ({ ALL_MODULES: modules }));
const migrations = migrationOptionsFor(manifestSets(), null);
const primary = useVenueDb({ migrations });
const spare = useVenueDb({ migrations });
const ADMIN = "e1000000-0000-4000-8000-000000000004";
const PASSWORD = "public-synthetic-admin";
const HASH = hashPassword(PASSWORD);
const LOCATION = "e1000000-0000-4000-8000-000000000001";
const PRIMARY = "e1000000-0000-4000-8000-000000000002";
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x1b).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const fingerprint = paperCustodianFingerprint(publicKey)!;
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const allocation = {
  version: 1 as const,
  allocationId: "standby-host-allocation",
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
    custodianId: "standby-host-custodian",
    generationId: "host-generation",
    blockId: "host-block",
    packVersion: 1,
    recipientVenueId: "host-venue",
    allocations: [allocation],
  },
  privateKey,
);
let stateDir: string | undefined;
beforeAll(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "allocated-standby-public-fiscal-"));
  await mkdir(join(stateDir, "tls"));
  await writeFile(join(stateDir, "tls", "ca.crt"), "public-test-ca");
});
afterAll(async () => {
  if (stateDir !== undefined) await rm(stateDir, { recursive: true, force: true });
});
function configuration() {
  return {
    custodianPath: join(stateDir!, "public.json"),
    confirmationPath: join(stateDir!, "current.json"),
    confirmedFingerprint: fingerprint,
  };
}
beforeEach(async () => {
  modules.splice(
    0,
    modules.length,
    fakeModule("fiscal-verifactu", {
      provisioning: { standby: ALLOCATED_FISCAL_STANDBY },
      operations: createPaperAllocationPreparation(configuration()),
    }),
  );
  await writeFile(
    configuration().custodianPath,
    JSON.stringify({ custodianId: "standby-host-custodian", publicKey, fingerprint }),
  );
  for (const db of [primary.db, spare.db]) {
    await db.insert(tenants).values({
      id: 1,
      country: "ES",
      taxId: allocation.taxpayerNif,
      legalName: "Standby Host SL",
    });
    await db.insert(locations).values({
      id: LOCATION,
      name: "Restaurant",
      invoiceLocales: ["es"],
      operationDescription: "Venta",
    });
    await db.insert(nodes).values({ id: PRIMARY, locationId: LOCATION, name: "Primary" });
    await db.insert(deployment).values({ id: 1, environment: "preproduction" });
    await withTransaction(db, (tx) =>
      registerSif(tx, {
        nodeId: nodeId(PRIMARY),
        nif: allocation.taxpayerNif,
        idSistemaInformatico: allocation.softwareId,
      }),
    );
    await db.insert(invoiceSeries).values(bases.map((base) => ({ ...base, nodeId: PRIMARY })));
  }
  await primary.db
    .insert(persons)
    .values({ id: ADMIN, displayName: "Administrator", role: "admin", passwordHash: HASH });
  await establishNodeIdentity({ ownerDb: primary.db, ring: RING }, PRIMARY);
});
function joinRequest(targetNodeId: string, action: string) {
  const binding = {
    module: "fiscal-verifactu",
    action,
    eventId: "host-join",
    sourceId: PRIMARY,
    targetNodeId,
  };
  const operatorId = ADMIN;
  const incidentEvidence = "master/host-join";
  const evidence = {
    block,
    reservation: signPaperReservationForBlock(
      block,
      allocation.allocationId,
      {
        eventId: binding.eventId,
        operatorId,
        sourceId: PRIMARY,
        targetNodeId,
        incidentEvidence,
        reservedAt: "2026-10-13T11:00:00.000Z",
      },
      privateKey,
    ),
  };
  const confirmation = {
    version: 1,
    allocationId: allocation.allocationId,
    binding,
    operatorId,
    incidentEvidence,
    recipientVenueId: "host-venue",
    generationId: "host-generation",
    blockId: "host-block",
    currentRegisterConfirmed: true,
    reservationConfirmed: true,
    currentEntryState: "reserved",
  };
  return { binding, operatorId, input: evidence, confirmation };
}
async function reserve(standby = generateStandbyIdentity()) {
  const held = joinRequest(standby.nodeId, "reserve");
  await writeFile(configuration().confirmationPath, JSON.stringify(held.confirmation));
  const app = new Hono();
  mountMirrorBundleApi(app, {
    appDb: primary.db,
    ring: RING,
    stateDir: stateDir!,
    relayUrl: "https://relay.test",
    boxHostname: "waitron.local",
    accountKey: "test-account-key",
    designated: { nodeId: PRIMARY, locationId: LOCATION },
    credentialKeyRing: TOTP_KEY_RING,
  });
  const response = await app.request("/management-api/mirror-bundle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      personId: ADMIN,
      password: PASSWORD,
      standbyNodeId: standby.nodeId,
      standbyPublicKey: standby.publicKey,
      standbyContactUrl: "https://spare.test",
      moduleOperation: { binding: held.binding, input: held.input },
    }),
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  const bundle = await response.json();
  return { standby, reserved: bundle.reservedIdentity };
}
async function establish(
  held: Awaited<ReturnType<typeof reserve>>,
  reserved: ReservedIdentity = held.reserved,
) {
  const request = joinRequest(held.standby.nodeId, "establish");
  await writeFile(configuration().confirmationPath, JSON.stringify(request.confirmation));
  await withOperationAuthority(request.binding, request.operatorId, (authority) =>
    establishReservedStandbyIdentity(
      { ownerDb: spare.db, ring: RING },
      {
        locationId: LOCATION,
        standby: held.standby,
        nodeName: "Spare",
        filingModule: "verifactu",
        taxModule: "vat",
        modules,
        reserved,
        moduleOperations: new Map([
          [request.binding.module, { binding: request.binding, authority, input: request.input }],
        ]),
      },
    ),
  );
}
async function promote(held: Awaited<ReturnType<typeof reserve>>, key: string, current = true) {
  const binding = {
    module: "fiscal-verifactu",
    action: "promote",
    eventId: "host-takeover",
    sourceId: PRIMARY,
    targetNodeId: held.standby.nodeId,
  };
  const operatorId = {
    kind: "recovery-key" as const,
    nodeId: held.standby.nodeId,
    eventId: binding.eventId,
  };
  const incidentEvidence = "master/host-takeover";
  const approval = {
    version: 1,
    eventId: binding.eventId,
    operatorId,
    sourceId: PRIMARY,
    targetNodeId: held.standby.nodeId,
    oldMachineOffline: true,
    oldMachineAbsent: false,
    noParallelRecovery: true,
    confirmedAt: "2026-10-13T12:00:00.000Z",
    incidentEvidence,
  };
  const consumption = signPaperConsumptionForBlock(
    block,
    allocation.allocationId,
    {
      eventId: binding.eventId,
      operatorId,
      sourceId: PRIMARY,
      targetNodeId: held.standby.nodeId,
      incidentEvidence,
      consumedAt: approval.confirmedAt,
    },
    privateKey,
  );
  const input = {
    allocation: { ...allocation, reservationEvidence: { block, consumption } },
    approval,
    reservationEventId: "host-join",
  };
  const confirmation = {
    version: 1,
    allocationId: allocation.allocationId,
    binding,
    operatorId,
    priorActivation: "none",
    incidentEvidence,
    requiredBases: bases,
    recipientVenueId: "host-venue",
    generationId: "host-generation",
    blockId: "host-block",
    currentRegisterConfirmed: current,
    consumptionConfirmed: current,
    currentEntryState: "consumed-for-event",
  };
  await writeFile(configuration().confirmationPath, JSON.stringify(confirmation));
  const app = new Hono();
  mountPromoteApi(app, {
    appDb: spare.db,
    nodeId: held.standby.nodeId,
    modules,
    credentialKeyRing: TOTP_KEY_RING,
    async run(attestation, withModuleOperations) {
      const result = await promoteMirrorToPrimary(
        {
          db: spare.db,
          ring: RING,
          nodeId: held.standby.nodeId,
          holders: createDeploymentHolders("mirror", "secondary"),
          log: () => {},
          persistTradingEnv: async () => {},
          modules,
          withModuleOperations,
        },
        attestation,
      );
      return { alreadyPrimary: result.alreadyPrimary, restarting: !result.alreadyPrimary };
    },
  });
  return app.request("/management-api/promote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      breakGlass: key,
      oldNodeNeutralised: true,
      moduleOperation: { binding, input },
    }),
  });
}

async function liveTarget(target: string) {
  return {
    sif: await spare.db
      .select()
      .from(registroSif)
      .where(and(eq(registroSif.nodeId, target), isNull(registroSif.revocadoEn))),
    series: await spare.db
      .select()
      .from(invoiceSeries)
      .where(and(eq(invoiceSeries.nodeId, target), isNull(invoiceSeries.retiredAt))),
    allocations: await spare.db.select().from(fiscalAllocations),
  };
}

it("consumes signed public reservation and takeover evidence through both HTTP routes", async () => {
  const held = await reserve();
  expect(held.reserved.series).toEqual([]);
  await establish(held);
  expect(await liveTarget(held.standby.nodeId)).toEqual({ sif: [], series: [], allocations: [] });
  await setDeploymentMode(spare.db, held.standby.nodeId, "mirror");
  const key = await mintBreakGlassSecret(spare.db, held.standby.nodeId);
  const response = await promote(held, key);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  const live = await liveTarget(held.standby.nodeId);
  expect(live.sif.map((row) => row.numeroInstalacion)).toEqual(["P000042"]);
  expect(
    live.series
      .map(({ code, purpose, nextNumber }) => ({ code, purpose, nextNumber }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  ).toEqual([
    { code: "A-P000042", purpose: "standard", nextNumber: 1 },
    { code: "FF-P000042", purpose: "full", nextNumber: 1 },
    { code: "R-P000042", purpose: "rectificative", nextNumber: 1 },
  ]);
  expect(live.allocations[0]?.approval.operatorId).toEqual({
    kind: "recovery-key",
    nodeId: held.standby.nodeId,
    eventId: "host-takeover",
  });
  expect(await readSingletonRole(spare.db, held.standby.nodeId)).toBe("primary");
});
it("refuses absent current outside consumption through HTTP and retains the dormant reservation", async () => {
  const held = await reserve();
  await establish(held);
  await setDeploymentMode(spare.db, held.standby.nodeId, "mirror");
  const key = await mintBreakGlassSecret(spare.db, held.standby.nodeId);
  const reservation = await spare.db.select().from(fiscalReservations);
  const response = await promote(held, key, false);
  expect(response.status).toBe(400);
  expect((await response.json()).error).toEqual({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
  expect(await liveTarget(held.standby.nodeId)).toEqual({ sif: [], series: [], allocations: [] });
  expect(await spare.db.select().from(fiscalReservations)).toEqual(reservation);
  expect(await readSingletonRole(spare.db, held.standby.nodeId)).toBe("secondary");
});
