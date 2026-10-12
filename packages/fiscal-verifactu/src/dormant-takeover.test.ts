import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { deployment, invoiceSeries, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { withOperationAuthority } from "@waitron/module";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A, TENANT_B } from "../test/fixtures.js";
import { registerSif } from "./registro-sif.js";
import { establishDormantAllocation } from "./standby-allocation.js";
import * as activation from "./allocation.js";
import { fiscalReservations } from "./schema/reservations.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { registroSif } from "./schema/sif.js";
import {
  enrolPaperCustodian,
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperReservationForBlock,
  signPaperConsumptionForBlock,
  type PaperAllocation,
} from "./paper-evidence.js";
import type {
  AllocationContext,
  FiscalAllocation,
  RecoveryApproval,
} from "./allocation-envelope.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
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
const candidate: PaperAllocation = {
  version: 1,
  allocationId: "allocation-42",
  taxpayerNif: "89890001K",
  softwareId: "W1",
  environment: "preproduction",
  installationIdentity: "P000042",
  source: "paper",
  issuedAt: "2026-10-12T08:00:00.000Z",
  series: [
    { code: "A-P000042", purpose: "standard" },
    { code: "FF-P000042", purpose: "full" },
    { code: "R-P000042", purpose: "rectificative" },
  ],
};
const join = {
  eventId: "join-1",
  operatorId: "join-admin",
  sourceId: primary.nodeId,
  targetNodeId: target.nodeId,
  incidentEvidence: "master/join-1",
  reservedAt: "2026-10-12T09:00:00.000Z",
};
function block(input = candidate) {
  return signPaperBlock(
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
}
const reservedBlock = block();
const reservation = {
  block: reservedBlock,
  reservation: signPaperReservationForBlock(
    reservedBlock,
    candidate.allocationId,
    join,
    privateKey,
  ),
};
const approval: RecoveryApproval = {
  version: 1,
  eventId: "takeover-1",
  operatorId: "takeover-admin",
  sourceId: primary.nodeId,
  targetNodeId: target.nodeId,
  oldMachineOffline: true,
  oldMachineAbsent: false,
  noParallelRecovery: true,
  confirmedAt: "2026-10-12T10:00:00.000Z",
  incidentEvidence: "master/takeover-1",
};
function consumed(
  input = candidate,
  permission = approval,
  proof = block(input),
): FiscalAllocation {
  return {
    ...input,
    reservationEvidence: {
      block: proof,
      consumption: signPaperConsumptionForBlock(
        proof,
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
  };
}
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
async function takeover(
  input: unknown = consumed(),
  permission: unknown = approval,
  expected = context,
  node = target,
  eventId = join.eventId,
) {
  return withTransaction(suite.db, (tx) =>
    activation.activateDormantAllocation(tx, node, eventId, input, permission, expected),
  );
}
async function rows(table: string) {
  return (await suite.db.execute(sql`select * from ${sql.identifier(table)}`)).rows;
}
async function activeRows() {
  return [
    await rows("registro_sif"),
    await rows("cadenas"),
    await rows("invoice_series"),
    await rows("fiscal_allocations"),
    await rows("contadores_instalacion"),
  ];
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
  await suite.db.insert(invoiceSeries).values(bases.map((b) => ({ ...b, nodeId: primary.nodeId })));
  await withTransaction(suite.db, (tx) =>
    establishDormantAllocation(tx, primary, target, reservation, trust, {
      allocationId: candidate.allocationId,
      taxpayerNif: candidate.taxpayerNif,
      softwareId: candidate.softwareId,
      environment: candidate.environment,
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

describe("a retained dormant reservation consumed for a separate takeover", () => {
  const binding = {
    module: "fiscal-verifactu",
    action: "promote",
    eventId: approval.eventId,
    sourceId: approval.sourceId,
    targetNodeId: target.nodeId,
  };
  async function authenticated(token: unknown, expected = context) {
    return withTransaction(suite.db, (tx) =>
      activation.activateAuthenticatedDormantAllocation(
        tx,
        target,
        join.eventId,
        consumed(),
        approval,
        expected,
        token,
      ),
    );
  }

  it("requires scoped host authority for the retained standby's takeover", async () => {
    await expect(
      withOperationAuthority(binding, approval.operatorId, (token) =>
        authenticated(token, { ...context, reauthentication: null }),
      ),
    ).resolves.toMatchObject({ activationEventId: "takeover-1", series: candidate.series });
    expect((await rows("registro_sif")).find((row) => row.node_id === target.nodeId)).toMatchObject(
      {
        numero_instalacion: "P000042",
        revocado_en: null,
      },
    );
  });

  it.each(["plain", "cloned", "operator", "join", "reservation"])(
    "rejects %s authority for a takeover without changing fiscal or reservation rows",
    async (kind) => {
      const before = await activeRows();
      const retained = await rows("fiscal_reservations");
      const scope = {
        ...binding,
        ...(kind === "join" ? { eventId: join.eventId } : {}),
        ...(kind === "reservation" ? { action: "reserve" } : {}),
      };
      const attempt =
        kind === "plain"
          ? authenticated({ ...binding, operatorId: approval.operatorId })
          : withOperationAuthority(
              scope,
              kind === "operator" ? "other-admin" : approval.operatorId,
              (token) => authenticated(kind === "cloned" ? structuredClone(token) : token),
            );
      await expect(attempt).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "reauthentication_required" },
      });
      expect(await activeRows()).toEqual(before);
      expect(await rows("fiscal_reservations")).toEqual(retained);
    },
  );

  it("activates the exact spare identity and all three purposes without changing the primary or reservation", async () => {
    const primarySif = await suite.db
      .select()
      .from(registroSif)
      .where(eq(registroSif.nodeId, primary.nodeId));
    const primarySeries = await suite.db
      .select()
      .from(invoiceSeries)
      .where(eq(invoiceSeries.nodeId, primary.nodeId));
    const retained = await rows("fiscal_reservations");
    const result = await takeover();
    expect(result).toMatchObject({ activationEventId: "takeover-1", series: candidate.series });
    const active = await rows("registro_sif");
    expect(active.find((row) => row.node_id === target.nodeId)).toMatchObject({
      numero_instalacion: "P000042",
      revocado_en: null,
    });
    expect(
      await suite.db.select().from(registroSif).where(eq(registroSif.nodeId, primary.nodeId)),
    ).toEqual(primarySif);
    expect(
      await suite.db.select().from(invoiceSeries).where(eq(invoiceSeries.nodeId, primary.nodeId)),
    ).toEqual(primarySeries);
    expect(await rows("fiscal_reservations")).toEqual(retained);
    const audit = await suite.db.select().from(fiscalAllocations);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      eventKey: "takeover-1",
      allocationKey: "allocation-42",
      nodeId: target.nodeId,
      bases,
    });
  });
  it("uses retained complete bases even when the caller proposes a subset", async () => {
    await expect(
      takeover(undefined, approval, {
        ...context,
        requiredBases: [{ code: "A", purpose: "standard" }],
      }),
    ).resolves.toMatchObject({ series: candidate.series });
  });
  it("replays a committed takeover without changing any active or retained rows", async () => {
    const first = await takeover();
    const before = await activeRows();
    const retained = await rows("fiscal_reservations");
    expect(
      await takeover(undefined, approval, { ...context, priorActivation: "committed" }),
    ).toEqual(first);
    expect(await activeRows()).toEqual(before);
    expect(await rows("fiscal_reservations")).toEqual(retained);
  });
  it.each([
    "missing",
    "join event",
    "source",
    "target",
    "identity",
    "allocation",
    "block",
    "purpose",
  ])("refuses a %s substitution before fiscal writes", async (kind) => {
    let permission = approval;
    let expected = context;
    let node = target;
    let eventId = join.eventId;
    let input = consumed();
    if (kind === "missing") eventId = "missing";
    if (kind === "join event") {
      permission = { ...approval, eventId: join.eventId };
      expected = {
        ...context,
        eventId: join.eventId,
        reauthentication: { operatorId: approval.operatorId, eventId: join.eventId },
      };
      input = consumed(candidate, permission);
    }
    if (kind === "source") {
      permission = { ...approval, sourceId: "other-primary" };
      expected = { ...context, sourceId: permission.sourceId };
      input = consumed(candidate, permission);
    }
    if (kind === "target") {
      node = { ...target, nodeId: TENANT_B.nodeId };
      permission = { ...approval, targetNodeId: node.nodeId };
      expected = { ...context, targetNodeId: node.nodeId };
      input = consumed(candidate, permission);
    }
    if (kind === "identity")
      input = consumed({
        ...candidate,
        installationIdentity: "P000043",
        series: bases.map((b) => ({ code: `${b.code}-P000043`, purpose: b.purpose })),
      });
    if (kind === "allocation") input = consumed({ ...candidate, allocationId: "allocation-43" });
    if (kind === "block")
      input = consumed(
        candidate,
        approval,
        signPaperBlock(
          {
            ...reservedBlock.payload,
            allocations: [
              candidate,
              {
                ...candidate,
                allocationId: "allocation-43",
                installationIdentity: "P000043",
                series: bases.map((b) => ({ code: `${b.code}-P000043`, purpose: b.purpose })),
              },
            ],
          },
          privateKey,
        ),
      );
    if (kind === "purpose")
      input = consumed({
        ...candidate,
        series: candidate.series.filter((s) => s.purpose !== "full"),
      });
    const before = await activeRows();
    await expect(takeover(input, permission, expected, node, eventId)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: kind === "missing" ? "reservation_missing" : "reservation_mismatch" },
    });
    expect(await activeRows()).toEqual(before);
  });
  it.each(["old machine", "parallel", "authentication", "outside", "unconsumed"])(
    "requires fresh %s confirmation",
    async (kind) => {
      const permission = {
        ...approval,
        ...(kind === "old machine"
          ? { oldMachineOffline: false }
          : kind === "parallel"
            ? { noParallelRecovery: false }
            : {}),
      };
      const expected = {
        ...context,
        ...(kind === "authentication" ? { reauthentication: null } : {}),
        authority: {
          ...(context.authority as Extract<AllocationContext["authority"], { kind: "paper" }>),
          ...(kind === "outside"
            ? { consumptionConfirmed: false }
            : kind === "unconsumed"
              ? { currentEntryState: "reserved" as const }
              : {}),
        },
      };
      const before = await activeRows();
      await expect(
        takeover(consumed(candidate, permission), permission, expected),
      ).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: {
          reason: {
            "old machine": "old_machine_active",
            parallel: "parallel_recovery",
            authentication: "reauthentication_required",
            outside: "outside_confirmation_missing",
            unconsumed: "reservation_not_consumed",
          }[kind],
        },
      });
      expect(await activeRows()).toEqual(before);
    },
  );
  it("rolls back activation if its final audit write is refused", async () => {
    await suite.db.execute(
      sql`create trigger refuse_takeover before insert on fiscal_allocations begin select raise(abort, 'takeover audit refused'); end`,
    );
    const before = await activeRows();
    try {
      await expect(takeover()).rejects.toThrow("takeover audit refused");
      expect(await activeRows()).toEqual(before);
    } finally {
      await suite.db.execute(sql`drop trigger refuse_takeover`);
    }
  });
  it("refuses another takeover event after a committed consumption", async () => {
    await takeover();
    const before = await activeRows();
    const permission = {
      ...approval,
      eventId: "takeover-2",
      incidentEvidence: "master/takeover-2",
    };
    const expected = {
      ...context,
      eventId: permission.eventId,
      incidentEvidence: permission.incidentEvidence,
      reauthentication: { operatorId: permission.operatorId, eventId: permission.eventId },
    };
    await expect(
      takeover(consumed(candidate, permission), permission, expected),
    ).rejects.toMatchObject({ code: "sif.allocation_invalid" });
    expect(await activeRows()).toEqual(before);
  });
  it("refuses consuming a spare's retained name through the ordinary recovery writer", async () => {
    const permission = { ...approval, targetNodeId: primary.nodeId };
    const expected = { ...context, targetNodeId: primary.nodeId };
    const before = await activeRows();
    await expect(
      withTransaction(suite.db, (tx) =>
        activation.activateAllocation(
          tx,
          primary,
          consumed(candidate, permission),
          permission,
          expected,
        ),
      ),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_mismatch" },
    });
    expect(await activeRows()).toEqual(before);
  });

  it.each(["SIF", "series"])(
    "refuses a spare that became active in another path (%s)",
    async (kind) => {
      if (kind === "SIF")
        await withTransaction(suite.db, (tx) =>
          registerSif(tx, {
            nodeId: target.nodeId,
            nif: candidate.taxpayerNif,
            idSistemaInformatico: "W1",
          }),
        );
      else await suite.db.insert(invoiceSeries).values({ nodeId: target.nodeId, code: "OTHER" });
      const before = await activeRows();
      await expect(takeover()).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "standby_already_active" },
      });
      expect(await activeRows()).toEqual(before);
    },
  );

  it("does not accept a current initial-setup mode for a retained standby", async () => {
    await expect(
      takeover(undefined, approval, { ...context, mode: "initial-setup" }),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_mismatch" },
    });
  });

  it("does not substitute emergency authority for a retained paper name", async () => {
    await expect(
      takeover(undefined, approval, { ...context, authority: { kind: "cloud" } }),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_mismatch" },
    });
  });

  it("refuses input that cannot be snapshotted before reading retained rows", async () => {
    await expect(takeover({ bad: () => undefined })).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_mismatch" },
    });
  });

  it("refuses an unsigned historical reservation even when its new consumption is signed", async () => {
    const other = {
      ...candidate,
      allocationId: "allocation-43",
      installationIdentity: "P000043",
      series: bases.map((b) => ({ code: `${b.code}-P000043`, purpose: b.purpose })),
    };
    const proof = block(other);
    const event = { ...join, eventId: "join-2" };
    await suite.db.insert(fiscalReservations).values({
      eventKey: event.eventId,
      allocationKey: other.allocationId,
      nodeId: target.nodeId,
      sourceNodeId: primary.nodeId,
      taxpayerNif: other.taxpayerNif,
      softwareId: other.softwareId,
      environment: other.environment,
      installationIdentity: other.installationIdentity,
      bases,
      evidence: {
        block: proof,
        reservation: {
          ...signPaperReservationForBlock(proof, other.allocationId, event, privateKey),
          signature: "A".repeat(86),
        },
      },
    });
    const before = await activeRows();
    await expect(
      takeover(consumed(other), approval, context, target, event.eventId),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_untrusted" },
    });
    expect(await activeRows()).toEqual(before);
  });

  it("refuses malformed stored evidence rather than activating from its row metadata", async () => {
    await suite.db.insert(fiscalReservations).values({
      eventKey: "join-2",
      allocationKey: "allocation-43",
      nodeId: target.nodeId,
      sourceNodeId: primary.nodeId,
      taxpayerNif: candidate.taxpayerNif,
      softwareId: candidate.softwareId,
      environment: candidate.environment,
      installationIdentity: "P000043",
      evidence: {},
      bases,
    });
    await expect(takeover(undefined, approval, context, target, "join-2")).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_untrusted" },
    });
  });

  it("refuses row identity metadata that differs from the signed retained reservation", async () => {
    const other = {
      ...candidate,
      allocationId: "allocation-43",
      installationIdentity: "P000043",
      series: bases.map((b) => ({ code: `${b.code}-P000043`, purpose: b.purpose })),
    };
    const proof = block(other);
    const event = { ...join, eventId: "join-2" };
    await suite.db.insert(fiscalReservations).values({
      eventKey: event.eventId,
      allocationKey: other.allocationId,
      nodeId: target.nodeId,
      sourceNodeId: primary.nodeId,
      taxpayerNif: other.taxpayerNif,
      softwareId: other.softwareId,
      environment: other.environment,
      installationIdentity: "P000044",
      bases,
      evidence: {
        block: proof,
        reservation: signPaperReservationForBlock(proof, other.allocationId, event, privateKey),
      },
    });
    const before = await activeRows();
    await expect(
      takeover(consumed(other), approval, context, target, event.eventId),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_mismatch" },
    });
    expect(await activeRows()).toEqual(before);
  });

  it("takes one consumption snapshot before awaited activation reads", async () => {
    const input = consumed();
    const expectedInput = structuredClone(input);
    await withTransaction(suite.db, async (tx) => {
      const select = tx.select.bind(tx);
      const spy = vi
        .spyOn(tx, "select")
        .mockImplementation((...args: Parameters<typeof tx.select>) => {
          const query = select(...args);
          const from = query.from.bind(query);
          vi.spyOn(query, "from").mockImplementation((table: Parameters<typeof query.from>[0]) => {
            if (table === fiscalAllocations)
              (
                input.reservationEvidence as { consumption: { payload: { operatorId: string } } }
              ).consumption.payload.operatorId = "caller-changed";
            return from(table);
          });
          return query;
        });
      try {
        await expect(
          activation.activateDormantAllocation(tx, target, join.eventId, input, approval, context),
        ).resolves.toMatchObject({ activationEventId: "takeover-1" });
      } finally {
        spy.mockRestore();
      }
    });
    const [audit] = await suite.db.select().from(fiscalAllocations);
    expect(
      (input.reservationEvidence as { consumption: { payload: { operatorId: string } } })
        .consumption.payload.operatorId,
    ).toBe("caller-changed");
    expect(audit!.allocation).toEqual(expectedInput);
  });

  it("requires current trusted evidence on a replay", async () => {
    await takeover();
    const before = await activeRows();
    await expect(
      takeover(undefined, approval, {
        ...context,
        priorActivation: "committed",
        authority: {
          ...(context.authority as Extract<AllocationContext["authority"], { kind: "paper" }>),
          trust: null,
        },
      }),
    ).rejects.toMatchObject({ code: "sif.allocation_invalid" });
    expect(await activeRows()).toEqual(before);
  });
});
