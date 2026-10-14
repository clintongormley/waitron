import { seedFixtureSif as registerSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import { loadKeyRing, tryGetCredential } from "@waitron/credentials";
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
import {
  withOperationAuthority,
  withPreparedModuleOperations,
  type ModuleOperations,
  type WaitronModule,
} from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { nodeId } from "@waitron/shared";
import { assembleMirrorBundle, type ReservedIdentity } from "./mirror-bundle.js";
import { establishNodeIdentity } from "./node-identity.js";
import { adoptFromPrimary } from "./adopt.js";
import { readPendingAdoption } from "./finish-adoption.js";
import { establishReservedStandbyIdentity, generateStandbyIdentity } from "./reserved-identity.js";
import { promoteMirrorToPrimary } from "./promote.js";
import { createDeploymentHolders } from "./deployment-holders.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { withRecoveryKeyOperation } from "./operation-authentication.js";

const modules = vi.hoisted(() => [] as WaitronModule[]);
vi.mock("./modules.js", () => ({ ALL_MODULES: modules }));
const migrations = migrationOptionsFor(manifestSets(), null);
const primary = useVenueDb({ migrations });
const spare = useVenueDb({ migrations });
const unadopted = useVenueDb({ migrations });
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
  stateDir = await mkdtemp(join(tmpdir(), "allocated-standby-host-"));
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
  const operatorId = "administrator";
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
  const bundle = await withOperationAuthority(held.binding, held.operatorId, (authority) =>
    assembleMirrorBundle({
      appDb: primary.db,
      ring: RING,
      stateDir: stateDir!,
      relayUrl: "https://relay.test",
      boxHostname: "waitron.local",
      accountKey: "test-account-key",
      designated: { nodeId: PRIMARY, locationId: LOCATION },
      standby,
      moduleOperations: new Map([
        [held.binding.module, { binding: held.binding, authority, input: held.input }],
      ]),
    }),
  );
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
  return promoteMirrorToPrimary(
    {
      db: spare.db,
      ring: RING,
      nodeId: held.standby.nodeId,
      holders: createDeploymentHolders("mirror", "secondary"),
      log: () => {},
      persistTradingEnv: async () => {},
      modules,
      withModuleOperations: ({ db, node }, run) => {
        let prepared: ModuleOperations;
        return withRecoveryKeyOperation(
          { db, nodeId: node.nodeId },
          binding,
          key,
          (tx) => run(tx, prepared),
          (authority, commit) =>
            withPreparedModuleOperations(
              modules,
              new Map([[binding.module, { binding, authority, input }]]),
              node.nodeId,
              "promote",
              (ready) => {
                prepared = ready;
                return commit();
              },
            ),
        );
      },
    },
    { oldNodeNeutralised: true },
  );
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

it("reserves and adopts without an active SIF or series, then opens all purposes with the real node key at takeover", async () => {
  const primaryBefore = await primary.db.select().from(registroSif);
  const allocationsBefore = await primary.db.select().from(fiscalAllocations);
  const held = await reserve();
  expect(held.reserved.series).toEqual([]);
  expect(JSON.stringify(held.reserved)).not.toContain("authority");
  await establish(held);
  expect(await liveTarget(held.standby.nodeId)).toEqual({ sif: [], series: [], allocations: [] });
  expect(await spare.db.select().from(fiscalReservations)).toHaveLength(1);
  expect(await primary.db.select().from(registroSif)).toEqual(primaryBefore);
  expect(await primary.db.select().from(fiscalAllocations)).toEqual(allocationsBefore);
  await setDeploymentMode(spare.db, held.standby.nodeId, "mirror");
  const key = await mintBreakGlassSecret(spare.db, held.standby.nodeId);
  const result = await promote(held, key);
  expect(result.alreadyPrimary).toBe(false);
  const live = await liveTarget(held.standby.nodeId);
  expect(live.sif).toHaveLength(1);
  expect(live.sif[0]?.numeroInstalacion).toBe("P000042");
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

it("rolls back the sealed key and spare node when the carrier includes premature series", async () => {
  const held = await reserve();
  await expect(
    establish(held, { ...held.reserved, series: [{ code: "A-P000042", purpose: "standard" }] }),
  ).rejects.toMatchObject({
    code: "module.operation_invalid",
    params: { module: "fiscal-verifactu" },
  });
  expect(await spare.db.select().from(nodes).where(eq(nodes.id, held.standby.nodeId))).toEqual([]);
  expect(await spare.db.select().from(fiscalReservations)).toEqual([]);
  expect(await tryGetCredential(spare.db, RING, { purpose: "membership.node_key" })).toBeNull();
});

it("retains a dormant spare when independent current consumption is absent at takeover", async () => {
  const held = await reserve();
  await establish(held);
  await setDeploymentMode(spare.db, held.standby.nodeId, "mirror");
  const key = await mintBreakGlassSecret(spare.db, held.standby.nodeId);
  const reservation = await spare.db.select().from(fiscalReservations);
  await expect(promote(held, key, false)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
  expect(await liveTarget(held.standby.nodeId)).toEqual({ sif: [], series: [], allocations: [] });
  expect(await spare.db.select().from(fiscalReservations)).toEqual(reservation);
  expect(await readSingletonRole(spare.db, held.standby.nodeId)).toBe("secondary");
});

it("retains the dormant reservation and all fiscal rows after a refused membership write", async () => {
  const held = await reserve();
  await establish(held);
  await setDeploymentMode(spare.db, held.standby.nodeId, "mirror");
  const key = await mintBreakGlassSecret(spare.db, held.standby.nodeId);
  const reservation = await spare.db.select().from(fiscalReservations);
  await spare.db.execute(
    sql`create trigger refuse_chart before insert on node_membership begin select raise(abort, 'test chart refusal'); end`,
  );
  try {
    await expect(promote(held, key)).rejects.toThrow("test chart refusal");
    expect(await liveTarget(held.standby.nodeId)).toEqual({ sif: [], series: [], allocations: [] });
    expect(await spare.db.select().from(fiscalReservations)).toEqual(reservation);
    expect(await readSingletonRole(spare.db, held.standby.nodeId)).toBe("secondary");
  } finally {
    await spare.db.execute(sql`drop trigger refuse_chart`);
  }
});

it("a refused public adoption retains its independently signed reservation without stamping the empty spare", async () => {
  let target = "";
  let originalConfirmation = "";
  let originalReservation = "";
  const adoptionDir = join(stateDir!, "empty-adoption");
  await mkdir(adoptionDir);
  await expect(
    adoptFromPrimary(
      {
        ownerDb: unadopted.db,
        advertisedOrigin: "https://spare.test",
        environment: "preproduction",
        database: "synthetic-empty-spare",
        stateDir: adoptionDir,
        persistTrading: async () => {},
        persistModuleConfig: async () => {},
        fetchBundle: async (_url, _credential, standby) => {
          target = standby.nodeId;
          const held = joinRequest(target, "reserve");
          originalConfirmation = JSON.stringify(held.confirmation);
          originalReservation = JSON.stringify(held.input);
          await writeFile(configuration().confirmationPath, originalConfirmation);
          return withOperationAuthority(held.binding, held.operatorId, (authority) =>
            assembleMirrorBundle({
              appDb: primary.db,
              ring: RING,
              stateDir: stateDir!,
              relayUrl: "https://relay.test",
              boxHostname: "waitron.local",
              accountKey: "test-account-key",
              designated: { nodeId: PRIMARY, locationId: LOCATION },
              standby,
              moduleOperations: new Map([
                [held.binding.module, { binding: held.binding, authority, input: held.input }],
              ]),
            }),
          );
        },
      },
      {
        primaryUrl: "https://primary.test",
        credential: {
          personId: "e1000000-0000-4000-8000-000000000003",
          password: "synthetic-unused-credential",
        },
      },
      { beforeFirstWrite: async () => {} },
    ),
  ).rejects.toMatchObject({
    code: "module.operation_invalid",
    params: { module: "fiscal-verifactu" },
  });
  expect(target).not.toBe("");
  expect(await readFile(configuration().confirmationPath, "utf8")).toBe(originalConfirmation);
  expect(JSON.stringify(joinRequest(target, "reserve").input)).toBe(originalReservation);
  expect(await unadopted.db.select().from(deployment)).toEqual([]);
  expect(await unadopted.db.select().from(nodes)).toEqual([]);
  expect(await unadopted.db.select().from(fiscalReservations)).toEqual([]);
  expect(await unadopted.db.select().from(fiscalAllocations)).toEqual([]);
  expect(await tryGetCredential(unadopted.db, RING, { purpose: "membership.node_key" })).toBeNull();
  expect(await readPendingAdoption(adoptionDir)).toBeNull();
});
