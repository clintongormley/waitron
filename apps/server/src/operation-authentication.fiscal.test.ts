import { seedFixtureSif as registerSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { deployment, invoiceSeries, nodeRoles, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, persons } from "@waitron/identity";
import { locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { seedTenants, TENANT_A } from "@waitron/fiscal-verifactu/test/fixtures.js";

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
import { withAuthenticatedOperation } from "./operation-authentication.js";
import { commitMirrorPromotionTx } from "./promote.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const ADMIN = "a0000000-0000-4000-8000-000000000001";
const OTHER = "a0000000-0000-4000-8000-000000000003";
const PASSWORD = "correct horse";
const HASH = hashPassword(PASSWORD);
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
const approval = {
  version: 1 as const,
  eventId: "takeover-1",
  operatorId: ADMIN,
  sourceId: primary.nodeId,
  targetNodeId: target.nodeId,
  incidentEvidence: "master/takeover-1",
  oldMachineOffline: true,
  oldMachineAbsent: false,
  noParallelRecovery: true,
  confirmedAt: "2026-10-12T10:00:00.000Z",
};
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
        sourceId: primary.nodeId,
        targetNodeId: target.nodeId,
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
  mode: "recovery",
  eventId: approval.eventId,
  operatorId: ADMIN,
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

async function promote(personId = ADMIN) {
  return withAuthenticatedOperation(
    { db: suite.db, credentialKeyRing: TOTP_KEY_RING },
    { binding, permission: "node.promote" },
    { personId, password: PASSWORD },
    (authority) =>
      withTransaction(suite.db, async (tx) => {
        const result = await activateAuthenticatedDormantAllocation(
          tx,
          target,
          join.eventId,
          allocation,
          approval,
          context,
          authority,
        );
        await commitMirrorPromotionTx(tx, target.nodeId, document);
        return result;
      }),
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
  await suite.db.insert(persons).values([
    { id: ADMIN, displayName: "Administrator", role: "admin", passwordHash: HASH },
    { id: OTHER, displayName: "Another administrator", role: "admin", passwordHash: HASH },
  ]);
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
});

describe("authenticated internal takeover plus the host's promotion transaction", () => {
  it("commits all three allocated purposes, the new identity, role and membership together", async () => {
    const before = await snapshot();
    const result = await promote();
    expect(result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual(candidate.series);
    const after = await snapshot();
    expect(after[4]).toEqual(before[4]);
    expect(
      (after[0] as Record<string, unknown>[]).find((row) => row.node_id === primary.nodeId),
    ).toEqual((before[0] as Record<string, unknown>[])[0]);
    const [role] = await suite.db
      .select()
      .from(nodeRoles)
      .where(eq(nodeRoles.nodeId, target.nodeId));
    expect(role).toMatchObject({ mode: "primary", singletonRole: "primary" });
    expect((after[3] as Record<string, unknown>[])[0]).toMatchObject({
      installation_identity: "P000042",
      event_key: "takeover-1",
    });
    expect(after[6]).toHaveLength(1);
  });

  it("rolls back every activation row and role if the host membership write is refused", async () => {
    await suite.db.execute(
      sql`create trigger refuse_chart before insert on node_membership begin select raise(abort, 'chart refused'); end`,
    );
    const before = await snapshot();
    try {
      await expect(promote()).rejects.toThrow("chart refused");
      expect(await snapshot()).toEqual(before);
      expect(allocation.reservationEvidence.consumption.payload.eventId).toBe("takeover-1");
    } finally {
      await suite.db.execute(sql`drop trigger refuse_chart`);
    }
  });

  it("refuses a different freshly authenticated administrator substituting for the signed consumption operator", async () => {
    const before = await snapshot();
    await expect(promote(OTHER)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reauthentication_required" },
    });
    expect(await snapshot()).toEqual(before);
  });
});
