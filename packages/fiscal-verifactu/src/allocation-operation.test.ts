import { seedFixtureSif as registerSif } from "../test/sif-fixture.js";
import { generateKeyPairSync } from "node:crypto";
import { beforeEach, expect, it } from "vitest";
import { deployment, invoiceSeries, withTransaction, type Transaction } from "@waitron/db";
import { sql } from "drizzle-orm";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withOperationAuthority, type ModuleOperationInput } from "@waitron/module";
import { locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import * as activation from "./allocation-operation.js";
import type { AllocationOperationEvidence } from "./allocation-operation.js";
import {
  enrolPaperCustodian,
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
  signPaperReservationForBlock,
  type PaperAllocation,
} from "./paper-evidence.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { registroSif } from "./schema/sif.js";
import { drawEmergencyIdentity, type RecoveryApproval } from "./allocation-envelope.js";
import { establishDormantAllocation } from "./standby-allocation.js";

import { fiscalReservations } from "./schema/reservations.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const trust = enrolPaperCustodian("custodian", publicKey, paperCustodianFingerprint(publicKey))!;
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const binding = {
  module: "fiscal-verifactu",
  action: "restore",
  eventId: "restore-42",
  sourceId: "backup-1",
  targetNodeId: node.nodeId,
};
const operator = { kind: "recovery-key" as const, nodeId: node.nodeId, eventId: binding.eventId };
const approval = {
  version: 1 as const,
  eventId: binding.eventId,
  operatorId: operator,
  sourceId: binding.sourceId,
  targetNodeId: node.nodeId,
  oldMachineOffline: true,
  oldMachineAbsent: false,
  noParallelRecovery: true,
  confirmedAt: "2026-10-13T08:00:00.000Z",
  incidentEvidence: "master/restore-42",
};
const candidate = {
  version: 1 as const,
  allocationId: "allocation-42",
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
  issuedAt: "2026-10-13T07:00:00.000Z",
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
const consumption = signPaperConsumptionForBlock(
  block,
  candidate.allocationId,
  {
    eventId: binding.eventId,
    operatorId: operator,
    sourceId: binding.sourceId,
    targetNodeId: node.nodeId,
    incidentEvidence: approval.incidentEvidence,
    consumedAt: approval.confirmedAt,
  },
  privateKey,
);
const input = {
  allocation: { ...candidate, reservationEvidence: { block, consumption } },
  approval,
};
const host = {
  incidentEvidence: approval.incidentEvidence,
  priorActivation: "none" as const,
  authority: {
    kind: "paper" as const,
    trust,
    recipientVenueId: "venue-1",
    generationId: "generation-1",
    blockId: "block-1",
    currentRegisterConfirmed: true,
    consumptionConfirmed: true,
    currentEntryState: "consumed-for-event" as const,
  },
};
function run(
  tx: Transaction,
  operation: ModuleOperationInput,
  evidence: AllocationOperationEvidence = host,
) {
  return activation.activateModuleAllocation(tx, node, operation, evidence);
}

beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await suite.db
    .insert(invoiceSeries)
    .values(bases.map((base) => ({ ...base, nodeId: node.nodeId })));
});

async function snapshot() {
  return {
    sifs: await suite.db.select().from(registroSif),
    series: await suite.db.select().from(invoiceSeries),
    activations: await suite.db.select().from(fiscalAllocations),
    reservations: await suite.db.select().from(fiscalReservations),
  };
}

it.each([
  null,
  undefined,
  [],
  {},
  { allocation: input.allocation },
  { approval },
  { ...input, context: { operatorId: "caller-chosen" } },
  { ...input, secret: "must-not-be-recorded" },
  { ...input, allocation: () => undefined },
  Object.assign({ ...input }, { [Symbol("hidden")]: "must-not-be-recorded" }),
  Object.assign(Object.create(input) as object, { extra: true }),
])("refuses malformed or extra opaque input before any allocation write %#", async (value) => {
  const before = await snapshot();
  await withOperationAuthority(binding, operator, (authority) =>
    expect(
      withTransaction(suite.db, (tx) => run(tx, { input: value, binding, authority })),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "malformed_allocation" },
    }),
  );
  expect(await snapshot()).toEqual(before);
});

function signed(input: PaperAllocation, permission: RecoveryApproval) {
  const signedBlock = signPaperBlock(
    {
      version: 1,
      custodianId: "custodian",
      generationId: "generation-1",
      blockId: "block-1",
      packVersion: 1,
      recipientVenueId: "venue-1",
      allocations: [input],
    },
    privateKey,
  );
  return {
    allocation: {
      ...input,
      reservationEvidence: {
        block: signedBlock,
        consumption: signPaperConsumptionForBlock(
          signedBlock,
          input.allocationId,
          {
            eventId: permission.eventId,
            operatorId: permission.operatorId,
            sourceId: permission.sourceId,
            targetNodeId: permission.targetNodeId,
            incidentEvidence: permission.incidentEvidence,
            consumedAt: permission.confirmedAt,
          },
          privateKey,
        ),
      },
    },
    approval: permission,
  };
}

it("opens the supplied initial identities without writing scaffold series", async () => {
  await suite.db.delete(invoiceSeries);
  const setup = { ...binding, action: "setup", eventId: "setup-1", sourceId: "setup-request-1" };
  const permission = {
    ...approval,
    eventId: setup.eventId,
    sourceId: setup.sourceId,
    operatorId: "administrator",
    oldMachineAbsent: true,
    oldMachineOffline: false,
  };
  const initial = signed(
    {
      ...candidate,
      allocationId: "initial-1",
      source: "initial-paper",
      installationIdentity: "S000001",
      series: [
        { code: "A-S000001", purpose: "standard" },
        { code: "FF-S000001", purpose: "full" },
        { code: "R-S000001", purpose: "rectificative" },
      ],
    },
    permission,
  );
  const result = await withOperationAuthority(setup, permission.operatorId, (authority) =>
    withTransaction(suite.db, (tx) =>
      run(
        tx,
        { input: initial, binding: setup, authority },
        {
          ...host,
          requiredBases: bases,
        },
      ),
    ),
  );
  expect(result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
    { code: "A-S000001", purpose: "standard" },
    { code: "FF-S000001", purpose: "full" },
    { code: "R-S000001", purpose: "rectificative" },
  ]);
  expect(await suite.db.select().from(invoiceSeries)).toHaveLength(3);
  expect((await suite.db.select().from(fiscalAllocations))[0]!.approval.operatorId).toBe(
    "administrator",
  );
});

it("activates the exact retained dormant reservation at promotion", async () => {
  await withTransaction(suite.db, (tx) =>
    registerSif(tx, {
      nodeId: node.nodeId,
      nif: candidate.taxpayerNif,
      idSistemaInformatico: "W1",
    }),
  );
  const target = { ...node, nodeId: TENANT_A.nodeId2 };
  const join = {
    eventId: "join-1",
    sourceId: node.nodeId,
    targetNodeId: target.nodeId,
    operatorId: "administrator",
    incidentEvidence: "master/join-1",
    reservedAt: approval.confirmedAt,
  };
  const reservation = {
    block,
    reservation: signPaperReservationForBlock(block, candidate.allocationId, join, privateKey),
  };
  await withTransaction(suite.db, (tx) =>
    establishDormantAllocation(tx, node, target, reservation, trust, {
      ...join,
      allocationId: candidate.allocationId,
      taxpayerNif: candidate.taxpayerNif,
      softwareId: "W1",
      environment: "preproduction",
      recipientVenueId: "venue-1",
      generationId: "generation-1",
      blockId: "block-1",
      currentRegisterConfirmed: true,
      reservationConfirmed: true,
      currentEntryState: "reserved",
      requiredBases: bases,
    }),
  );
  const promotion = {
    ...binding,
    action: "promote",
    sourceId: node.nodeId,
    targetNodeId: target.nodeId,
  };
  const keyEvent = { ...operator, nodeId: target.nodeId };
  const permission = {
    ...approval,
    sourceId: node.nodeId,
    targetNodeId: target.nodeId,
    operatorId: keyEvent,
  };
  const supplied = { ...signed(candidate, permission), reservationEventId: join.eventId };
  const before = await suite.db.select().from(fiscalReservations);
  const pending = withOperationAuthority(promotion, keyEvent, (authority) =>
    withTransaction(suite.db, (tx) =>
      activation.activateModuleAllocation(
        tx,
        target,
        { input: supplied, binding: promotion, authority },
        host,
      ),
    ),
  );
  await expect(pending).resolves.toHaveProperty("activationEventId", "restore-42");
  const result = await pending;
  expect(result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
    { code: "A-P000042", purpose: "standard" },
    { code: "FF-P000042", purpose: "full" },
    { code: "R-P000042", purpose: "rectificative" },
  ]);
  expect(await suite.db.select().from(fiscalReservations)).toEqual(before);
  expect((await suite.db.select().from(fiscalAllocations))[0]!.nodeId).toBe(target.nodeId);
});

it("preserves a genuine in-process emergency draw while detaching the outside history", async () => {
  const draw = drawEmergencyIdentity();
  const emergency = {
    ...candidate,
    source: "emergency",
    installationIdentity: draw.identity,
    series: bases.map((base) => ({ ...base, code: `${base.code}-${draw.identity}` })),
    reservationEvidence: { checksum: draw.checksum },
  };
  const history: string[] = [];
  await withOperationAuthority(binding, operator, (authority) =>
    withTransaction(suite.db, async (tx) => {
      const result = run(
        tx,
        { input: { allocation: emergency, approval }, binding, authority },
        {
          ...host,
          authority: {
            kind: "emergency",
            draw,
            knownIdentities: history,
            incidentRecorded: true,
            uncertaintyRecorded: false,
          },
        },
      );
      history.push(draw.identity);
      await expect(result).resolves.toHaveProperty("activationEventId", "restore-42");
      expect((await result).series.map(({ code }) => code)).toEqual([
        `A-${draw.identity}`,
        `FF-${draw.identity}`,
        `R-${draw.identity}`,
      ]);
    }),
  );
});

it.each([
  ["module", "another-module"],
  ["action", "reserve"],
  ["targetNodeId", TENANT_A.nodeId2],
])("refuses a valid authority bound to another %s", async (field, value) => {
  const wrong = { ...binding, [field]: value };
  const before = await snapshot();
  await withOperationAuthority(wrong, operator, (authority) =>
    expect(
      withTransaction(suite.db, (tx) => run(tx, { input, binding: wrong, authority })),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reauthentication_required" },
    }),
  );
  expect(await snapshot()).toEqual(before);
});

it.each(["eventId", "sourceId"] as const)(
  "checks submitted %s against the authenticated binding",
  async (field) => {
    const wrong = { ...binding, [field]: "other-event-or-source" };
    const keyEvent = { ...operator, eventId: wrong.eventId };
    const before = await snapshot();
    await withOperationAuthority(wrong, keyEvent, (authority) =>
      expect(
        withTransaction(suite.db, (tx) => run(tx, { input, binding: wrong, authority })),
      ).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "event_mismatch" },
      }),
    );
    expect(await snapshot()).toEqual(before);
  },
);

it("refuses a claimed approval operator when the authority belongs to someone else", async () => {
  const before = await snapshot();
  await withOperationAuthority(binding, "another-administrator", (authority) =>
    expect(
      withTransaction(suite.db, (tx) => run(tx, { input, binding, authority })),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "event_mismatch" },
    }),
  );
  expect(await snapshot()).toEqual(before);
});

it("refuses expired authority before any database write", async () => {
  const before = await snapshot();
  const authority = await withOperationAuthority(binding, operator, async (issued) => issued);
  await expect(
    withTransaction(suite.db, (tx) => run(tx, { input, binding, authority })),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "reauthentication_required" },
  });
  expect(await snapshot()).toEqual(before);
});

it("rechecks authority when its scope ends during the database reads", async () => {
  const before = await snapshot();
  await withTransaction(suite.db, async (tx) => {
    let pending: ReturnType<typeof run> | undefined;
    await withOperationAuthority(binding, operator, async (authority) => {
      pending = run(tx, { input, binding, authority });
      void pending.catch(() => undefined);
    });
    await expect(pending).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reauthentication_required" },
    });
  });
  expect(await snapshot()).toEqual(before);
});

it("refuses an unstamped venue instead of trusting the submitted environment", async () => {
  await suite.db.delete(deployment);
  const before = await snapshot();
  await withOperationAuthority(binding, operator, (authority) =>
    expect(
      withTransaction(suite.db, (tx) => run(tx, { input, binding, authority })),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "environment_unstamped" },
    }),
  );
  expect(await snapshot()).toEqual(before);
});

it("does not round a supplied installation identity through the numeric declaration", async () => {
  await withOperationAuthority(binding, operator, (authority) =>
    withTransaction(suite.db, (tx) => run(tx, { input, binding, authority })),
  );
  expect((await suite.db.execute(sql`select numero_instalacion from registro_sif`)).rows).toEqual([
    { numero_instalacion: "P000042" },
  ]);
});

it("detaches submitted signed input before reading the database", async () => {
  const submitted = structuredClone(input);
  await withOperationAuthority(binding, operator, (authority) =>
    withTransaction(suite.db, async (tx) => {
      const result = run(tx, { input: submitted, binding, authority });
      submitted.allocation.series[0]!.code = "altered";
      submitted.approval.incidentEvidence = "altered";
      await expect(result).resolves.toHaveProperty("series.0.code", "A-P000042");
    }),
  );
  expect((await suite.db.select().from(fiscalAllocations))[0]!.approval).toEqual(approval);
});

it("detaches the host binding before reading the database", async () => {
  const mutableBinding = { ...binding };
  await withOperationAuthority(mutableBinding, operator, (authority) =>
    withTransaction(suite.db, async (tx) => {
      const result = run(tx, { input, binding: mutableBinding, authority });
      mutableBinding.eventId = "altered-event";
      mutableBinding.sourceId = "altered-backup";
      await expect(result).resolves.toHaveProperty("activationEventId", "restore-42");
    }),
  );
});

it("detaches independently held trust and confirmations before reading the database", async () => {
  const evidence = structuredClone(host);
  await withOperationAuthority(binding, operator, (authority) =>
    withTransaction(suite.db, async (tx) => {
      const result = run(tx, { input, binding, authority }, evidence);
      Reflect.set(evidence.authority.trust, "publicKey", "altered-key");
      evidence.authority.currentRegisterConfirmed = false;
      evidence.incidentEvidence = "altered-incident";
      await expect(result).resolves.toHaveProperty("activationEventId", "restore-42");
    }),
  );
});

it("requires a dormant reservation on the promotion path", async () => {
  const promotion = { ...binding, action: "promote" };
  const before = await snapshot();
  await withOperationAuthority(promotion, operator, (authority) =>
    expect(
      withTransaction(suite.db, (tx) => run(tx, { input, binding: promotion, authority })),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_missing" },
    }),
  );
  expect(await snapshot()).toEqual(before);
});

it("rolls back the adapter's complete activation when its caller's later write refuses", async () => {
  const before = await snapshot();
  await withOperationAuthority(binding, operator, (authority) =>
    expect(
      withTransaction(suite.db, async (tx) => {
        await run(tx, { input, binding, authority });
        throw new Error("caller refusal");
      }),
    ).rejects.toThrow("caller refusal"),
  );
  expect(await snapshot()).toEqual(before);
});

it("replays only the committed activation with new live authority and outside confirmation", async () => {
  const result = await withOperationAuthority(binding, operator, (authority) =>
    withTransaction(suite.db, (tx) => run(tx, { input, binding, authority })),
  );
  const before = await snapshot();
  const replay = await withOperationAuthority(binding, operator, (authority) =>
    withTransaction(suite.db, (tx) =>
      run(tx, { input, binding, authority }, { ...host, priorActivation: "committed" }),
    ),
  );
  expect(replay).toEqual(result);
  expect(await snapshot()).toEqual(before);
  await withOperationAuthority(binding, operator, (authority) =>
    expect(
      withTransaction(suite.db, (tx) =>
        run(
          tx,
          { input, binding, authority },
          {
            ...host,
            priorActivation: "committed",
            authority: { ...host.authority, consumptionConfirmed: false },
          },
        ),
      ),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    }),
  );
  expect(await snapshot()).toEqual(before);
});

it("activates all purposes from opaque module input with the independently authenticated key event", async () => {
  const result = await withOperationAuthority(binding, operator, (authority) =>
    withTransaction(suite.db, (tx) => run(tx, { input, binding, authority })),
  );
  expect(result.activationEventId).toBe("restore-42");
  expect(result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
    { code: "A-P000042", purpose: "standard" },
    { code: "FF-P000042", purpose: "full" },
    { code: "R-P000042", purpose: "rectificative" },
  ]);
  const [sif] = await suite.db.select().from(registroSif);
  expect(sif!.id).toBe(result.sifId);
  const [retained] = await suite.db.select().from(fiscalAllocations);
  expect(retained!.result).toEqual(result);
  expect(retained!.approval).toEqual(approval);
  expect(retained!.allocation).toEqual(input.allocation);
  expect(retained!.bases).toEqual(bases);
  expect(
    (await suite.db.select().from(invoiceSeries))
      .filter((row) => row.retiredAt === null)
      .map(({ id, code, purpose }) => ({ id, code, purpose }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  ).toEqual(result.series);
});

async function readAllocated(basesToRead = bases, target = node) {
  const api = activation as unknown as {
    readModuleAllocationSeries?: (
      tx: Transaction,
      node: typeof target,
      bases: typeof basesToRead,
    ) => Promise<readonly { id: string; code: string; purpose: string }[]>;
  };
  expect(api.readModuleAllocationSeries).toBeTypeOf("function");
  return withTransaction(suite.db, (tx) =>
    api.readModuleAllocationSeries!(tx, target, basesToRead),
  );
}
async function activateForRead() {
  return withOperationAuthority(binding, operator, (authority) =>
    withTransaction(suite.db, (tx) => run(tx, { input, binding, authority })),
  );
}

it("reads the actual committed allocation references without resetting series on setup retry", async () => {
  const result = await activateForRead();
  await suite.db.update(invoiceSeries).set({ nextNumber: 12 });
  const before = await snapshot();
  expect(await readAllocated()).toEqual(result.series);
  expect(await readAllocated([...bases].reverse())).toEqual(result.series);
  expect(await snapshot()).toEqual(before);
});

it.each(
  [
    bases.slice(0, 2),
    [{ code: "other", purpose: "standard" }, ...bases.slice(1)],
    [bases[0]!, bases[0]!, bases[2]!],
  ].map((otherBases) => [otherBases]),
)(
  "refuses requested setup bases that differ from the committed allocation %#",
  async (otherBases) => {
    await activateForRead();
    const before = await snapshot();
    await expect(readAllocated(otherBases)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "series_mismatch" },
    });
    expect(await snapshot()).toEqual(before);
  },
);

it("refuses unallocated live series rather than blessing scaffold references", async () => {
  const before = await snapshot();
  await expect(readAllocated()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "activation_superseded" },
  });
  expect(await snapshot()).toEqual(before);
});

it.each([
  "taxpayer",
  "environment",
  "identity",
  "code",
  "retired",
  "extra",
  "software",
  "sif-retired",
])("refuses a committed allocation after its %s changed", async (field) => {
  await activateForRead();
  if (field === "taxpayer") await suite.db.execute(sql`update tenants set tax_id = '89890002M'`);
  if (field === "environment") await suite.db.update(deployment).set({ environment: "production" });
  if (field === "identity")
    await suite.db.execute(sql`update registro_sif set numero_instalacion = 'P000043'`);
  if (field === "code")
    await suite.db
      .update(invoiceSeries)
      .set({ code: "changed" })
      .where(sql`${invoiceSeries.purpose} = 'standard' and ${invoiceSeries.retiredAt} is null`);
  if (field === "retired")
    await suite.db
      .update(invoiceSeries)
      .set({ retiredAt: new Date() })
      .where(sql`${invoiceSeries.purpose} = 'standard'`);
  if (field === "extra")
    await suite.db
      .insert(invoiceSeries)
      .values({ nodeId: node.nodeId, code: "other", purpose: "standard" });
  if (field === "software") await suite.db.update(registroSif).set({ idSistemaInformatico: "W2" });
  if (field === "sif-retired") await suite.db.update(registroSif).set({ revocadoEn: new Date() });
  const before = await snapshot();
  await expect(readAllocated()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "activation_superseded" },
  });
  expect(await snapshot()).toEqual(before);
});

it("refuses allocation references for a node presented under another location", async () => {
  await activateForRead();
  await expect(
    readAllocated(bases, {
      ...node,
      locationId: locationId("b0000000-0000-4000-8000-000000000099"),
    }),
  ).rejects.toMatchObject({ code: "sif.allocation_invalid", params: { reason: "node_mismatch" } });
});

it("refuses a live SIF that has no committed allocation ledger", async () => {
  await withTransaction(suite.db, (tx) =>
    registerSif(tx, {
      nodeId: node.nodeId,
      nif: candidate.taxpayerNif,
      idSistemaInformatico: "W1",
    }),
  );
  const before = await snapshot();
  await expect(readAllocated()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "activation_superseded" },
  });
  expect(await snapshot()).toEqual(before);
});

it("snapshots requested bases before the first awaited read", async () => {
  const result = await activateForRead();
  const mutable = structuredClone(bases);
  await withTransaction(suite.db, async (tx) => {
    const reading = activation.readModuleAllocationSeries(tx, node, mutable);
    mutable[0]!.code = "altered";
    expect(await reading).toEqual(result.series);
  });
});
