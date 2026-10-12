import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { deployment, invoiceSeries, nodeRoles, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons, managementSessions } from "@waitron/identity";
import { locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { seedTenants, TENANT_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { registerSif } from "@waitron/fiscal-verifactu/src/registro-sif.js";
import { establishDormantAllocation } from "@waitron/fiscal-verifactu/src/standby-allocation.js";
import { activateAuthenticatedDormantAllocation } from "@waitron/fiscal-verifactu/src/allocation.js";
import type { AllocationContext } from "@waitron/fiscal-verifactu/src/allocation-envelope.js";
import {
  enrolPaperCustodian,
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperReservationForBlock,
  signPaperConsumptionForBlock,
} from "@waitron/fiscal-verifactu/src/paper-evidence.js";
import { withRecoveryKeyOperation } from "./operation-authentication.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { commitMirrorPromotionTx } from "./promote.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const ADMIN = "a0000000-0000-4000-8000-000000000001";
const primary = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const target = { ...primary, nodeId: TENANT_A.nodeId2 };
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const trust = enrolPaperCustodian("custodian", publicKey, paperCustodianFingerprint(publicKey))!;
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const candidate = {
  version: 1 as const,
  allocationId: "allocation-42",
  taxpayerNif: "89890001K",
  softwareId: "W1",
  environment: "preproduction" as const,
  installationIdentity: "P000042",
  source: "paper" as const,
  issuedAt: "2026-10-12T08:00:00.000Z",
  series: [
    { code: "A-P000042", purpose: "standard" },
    { code: "FF-P000042", purpose: "full" },
    { code: "R-P000042", purpose: "rectificative" },
  ],
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
const join = {
  eventId: "join-1",
  operatorId: ADMIN,
  sourceId: primary.nodeId,
  targetNodeId: target.nodeId,
  incidentEvidence: "master/join-1",
  reservedAt: "2026-10-12T09:00:00.000Z",
};
const reservation = {
  block,
  reservation: signPaperReservationForBlock(block, candidate.allocationId, join, privateKey),
};
const recoveryOperator = {
  kind: "recovery-key" as const,
  nodeId: target.nodeId,
  eventId: "takeover-1",
};
const approval = {
  version: 1 as const,
  eventId: "takeover-1",
  operatorId: recoveryOperator,
  sourceId: primary.nodeId,
  targetNodeId: target.nodeId,
  incidentEvidence: "master/takeover-1",
  oldMachineOffline: true,
  oldMachineAbsent: false,
  noParallelRecovery: true,
  confirmedAt: "2026-10-12T10:00:00.000Z",
};
const consumption = {
  version: 1 as const,
  custodianId: "custodian",
  blockDigest: createHash("sha256")
    .update(
      JSON.stringify([
        "waitron.paper-block",
        1,
        "custodian",
        "generation-1",
        "block-1",
        1,
        "venue-1",
        [
          [
            1,
            "allocation-42",
            "89890001K",
            "W1",
            "preproduction",
            "P000042",
            [
              ["A-P000042", "standard"],
              ["FF-P000042", "full"],
              ["R-P000042", "rectificative"],
            ],
            "paper",
            "2026-10-12T08:00:00.000Z",
          ],
        ],
      ]),
    )
    .digest("hex"),
  allocationId: "allocation-42",
  eventId: "takeover-1",
  operatorId: recoveryOperator,
  sourceId: primary.nodeId,
  targetNodeId: target.nodeId,
  incidentEvidence: "master/takeover-1",
  consumedAt: "2026-10-12T10:00:00.000Z",
};
const signedConsumption = {
  payload: consumption,
  signature: sign(
    null,
    Buffer.from(
      JSON.stringify([
        "waitron.paper-consumption",
        1,
        "custodian",
        consumption.blockDigest,
        "allocation-42",
        "takeover-1",
        { kind: "recovery-key", nodeId: target.nodeId, eventId: "takeover-1" },
        primary.nodeId,
        target.nodeId,
        "master/takeover-1",
        "2026-10-12T10:00:00.000Z",
      ]),
    ),
    privateKey,
  ).toString("base64url"),
};
const allocation = { ...candidate, reservationEvidence: { block, consumption: signedConsumption } };
const context: AllocationContext = {
  taxpayerNif: candidate.taxpayerNif,
  softwareId: "W1",
  environment: "preproduction",
  mode: "recovery",
  eventId: approval.eventId,
  operatorId: recoveryOperator,
  sourceId: primary.nodeId,
  targetNodeId: target.nodeId,
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
const binding = {
  module: "fiscal-verifactu",
  action: "promote",
  eventId: approval.eventId,
  sourceId: primary.nodeId,
  targetNodeId: target.nodeId,
};
const document = signedMembershipDoc(2, { signerNodeId: target.nodeId });

let recoveryKey: string;
async function promote(
  overrides: Partial<AllocationContext> = {},
  suppliedApproval: unknown = approval,
  suppliedAllocation: unknown = allocation,
) {
  return withRecoveryKeyOperation(
    { db: suite.db, nodeId: target.nodeId },
    binding,
    recoveryKey,
    async (tx, authority) => {
      const result = await activateAuthenticatedDormantAllocation(
        tx,
        target,
        join.eventId,
        suppliedAllocation,
        suppliedApproval,
        { ...context, ...overrides },
        authority,
      );
      if (overrides.priorActivation !== "committed")
        await commitMirrorPromotionTx(tx, target.nodeId, document);
      return result;
    },
  );
}
async function snapshot() {
  const rows: unknown[] = [];
  for (const table of [
    "registro_sif",
    "invoice_series",
    "cadenas",
    "fiscal_allocations",
    "fiscal_reservations",
    "node_roles",
    "node_membership",
  ])
    rows.push((await suite.db.execute(sql`select * from ${sql.identifier(table)}`)).rows);
  return rows;
}
beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await withTransaction(suite.db, (tx) =>
    registerSif(tx, {
      nodeId: primary.nodeId,
      nif: candidate.taxpayerNif,
      idSistemaInformatico: "W1",
    }),
  );
  await suite.db
    .insert(invoiceSeries)
    .values(bases.map((series) => ({ ...series, nodeId: primary.nodeId })));
  await suite.db
    .insert(nodeRoles)
    .values({ nodeId: target.nodeId, mode: "mirror", singletonRole: "secondary" });
  await withTransaction(suite.db, (tx) =>
    establishDormantAllocation(tx, primary, target, reservation, trust, {
      allocationId: candidate.allocationId,
      taxpayerNif: candidate.taxpayerNif,
      softwareId: "W1",
      environment: "preproduction",
      recipientVenueId: "venue-1",
      generationId: "generation-1",
      blockId: "block-1",
      ...join,
      currentRegisterConfirmed: true,
      reservationConfirmed: true,
      currentEntryState: "reserved",
      requiredBases: bases,
    }),
  );
  recoveryKey = await mintBreakGlassSecret(suite.db, target.nodeId);
});

describe("recovery-key fiscal attribution", () => {
  it("signs the recovery-key consumption without an account or a secret", () => {
    const signed = signPaperConsumptionForBlock(
      block,
      candidate.allocationId,
      {
        eventId: consumption.eventId,
        operatorId: recoveryOperator,
        sourceId: consumption.sourceId,
        targetNodeId: consumption.targetNodeId,
        incidentEvidence: consumption.incidentEvidence,
        consumedAt: consumption.consumedAt,
      },
      privateKey,
    );
    expect(signed).toEqual(signedConsumption);
  });
  it("activates all three purposes and the role atomically without a person or a session", async () => {
    const result = await promote();
    expect(result.series.map((s) => ({ code: s.code, purpose: s.purpose }))).toEqual(
      candidate.series,
    );
    const audit = (await suite.db.execute(sql`select approval, allocation from fiscal_allocations`))
      .rows;
    expect(audit).toHaveLength(1);
    const recorded = JSON.parse(audit[0]!.approval as string);
    expect(recorded).toEqual(approval);
    expect(recorded.operatorId).toEqual({
      kind: "recovery-key",
      nodeId: target.nodeId,
      eventId: "takeover-1",
    });
    expect(JSON.stringify(audit)).not.toContain(recoveryKey);
    expect(await suite.db.select().from(persons)).toEqual([]);
    expect(await suite.db.select().from(managementSessions)).toEqual([]);
    const [role] = await suite.db
      .select()
      .from(nodeRoles)
      .where(eq(nodeRoles.nodeId, target.nodeId));
    expect(role!.mode).toBe("primary");
    const before = await snapshot();
    expect(await promote({ priorActivation: "committed" })).toEqual(result);
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    ADMIN,
    { ...recoveryOperator, nodeId: primary.nodeId },
    { ...recoveryOperator, eventId: "another-event" },
  ])("refuses a substituted audit identity %# without writing", async (operatorId) => {
    const before = await snapshot();
    await expect(promote({ operatorId })).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reauthentication_required" },
    });
    expect(await snapshot()).toEqual(before);
  });

  it("requires the independently signed consumption to name the same recovery-key event", async () => {
    const wrong = {
      ...allocation,
      reservationEvidence: {
        block,
        consumption: signPaperConsumptionForBlock(
          block,
          candidate.allocationId,
          {
            eventId: approval.eventId,
            operatorId: ADMIN,
            sourceId: primary.nodeId,
            targetNodeId: target.nodeId,
            incidentEvidence: approval.incidentEvidence,
            consumedAt: approval.confirmedAt,
          },
          privateKey,
        ),
      },
    };
    const before = await snapshot();
    await expect(promote({}, approval, wrong)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_mismatch" },
    });
    expect(await snapshot()).toEqual(before);
  });

  it("rolls back fiscal activation when the membership write refuses", async () => {
    const before = await snapshot();
    await suite.db.execute(
      sql`create trigger refuse_chart before insert on node_membership begin select raise(abort, 'test chart refusal'); end`,
    );
    try {
      await expect(promote()).rejects.toThrow("test chart refusal");
      expect(await snapshot()).toEqual(before);
    } finally {
      await suite.db.execute(sql`drop trigger refuse_chart`);
    }
  });
});
