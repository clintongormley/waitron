import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { deployment, invoiceSeries, nodes, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { TENANT_A, TENANT_B, seedTenants } from "../test/fixtures.js";
import * as fiscal from "./index.js";
import { registroSif } from "./schema/sif.js";
import {
  enrolPaperCustodian,
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
} from "./paper-evidence.js";
import type {
  AllocationContext,
  FiscalAllocation,
  RecoveryApproval,
} from "./allocation-envelope.js";
import type { ProvisionedNode } from "@waitron/module";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node: ProvisionedNode = {
  nodeId: TENANT_A.nodeId,
  locationId: locationId(TENANT_A.locationId),
};
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const trust = enrolPaperCustodian("custodian", publicKey, paperCustodianFingerprint(publicKey))!;
const bases = [
  { code: "A", purpose: "standard" },
  { code: "R", purpose: "rectificative" },
];
const approval: RecoveryApproval = {
  version: 1,
  eventId: "event-42",
  operatorId: "administrator",
  sourceId: "backup-1",
  targetNodeId: node.nodeId,
  oldMachineOffline: true,
  oldMachineAbsent: false,
  noParallelRecovery: true,
  confirmedAt: "2026-10-12T09:00:00.000Z",
  incidentEvidence: "master/event-42",
};
const candidate = {
  version: 1 as const,
  allocationId: "allocation-42",
  taxpayerNif: "89890001K",
  softwareId: "W1",
  environment: "preproduction" as const,
  installationIdentity: "P000042",
  series: bases.map((b) => ({ code: `${b.code}-P000042`, purpose: b.purpose })),
  source: "paper" as const,
  issuedAt: "2026-10-12T08:00:00.000Z",
};
function signed(
  input: Omit<FiscalAllocation, "reservationEvidence"> = candidate,
  permission = approval,
): FiscalAllocation {
  const block = signPaperBlock(
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
  const consumption = signPaperConsumptionForBlock(
    block,
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
  );
  return { ...input, reservationEvidence: { block, consumption } };
}
const allocation = signed();
const context: AllocationContext = {
  taxpayerNif: candidate.taxpayerNif,
  softwareId: candidate.softwareId,
  environment: candidate.environment,
  mode: "recovery",
  eventId: approval.eventId,
  operatorId: approval.operatorId,
  sourceId: approval.sourceId,
  targetNodeId: approval.targetNodeId,
  incidentEvidence: approval.incidentEvidence,
  requiredBases: bases,
  reauthentication: { operatorId: approval.operatorId, eventId: approval.eventId },
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

type Validator = (
  tx: Transaction,
  node: ProvisionedNode,
  allocation: unknown,
  approval: unknown,
  context: AllocationContext,
) => Promise<unknown>;
async function validate(
  input: unknown = allocation,
  permission: unknown = approval,
  expected = context,
  target = node,
) {
  const api = fiscal as unknown as { validateAllocationForActivation?: Validator };
  expect(api.validateAllocationForActivation).toBeTypeOf("function");
  return withTransaction(suite.db, (tx) =>
    api.validateAllocationForActivation!(tx, target, input, permission, expected),
  );
}

beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await suite.db.insert(invoiceSeries).values(bases.map((b) => ({ ...b, nodeId: node.nodeId })));
});

describe("allocation activation checks inside the venue transaction", () => {
  it("returns the exact validated envelope without creating or retiring an identity or series", async () => {
    const before = await suite.db.select().from(invoiceSeries);
    expect(await validate()).toEqual({ ok: true, allocation, approval });
    expect(await suite.db.select().from(invoiceSeries)).toEqual(before);
    expect((await suite.db.execute(sql`select count(*) as n from registro_sif`)).rows).toEqual([
      { n: 0 },
    ]);
  });

  it("uses the stored taxpayer even when the caller context agrees with the wrong allocation", async () => {
    const other = signed({ ...candidate, taxpayerNif: "B12345678" });
    expect(
      fiscal.validateAllocationEnvelope(other, approval, {
        ...context,
        taxpayerNif: other.taxpayerNif,
      }).ok,
    ).toBe(true);
    expect(await validate(other, approval, { ...context, taxpayerNif: other.taxpayerNif })).toEqual(
      { ok: false, reason: "taxpayer_mismatch" },
    );
  });

  it("uses the stamped environment even when the caller context agrees with the wrong allocation", async () => {
    const other = signed({ ...candidate, environment: "production" });
    const outside = { ...context, environment: "production" as const };
    expect(fiscal.validateAllocationEnvelope(other, approval, outside).ok).toBe(true);
    expect(await validate(other, approval, outside)).toEqual({
      ok: false,
      reason: "environment_mismatch",
    });
  });

  it("refuses an unstamped database instead of falling back to a caller environment", async () => {
    await suite.db.delete(deployment);
    expect(await validate()).toEqual({ ok: false, reason: "environment_unstamped" });
  });

  it("uses the software's product identifier when no SIF exists", async () => {
    const other = signed({ ...candidate, softwareId: "ZZ" });
    const outside = { ...context, softwareId: "ZZ" };
    expect(fiscal.validateAllocationEnvelope(other, approval, outside).ok).toBe(true);
    expect(await validate(other, approval, outside)).toEqual({
      ok: false,
      reason: "software_mismatch",
    });
  });

  it("checks the actual stored node location", async () => {
    expect(
      await validate(allocation, approval, context, {
        ...node,
        locationId: locationId(TENANT_B.locationId),
      }),
    ).toEqual({ ok: false, reason: "node_mismatch" });
  });

  it("refuses a node absent from the database", async () => {
    await suite.db.delete(invoiceSeries);
    await suite.db.delete(nodes).where(eq(nodes.id, node.nodeId));
    expect(await validate()).toEqual({ ok: false, reason: "node_mismatch" });
  });

  it("checks the trusted event's target against the node being activated", async () => {
    expect(
      await validate(allocation, approval, { ...context, targetNodeId: TENANT_A.nodeId2 }),
    ).toEqual({ ok: false, reason: "node_mismatch" });
  });

  it("requires the actual configured series purposes despite a narrower caller list", async () => {
    expect(
      await validate(signed({ ...candidate, series: candidate.series.slice(0, 1) }), approval, {
        ...context,
        requiredBases: bases.slice(0, 1),
      }),
    ).toEqual({ ok: false, reason: "series_mismatch" });
  });

  it("checks the current stored bases instead of a stale caller snapshot", async () => {
    await suite.db
      .insert(invoiceSeries)
      .values({ nodeId: node.nodeId, code: "FF", purpose: "full" });
    expect(await validate()).toEqual({ ok: false, reason: "series_mismatch" });
  });

  it.each([null, new Date("2026-10-11T00:00:00Z")])(
    "refuses a colliding code on another node with retiredAt=%s",
    async (retiredAt) => {
      await suite.db
        .insert(invoiceSeries)
        .values({ nodeId: TENANT_A.nodeId2, code: "A-P000042", retiredAt });
      expect(await validate()).toEqual({ ok: false, reason: "series_collision" });
    },
  );

  it("refuses reopening a retired code on the same node", async () => {
    await suite.db.insert(invoiceSeries).values({
      nodeId: node.nodeId,
      code: "A-P000042",
      retiredAt: new Date("2026-10-11T00:00:00Z"),
    });
    expect(await validate()).toEqual({ ok: false, reason: "series_collision" });
  });

  it("permits a different identity suffix on another node", async () => {
    await suite.db.insert(invoiceSeries).values({ nodeId: TENANT_A.nodeId2, code: "A-P000043" });
    expect(await validate()).toEqual({ ok: true, allocation, approval });
  });

  it("does not accept caller bases for a recovery with no live series", async () => {
    await suite.db.delete(invoiceSeries);
    expect(await validate()).toEqual({ ok: false, reason: "series_mismatch" });
  });

  it("refuses a missing stored taxpayer", async () => {
    await suite.db.execute(sql`delete from tenants`);
    expect(await validate()).toEqual({ ok: false, reason: "taxpayer_mismatch" });
  });

  it.each([null, new Date("2026-10-11T00:00:00Z")])(
    "refuses a locally retained identity with revocadoEn=%s",
    async (retired) => {
      await suite.db.execute(
        sql`insert into registro_sif (id, node_id, nif, id_sistema_informatico, numero_instalacion, registrado_en, revocado_en) values (${"retained-sif"}, ${TENANT_A.nodeId2}, ${candidate.taxpayerNif}, ${candidate.softwareId}, ${candidate.installationIdentity}, ${new Date("2026-10-10T00:00:00Z").getTime()}, ${retired?.getTime() ?? null})`,
      );
      expect(await validate()).toEqual({ ok: false, reason: "installation_used" });
    },
  );

  it("does not confuse a retained identity from another software scope with this allocation", async () => {
    await suite.db.execute(
      sql`insert into registro_sif (id, node_id, nif, id_sistema_informatico, numero_instalacion, registrado_en) values (${"other-software"}, ${TENANT_A.nodeId2}, ${candidate.taxpayerNif}, ${"ZZ"}, ${candidate.installationIdentity}, ${new Date("2026-10-10T00:00:00Z").getTime()})`,
    );
    expect(await validate()).toEqual({ ok: true, allocation, approval });
  });

  it("does not confuse another taxpayer's retained identity with this allocation", async () => {
    await suite.db.execute(
      sql`insert into registro_sif (id, node_id, nif, id_sistema_informatico, numero_instalacion, registrado_en) values (${"other-taxpayer"}, ${TENANT_A.nodeId2}, ${"B12345678"}, ${candidate.softwareId}, ${candidate.installationIdentity}, ${new Date("2026-10-10T00:00:00Z").getTime()})`,
    );
    expect(await validate()).toEqual({ ok: true, allocation, approval });
  });

  it.each([
    null,
    [],
    { ...allocation, installationIdentity: "P000000" },
    { ...allocation, installationIdentity: "P".repeat(28) },
  ])("refuses a malformed allocation %j", async (input) => {
    expect(await validate(input)).toEqual({ ok: false, reason: "malformed_allocation" });
  });

  it("validates a newly drawn emergency allocation with the clock behind the backup", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
      const draw = fiscal.drawEmergencyIdentity();
      const emergency: FiscalAllocation = {
        ...allocation,
        allocationId: "emergency-event-42",
        installationIdentity: draw.identity,
        source: "emergency",
        series: bases.map((base) => ({
          code: `${base.code}-${draw.identity}`,
          purpose: base.purpose,
        })),
        reservationEvidence: { checksum: draw.checksum },
      };
      expect(
        await validate(emergency, approval, {
          ...context,
          authority: {
            kind: "emergency",
            draw,
            knownIdentities: [],
            incidentRecorded: true,
            uncertaintyRecorded: false,
          },
        }),
      ).toEqual({ ok: true, allocation: emergency, approval });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads bases changed earlier in the same transaction", async () => {
    const api = fiscal as unknown as { validateAllocationForActivation: Validator };
    const result = await withTransaction(suite.db, async (tx) => {
      await tx.insert(invoiceSeries).values({ nodeId: node.nodeId, code: "FF", purpose: "full" });
      return api.validateAllocationForActivation(tx, node, allocation, approval, context);
    });
    expect(result).toEqual({ ok: false, reason: "series_mismatch" });
  });

  it("uses a live SIF's stored software scope instead of a caller snapshot", async () => {
    await suite.db.insert(registroSif).values({
      nodeId: node.nodeId,
      nif: candidate.taxpayerNif,
      idSistemaInformatico: "ZZ",
      numeroInstalacion: 99,
    });
    expect(await validate()).toEqual({ ok: false, reason: "software_mismatch" });
  });

  it("accepts the existing live SIF's scope and retains its whole row", async () => {
    await suite.db.insert(registroSif).values({
      nodeId: node.nodeId,
      nif: candidate.taxpayerNif,
      idSistemaInformatico: candidate.softwareId,
      numeroInstalacion: 99,
    });
    const before = await suite.db.select().from(registroSif);
    expect(await validate(allocation, approval, { ...context, softwareId: "ZZ" })).toEqual({
      ok: true,
      allocation,
      approval,
    });
    expect(await suite.db.select().from(registroSif)).toEqual(before);
  });

  it("refuses a preproduction allocation on a database stamped production", async () => {
    await suite.db.update(deployment).set({ environment: "production" });
    expect(await validate()).toEqual({ ok: false, reason: "environment_mismatch" });
  });

  it("uses explicitly authorised initial setup bases before any series exists", async () => {
    await suite.db.delete(invoiceSeries);
    const setupCandidate = {
      ...candidate,
      allocationId: "initial-1",
      installationIdentity: "S000001",
      source: "initial-paper" as const,
      series: bases.map((base) => ({ code: `${base.code}-S000001`, purpose: base.purpose })),
    };
    const setupApproval = { ...approval, oldMachineOffline: false, oldMachineAbsent: true };
    const setupAllocation = signed(setupCandidate, setupApproval);
    expect(
      await validate(setupAllocation, setupApproval, { ...context, mode: "initial-setup" }),
    ).toEqual({ ok: true, allocation: setupAllocation, approval: setupApproval });
  });

  it("preserves the envelope refusal for an abandoned outside reservation", async () => {
    expect(
      await validate(allocation, approval, {
        ...context,
        authority: { ...context.authority, currentEntryState: "abandoned" },
      } as AllocationContext),
    ).toEqual({ ok: false, reason: "reservation_abandoned" });
  });
});
