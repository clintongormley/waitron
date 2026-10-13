import { generateKeyPairSync } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { deployment, invoiceSeries, tenants, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  withOperationAuthority,
  withPreparedModuleOperations,
  type ModuleOperationInput,
  type ProvisionedNode,
} from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { AppError, locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import {
  ALLOCATED_FISCAL_SEED,
  ALLOCATED_FISCAL_RESTORE,
  activatePreparedFiscalStandby,
} from "./allocated-lifecycle.js";
import { createAllocationPreparation } from "./allocation-preparation.js";
import type {
  AllocationEvidenceSource,
  AllocationOperationEvidence,
} from "./allocation-operation.js";
import {
  enrolPaperCustodian,
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
  signPaperReservationForBlock,
} from "./paper-evidence.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { registroSif } from "./schema/sif.js";
import { fiscalReservations } from "./schema/reservations.js";
import { establishDormantAllocation } from "./standby-allocation.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const trust = enrolPaperCustodian(
  "lifecycle-custodian",
  publicKey,
  paperCustodianFingerprint(publicKey),
)!;
const seed = ALLOCATED_FISCAL_SEED;
const restore = ALLOCATED_FISCAL_RESTORE;
const promote = activatePreparedFiscalStandby;

function request(
  action: string,
  identity = action === "setup" ? "S000001" : "P000042",
  target = node,
) {
  const binding = {
    module: "fiscal-verifactu",
    action,
    eventId: `${action}-${identity}`,
    sourceId:
      action === "setup" ? "initial-venue" : action === "promote" ? node.nodeId : "archive-1",
    targetNodeId: target.nodeId,
  };
  const operatorId = "administrator";
  const candidate = {
    version: 1 as const,
    allocationId: `allocation-${identity}`,
    taxpayerNif: "89890001K",
    softwareId: "W1",
    environment: "preproduction" as const,
    installationIdentity: identity,
    series: bases.map(({ code, purpose }) => ({ code: `${code}-${identity}`, purpose })),
    source: action === "setup" ? ("initial-paper" as const) : ("paper" as const),
    issuedAt: "2026-10-13T09:00:00.000Z",
  };
  const block = signPaperBlock(
    {
      version: 1,
      custodianId: "lifecycle-custodian",
      generationId: "lifecycle-generation",
      blockId: `block-${identity}`,
      packVersion: 1,
      recipientVenueId: "lifecycle-venue",
      allocations: [candidate],
    },
    privateKey,
  );
  const approval = {
    version: 1 as const,
    eventId: binding.eventId,
    sourceId: binding.sourceId,
    targetNodeId: binding.targetNodeId,
    operatorId,
    oldMachineOffline: action !== "setup",
    oldMachineAbsent: action === "setup",
    noParallelRecovery: true,
    confirmedAt: "2026-10-13T10:00:00.000Z",
    incidentEvidence: `master/${binding.eventId}`,
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
  const evidence: AllocationOperationEvidence = {
    allocationId: candidate.allocationId,
    priorActivation: "none",
    incidentEvidence: approval.incidentEvidence,
    requiredBases: bases,
    authority: {
      kind: "paper",
      trust,
      recipientVenueId: "lifecycle-venue",
      generationId: "lifecycle-generation",
      blockId: block.payload.blockId,
      currentRegisterConfirmed: true,
      consumptionConfirmed: true,
      currentEntryState: "consumed-for-event",
    },
  };
  return {
    binding,
    operatorId,
    input: {
      allocation: { ...candidate, reservationEvidence: { block, consumption } },
      approval,
      ...(action === "promote" ? { reservationEventId: "standby-join" } : {}),
    },
    evidence,
  };
}

function attempt<T>(
  action: string,
  run: (tx: Transaction, operation: ModuleOperationInput) => Promise<T>,
  options: {
    identity?: string;
    source?: AllocationEvidenceSource;
    target?: ProvisionedNode;
    priorActivation?: "none" | "committed";
  } = {},
) {
  const target = options.target ?? node;
  const held = request(action, options.identity, target);
  const source: AllocationEvidenceSource =
    options.source ??
    (async () => ({
      binding: held.binding,
      operatorId: held.operatorId,
      evidence: { ...held.evidence, priorActivation: options.priorActivation ?? "none" },
    }));
  const module = fakeModule(held.binding.module, {
    operations: createAllocationPreparation(source),
  });
  return withOperationAuthority(held.binding, held.operatorId, (authority) =>
    withPreparedModuleOperations(
      [module],
      new Map([
        [
          module.name,
          {
            binding: held.binding,
            authority,
            input: held.input,
          },
        ],
      ]),
      target.nodeId,
      action,
      (ready) => withTransaction(suite.db, (tx) => run(tx, ready.get(module.name)!)),
    ),
  );
}

async function liveSeries() {
  return suite.db
    .select()
    .from(invoiceSeries)
    .where(and(eq(invoiceSeries.nodeId, node.nodeId), isNull(invoiceSeries.retiredAt)))
    .orderBy(invoiceSeries.code);
}
function refusal(reason: string) {
  return { code: "sif.allocation_invalid", params: { reason } };
}

beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
});

it("the setup seed creates exactly the supplied SIF and every purpose without scaffold series", async () => {
  const report = await attempt("setup", (tx, operation) => seed.run(tx, node, operation));
  const sifs = await suite.db.select().from(registroSif);
  expect(sifs).toHaveLength(1);
  expect(sifs[0]).toMatchObject({
    nif: "89890001K",
    idSistemaInformatico: "W1",
    numeroInstalacion: "S000001",
    revocadoEn: null,
  });
  expect(report).toContain("installation S000001");
  expect(
    (await liveSeries()).map(({ code, purpose, nextNumber }) => ({ code, purpose, nextNumber })),
  ).toEqual([
    { code: "A-S000001", purpose: "standard", nextNumber: 1 },
    { code: "FF-S000001", purpose: "full", nextNumber: 1 },
    { code: "R-S000001", purpose: "rectificative", nextNumber: 1 },
  ]);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
});

it.each(["restore", "re-register"])(
  "%s replaces all live identities once and returns no series for the host to recreate",
  async (action) => {
    await attempt("setup", (tx, operation) => seed.run(tx, node, operation));
    const oldSif = (await suite.db.select().from(registroSif))[0]!;
    await suite.db.update(invoiceSeries).set({ nextNumber: 23 });
    const oldSeries = await liveSeries();
    const report = await attempt(action, async (tx, operation) =>
      action === "restore" ? restore(tx, node, operation) : seed.run(tx, node, operation),
    );
    expect(typeof report === "string" ? report : report.report).toContain("installation P000042");
    if (typeof report !== "string") expect(report.series).toBeUndefined();
    const history = await suite.db.select().from(registroSif);
    expect(history).toHaveLength(2);
    expect(history.find((row) => row.id === oldSif.id)).toMatchObject({
      ...oldSif,
      revocadoEn: expect.any(Date),
    });
    expect(history.find((row) => row.revocadoEn === null)).toMatchObject({
      numeroInstalacion: "P000042",
    });
    for (const old of oldSeries) {
      const [retained] = await suite.db
        .select()
        .from(invoiceSeries)
        .where(eq(invoiceSeries.id, old.id));
      expect(retained).toEqual({ ...old, retiredAt: expect.any(Date) });
    }
    expect(
      (await liveSeries()).map(({ code, purpose, nextNumber }) => ({ code, purpose, nextNumber })),
    ).toEqual([
      { code: "A-P000042", purpose: "standard", nextNumber: 1 },
      { code: "FF-P000042", purpose: "full", nextNumber: 1 },
      { code: "R-P000042", purpose: "rectificative", nextNumber: 1 },
    ]);
    expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(2);
  },
);

it("a missing setup approval cannot mint a local identity", async () => {
  await expect(withTransaction(suite.db, (tx) => seed.run(tx, node))).rejects.toMatchObject(
    refusal("reauthentication_required"),
  );
  expect(await suite.db.select().from(registroSif)).toEqual([]);
  expect(await suite.db.select().from(invoiceSeries)).toEqual([]);
});

it("a raw uncollected setup approval cannot mint a local identity", async () => {
  const held = request("setup");
  await withOperationAuthority(held.binding, held.operatorId, async (authority) => {
    await expect(
      withTransaction(suite.db, (tx) =>
        seed.run(tx, node, { binding: held.binding, authority, input: held.input }),
      ),
    ).rejects.toMatchObject(refusal("outside_confirmation_missing"));
  });
  expect(await suite.db.select().from(registroSif)).toEqual([]);
});

it("keeps an absent taxpayer as a corrupt-database failure rather than an operator refusal", async () => {
  await suite.db.delete(tenants);
  const error = await attempt("setup", (tx, operation) => seed.run(tx, node, operation)).catch(
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(AppError);
  expect((error as Error).message).toContain("tenants is empty");
  expect(await suite.db.select().from(registroSif)).toEqual([]);
  expect(await suite.db.select().from(invoiceSeries)).toEqual([]);
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});

it("a restore of a node that never filed leaves its series unchanged", async () => {
  await suite.db.insert(invoiceSeries).values({ nodeId: node.nodeId, code: "A" });
  const before = await liveSeries();
  const result = await withTransaction(suite.db, (tx) => restore(tx, node));
  expect(result.series).toBeUndefined();
  expect(result.report).toContain("no live SIF");
  expect(await liveSeries()).toEqual(before);
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});

it("a later host refusal rolls back the complete seeded set", async () => {
  await expect(
    attempt("setup", async (tx, operation) => {
      await seed.run(tx, node, operation);
      throw new Error("host-write-refused");
    }),
  ).rejects.toThrow("host-write-refused");
  expect(await suite.db.select().from(registroSif)).toEqual([]);
  expect(await suite.db.select().from(invoiceSeries)).toEqual([]);
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});

it.each(["restore", "promote"])(
  "the seed cannot consume a prepared %s operation",
  async (action) => {
    await expect(
      attempt(action, (tx, operation) => seed.run(tx, node, operation)),
    ).rejects.toMatchObject(refusal("event_mismatch"));
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
    expect(await suite.db.select().from(registroSif)).toEqual([]);
  },
);

it("the restore hook cannot consume a prepared setup operation", async () => {
  await attempt("setup", (tx, operation) => seed.run(tx, node, operation));
  const before = await suite.db.select().from(registroSif);
  await expect(
    attempt("setup", (tx, operation) => restore(tx, node, operation), { identity: "S000002" }),
  ).rejects.toMatchObject(refusal("event_mismatch"));
  expect(await suite.db.select().from(registroSif)).toEqual(before);
});

it("the restore hook refuses missing authority on a filing node", async () => {
  await attempt("setup", (tx, operation) => seed.run(tx, node, operation));
  const before = await suite.db.select().from(registroSif);
  await expect(withTransaction(suite.db, (tx) => restore(tx, node))).rejects.toMatchObject(
    refusal("reauthentication_required"),
  );
  expect(await suite.db.select().from(registroSif)).toEqual(before);
});

it.each([
  new Error("stored-SIF-read-refused"),
  new AppError("sif.id_sistema_invalid", { value: "bad", maxLength: 2 }),
])("propagates a SIF read failure without treating it as a non-filing node: %s", async (error) => {
  await expect(
    withTransaction(suite.db, async (tx) => {
      const read = vi.spyOn(tx, "select").mockImplementationOnce(() => {
        throw error;
      });
      try {
        return await restore(tx, node);
      } finally {
        read.mockRestore();
      }
    }),
  ).rejects.toBe(error);
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});

it.each(["setup", "restore", "re-register"])(
  "committed %s retries retain the exact series ids and counters",
  async (action) => {
    if (action !== "setup")
      await attempt("setup", (tx, operation) => seed.run(tx, node, operation));
    const run = async (tx: Transaction, operation: ModuleOperationInput) =>
      action === "restore" ? restore(tx, node, operation) : seed.run(tx, node, operation);
    const first = await attempt(action, run);
    await suite.db
      .update(invoiceSeries)
      .set({ nextNumber: 37 })
      .where(isNull(invoiceSeries.retiredAt));
    const before = await suite.db.select().from(invoiceSeries);
    const sifs = await suite.db.select().from(registroSif);
    const ledger = await suite.db.select().from(fiscalAllocations);
    expect(await attempt(action, run, { priorActivation: "committed" })).toEqual(first);
    expect(await suite.db.select().from(invoiceSeries)).toEqual(before);
    expect(await suite.db.select().from(registroSif)).toEqual(sifs);
    expect(await suite.db.select().from(fiscalAllocations)).toEqual(ledger);
  },
);

it.each(["setup", "restore", "re-register"])(
  "a promotion hook cannot consume a prepared %s operation",
  async (action) => {
    await expect(
      attempt(action, (tx, operation) => promote(tx, node, operation)),
    ).rejects.toMatchObject(refusal("event_mismatch"));
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
    expect(await suite.db.select().from(registroSif)).toEqual([]);
  },
);

it("promotes a retained dormant reservation once, without resetting counters on retry", async () => {
  await attempt("setup", (tx, operation) => seed.run(tx, node, operation));
  const target = { ...node, nodeId: TENANT_A.nodeId2 };
  const held = request("promote", "P000042", target);
  const proof = held.input.allocation.reservationEvidence.block;
  const join = {
    eventId: "standby-join",
    sourceId: node.nodeId,
    targetNodeId: target.nodeId,
    operatorId: "join-administrator",
    incidentEvidence: "master/standby-join",
    reservedAt: "2026-10-13T09:30:00.000Z",
  };
  await withTransaction(suite.db, (tx) =>
    establishDormantAllocation(
      tx,
      node,
      target,
      {
        block: proof,
        reservation: signPaperReservationForBlock(
          proof,
          held.input.allocation.allocationId,
          join,
          privateKey,
        ),
      },
      trust,
      {
        ...join,
        allocationId: held.input.allocation.allocationId,
        taxpayerNif: "89890001K",
        softwareId: "W1",
        environment: "preproduction",
        recipientVenueId: "lifecycle-venue",
        generationId: "lifecycle-generation",
        blockId: proof.payload.blockId,
        currentRegisterConfirmed: true,
        reservationConfirmed: true,
        currentEntryState: "reserved",
        requiredBases: bases,
      },
    ),
  );
  const reservation = await suite.db.select().from(fiscalReservations);
  expect(
    await suite.db.select().from(registroSif).where(eq(registroSif.nodeId, target.nodeId)),
  ).toEqual([]);
  expect(
    await suite.db.select().from(invoiceSeries).where(eq(invoiceSeries.nodeId, target.nodeId)),
  ).toEqual([]);
  const run = (tx: Transaction, operation: ModuleOperationInput) => promote(tx, target, operation);
  await attempt("promote", run, { target });
  const targetSifs = await suite.db
    .select()
    .from(registroSif)
    .where(eq(registroSif.nodeId, target.nodeId));
  expect(targetSifs).toHaveLength(1);
  expect(targetSifs[0]).toMatchObject({ numeroInstalacion: "P000042", revocadoEn: null });
  const active = await suite.db
    .select()
    .from(invoiceSeries)
    .where(eq(invoiceSeries.nodeId, target.nodeId))
    .orderBy(invoiceSeries.code);
  expect(active.map(({ code, purpose, nextNumber }) => ({ code, purpose, nextNumber }))).toEqual([
    { code: "A-P000042", purpose: "standard", nextNumber: 1 },
    { code: "FF-P000042", purpose: "full", nextNumber: 1 },
    { code: "R-P000042", purpose: "rectificative", nextNumber: 1 },
  ]);
  await suite.db
    .update(invoiceSeries)
    .set({ nextNumber: 41 })
    .where(eq(invoiceSeries.nodeId, target.nodeId));
  const before = await suite.db.select().from(invoiceSeries);
  const ledger = await suite.db.select().from(fiscalAllocations);
  await attempt("promote", run, { target, priorActivation: "committed" });
  expect(await suite.db.select().from(invoiceSeries)).toEqual(before);
  expect(await suite.db.select().from(fiscalAllocations)).toEqual(ledger);
  expect(await suite.db.select().from(fiscalReservations)).toEqual(reservation);
});
