import { seedFixtureSif } from "../test/sif-fixture.js";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  deployment,
  invoiceSeries,
  nodes,
  openVenueDatabase,
  withTransaction,
  type Database,
  type Transaction,
  type VenueDatabase,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { TENANT_A, TENANT_B, seedTenants, seedSoldRegistro } from "../test/fixtures.js";
import * as fiscal from "./index.js";
import { registroSif } from "./schema/sif.js";
import { activateAllocation } from "./allocation.js";
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
import { withOperationAuthority, type ProvisionedNode } from "@waitron/module";
import * as activation from "./allocation.js";

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

describe("allocation activation with host-issued operator authority", () => {
  const binding = {
    module: "fiscal-verifactu",
    action: "restore",
    eventId: approval.eventId,
    sourceId: approval.sourceId,
    targetNodeId: node.nodeId,
  };
  async function authenticated(
    token: unknown,
    expected = context,
    action = "restore",
    input = allocation,
    permission = approval,
  ) {
    return withTransaction(suite.db, (tx) =>
      activation.activateAuthenticatedAllocation(
        tx,
        node,
        input,
        permission,
        expected,
        token,
        action,
      ),
    );
  }

  it("activates after an event-bound verified operator, independently of a plain reauthentication claim", async () => {
    await expect(
      withOperationAuthority(binding, approval.operatorId, (token) =>
        authenticated(token, { ...context, reauthentication: null }),
      ),
    ).resolves.toMatchObject({ activationEventId: "event-42" });
    expect(
      (await suite.db.execute(sql`select installation_identity from fiscal_allocations`)).rows,
    ).toEqual([{ installation_identity: "P000042" }]);
  });

  it.each([
    "plain",
    "cloned",
    "revoked",
    "operator",
    "module",
    "action",
    "event",
    "source",
    "target",
  ])("refuses %s authority before changing the active identity or series", async (kind) => {
    const before = await suite.db.select().from(invoiceSeries);
    const scope = {
      ...binding,
      ...(kind === "module" ? { module: "other" } : {}),
      ...(kind === "action" ? { action: "reserve" } : {}),
      ...(kind === "event" ? { eventId: "other" } : {}),
      ...(kind === "source" ? { sourceId: "other" } : {}),
      ...(kind === "target" ? { targetNodeId: "other" } : {}),
    };
    const operator = kind === "operator" ? "other-admin" : approval.operatorId;
    const attempt =
      kind === "plain"
        ? authenticated({ ...scope, operatorId: operator })
        : kind === "revoked"
          ? withOperationAuthority(scope, operator, async (token) => token).then(authenticated)
          : withOperationAuthority(scope, operator, (token) =>
              authenticated(kind === "cloned" ? structuredClone(token) : token),
            );
    await expect(attempt).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reauthentication_required" },
    });
    expect(await suite.db.select().from(invoiceSeries)).toEqual(before);
    expect((await suite.db.execute(sql`select count(*) as n from registro_sif`)).rows).toEqual([
      { n: 0 },
    ]);
    expect(
      (await suite.db.execute(sql`select count(*) as n from fiscal_allocations`)).rows,
    ).toEqual([{ n: 0 }]);
  });

  it("refuses even authentic reservation authority being used as activation authority", async () => {
    await expect(
      withOperationAuthority({ ...binding, action: "reserve" }, approval.operatorId, (token) =>
        authenticated(token, context, "reserve"),
      ),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reauthentication_required" },
    });
  });

  it("accepts setup authority only for an initial setup with independently consumed initial allocation", async () => {
    const permission = { ...approval, oldMachineOffline: false, oldMachineAbsent: true };
    const initial = signed(
      {
        ...candidate,
        source: "initial-paper",
        installationIdentity: "S000042",
        series: [
          { code: "A-S000042", purpose: "standard" },
          { code: "R-S000042", purpose: "rectificative" },
        ],
      },
      permission,
    );
    await expect(
      withOperationAuthority({ ...binding, action: "setup" }, approval.operatorId, (token) =>
        authenticated(
          token,
          { ...context, mode: "initial-setup", reauthentication: null },
          "setup",
          initial,
          permission,
        ),
      ),
    ).resolves.toMatchObject({ activationEventId: "event-42" });
  });

  it.each(["setup for recovery", "recovery for setup"])(
    "refuses %s even when its authority is authentic",
    async (kind) => {
      const action = kind === "setup for recovery" ? "setup" : "restore";
      const expected =
        kind === "setup for recovery" ? context : { ...context, mode: "initial-setup" as const };
      await expect(
        withOperationAuthority({ ...binding, action }, approval.operatorId, (token) =>
          authenticated(token, expected, action),
        ),
      ).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "reauthentication_required" },
      });
    },
  );

  it.each(["fresh", "replay"])(
    "requires authority to remain valid after a paused %s read",
    async (kind) => {
      if (kind === "replay")
        await withOperationAuthority(binding, approval.operatorId, authenticated);
      const before = await suite.db.execute(sql`select * from registro_sif`);
      const beforeSeries = await suite.db.select().from(invoiceSeries);
      const beforeAudit = await suite.db.execute(sql`select * from fiscal_allocations`);
      await withTransaction(suite.db, async (tx) => {
        let readSeen!: () => void;
        const paused = new Promise<void>((resolve) => {
          readSeen = resolve;
        });
        let resume!: () => void;
        const resumed = new Promise<void>((resolve) => {
          resume = resolve;
        });
        const select = tx.select.bind(tx);
        const spy = vi
          .spyOn(tx, "select")
          .mockImplementation((...args: Parameters<typeof tx.select>) => {
            const query = select(...args);
            const from = query.from.bind(query);
            vi.spyOn(query, "from").mockImplementation(
              (table: Parameters<typeof query.from>[0]) => {
                const result = from(table);
                if (table === nodes) {
                  const where = result.where.bind(result);
                  vi.spyOn(result, "where").mockImplementation(
                    (...args: Parameters<typeof result.where>) => {
                      const rows = where(...args);
                      const then = rows.then.bind(rows);
                      vi.spyOn(rows, "then").mockImplementation((async (resolve, reject) => {
                        readSeen();
                        await resumed;
                        return then(resolve, reject);
                      }) as typeof rows.then);
                      return rows;
                    },
                  );
                }
                return result;
              },
            );
            return query;
          });
        let pending!: ReturnType<typeof activation.activateAuthenticatedAllocation>;
        try {
          await withOperationAuthority(binding, approval.operatorId, async (token) => {
            pending = activation.activateAuthenticatedAllocation(
              tx,
              node,
              allocation,
              approval,
              { ...context, priorActivation: kind === "replay" ? "committed" : "none" },
              token,
              "restore",
            );
            await paused;
          });
          resume();
          await expect(pending).rejects.toMatchObject({
            code: "sif.allocation_invalid",
            params: { reason: "reauthentication_required" },
          });
        } finally {
          resume();
          spy.mockRestore();
        }
      });
      expect(await suite.db.execute(sql`select * from registro_sif`)).toEqual(before);
      expect(await suite.db.select().from(invoiceSeries)).toEqual(beforeSeries);
      expect(await suite.db.execute(sql`select * from fiscal_allocations`)).toEqual(beforeAudit);
    },
  );
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
      numeroInstalacion: "99",
    });
    expect(await validate()).toEqual({ ok: false, reason: "software_mismatch" });
  });

  it("accepts the existing live SIF's scope and retains its whole row", async () => {
    await suite.db.insert(registroSif).values({
      nodeId: node.nodeId,
      nif: candidate.taxpayerNif,
      idSistemaInformatico: candidate.softwareId,
      numeroInstalacion: "99",
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

async function activate(
  expected = context,
  input: unknown = allocation,
  permission: unknown = approval,
) {
  return withTransaction(suite.db, (tx) =>
    activateAllocation(tx, node, input, permission, expected),
  );
}
async function activationSnapshot() {
  const tables = ["registro_sif", "invoice_series", "cadenas", "fiscal_allocations"];
  const snapshot: Record<string, unknown> = {};
  for (const name of tables) {
    if (!/^[a-z_]+$/.test(name)) throw new Error("invalid probe table");
    snapshot[name] = (
      await suite.db.execute(sql.raw(`select * from "${name}" order by rowid`))
    ).rows;
  }
  return snapshot;
}

describe("atomic allocation activation", () => {
  it("commits the exact outside identity, complete series and audit result together", async () => {
    const result = await activate();
    expect(result.activationEventId).toBe("event-42");
    expect(result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
      { code: "A-P000042", purpose: "standard" },
      { code: "R-P000042", purpose: "rectificative" },
    ]);
    expect(
      (
        await suite.db.execute(
          sql`select id, numero_instalacion from registro_sif where revocado_en is null`,
        )
      ).rows,
    ).toEqual([{ id: result.sifId, numero_instalacion: "P000042" }]);
    expect(
      (await suite.db.select().from(invoiceSeries))
        .filter((s) => s.retiredAt === null)
        .map((s) => s.id)
        .sort(),
    ).toEqual(result.series.map((s) => s.id).sort());
    expect(
      (
        await suite.db.execute(
          sql`select node_id, ultimo_registro_id, ultima_huella, secuencia from cadenas`,
        )
      ).rows,
    ).toEqual([
      { node_id: node.nodeId, ultimo_registro_id: null, ultima_huella: null, secuencia: 0 },
    ]);
    expect(
      (
        await suite.db.execute(
          sql`select event_key, allocation_key, installation_identity, result from fiscal_allocations`,
        )
      ).rows,
    ).toEqual([
      {
        event_key: "event-42",
        allocation_key: "allocation-42",
        installation_identity: "P000042",
        result: JSON.stringify(result),
      },
    ]);
  });

  it("replays the committed event after outside confirmation without changing any row", async () => {
    const first = await activate();
    const before = await activationSnapshot();
    expect(await activate({ ...context, priorActivation: "committed" })).toEqual(first);
    expect(await activationSnapshot()).toEqual(before);
  });

  it("refuses an uncertain outside event even when the local result exists", async () => {
    await activate();
    const before = await activationSnapshot();
    await expect(activate({ ...context, priorActivation: "uncertain" })).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "uncertain_prior_activation" },
    });
    expect(await activationSnapshot()).toEqual(before);
  });

  it("cannot reuse a consumed allocation for a different authorised event", async () => {
    await activate();
    const otherApproval = {
      ...approval,
      eventId: "another-event",
      incidentEvidence: "master/another-event",
    };
    const otherContext = {
      ...context,
      eventId: otherApproval.eventId,
      incidentEvidence: otherApproval.incidentEvidence,
      reauthentication: { operatorId: otherApproval.operatorId, eventId: otherApproval.eventId },
    };
    const before = await activationSnapshot();
    await expect(
      activate(otherContext, signed(candidate, otherApproval), otherApproval),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "allocation_consumed" },
    });
    expect(await activationSnapshot()).toEqual(before);
  });

  it("does not replay a stored event without independently trusted paper evidence", async () => {
    await activate();
    const before = await activationSnapshot();
    await expect(
      activate({
        ...context,
        priorActivation: "committed",
        authority: { ...context.authority, trust: null },
      } as AllocationContext),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_untrusted" },
    });
    expect(await activationSnapshot()).toEqual(before);
  });

  it.each([
    ["retire SIF", "before update on registro_sif"],
    ["insert SIF", "before insert on registro_sif"],
    ["reset chain", "before insert on cadenas"],
    ["retire series", "before update on invoice_series"],
    ["insert series", "before insert on invoice_series when new.code = 'R-P000042'"],
    ["audit result", "before insert on fiscal_allocations"],
  ])("rolls back every local write when %s is refused", async (_step, timing) => {
    await suite.db.insert(registroSif).values({
      nodeId: node.nodeId,
      nif: candidate.taxpayerNif,
      idSistemaInformatico: candidate.softwareId,
      numeroInstalacion: "99",
    });
    const before = await activationSnapshot();
    await suite.db.execute(
      sql.raw(
        `create trigger allocation_fail ${timing} begin select raise(abort, 'activation probe'); end`,
      ),
    );
    try {
      await expect(activate()).rejects.toThrow("activation probe");
      expect(await activationSnapshot()).toEqual(before);
    } finally {
      await suite.db.execute(sql`drop trigger allocation_fail`);
    }
  });
});

describe("activation replay identity integrity", () => {
  it.each([
    ["numero_instalacion", "P000043"],
    ["nif", "B12345678"],
    ["id_sistema_informatico", "ZZ"],
  ])("refuses replay after the retained SIF %s changes", async (column, value) => {
    const first = await activate();
    if (!/^[a-z_]+$/.test(column)) throw new Error("invalid probe column");
    await suite.db.execute(
      sql`update registro_sif set ${sql.raw(column)} = ${value} where id = ${first.sifId}`,
    );
    const before = await activationSnapshot();
    await expect(activate({ ...context, priorActivation: "committed" })).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "activation_superseded" },
    });
    expect(await activationSnapshot()).toEqual(before);
  });
});

describe("replay scope and history", () => {
  it("requires outside commitment rather than treating a restored event key as permission", async () => {
    await activate();
    const before = await activationSnapshot();
    await expect(activate()).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
    expect(await activationSnapshot()).toEqual(before);
  });

  it("checks the stored node location again on replay", async () => {
    await activate();
    await suite.db
      .update(nodes)
      .set({ locationId: TENANT_B.locationId })
      .where(eq(nodes.id, node.nodeId));
    await expect(activate({ ...context, priorActivation: "committed" })).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "node_mismatch" },
    });
  });

  it("refuses a different trusted target on replay", async () => {
    await activate();
    await expect(
      activate({ ...context, priorActivation: "committed", targetNodeId: TENANT_A.nodeId2 }),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "node_mismatch" },
    });
  });

  it("checks the current taxpayer on replay", async () => {
    await activate();
    await suite.db.execute(sql`update tenants set tax_id = ${"B12345678"}`);
    await expect(activate({ ...context, priorActivation: "committed" })).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "taxpayer_mismatch" },
    });
  });

  it("checks the environment stamp on replay", async () => {
    await activate();
    await suite.db.update(deployment).set({ environment: "production" });
    await expect(activate({ ...context, priorActivation: "committed" })).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "environment_mismatch" },
    });
  });

  it("refuses replay without an environment stamp", async () => {
    await activate();
    await suite.db.delete(deployment);
    await expect(activate({ ...context, priorActivation: "committed" })).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "environment_unstamped" },
    });
  });

  it("refuses a different valid signed allocation for a committed event", async () => {
    await activate();
    const other = signed({ ...candidate, allocationId: "other-allocation" });
    expect(fiscal.validateAllocationEnvelope(other, approval, context).ok).toBe(true);
    await expect(
      activate({ ...context, priorActivation: "committed" }, other),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "event_mismatch" },
    });
  });

  it("refuses a different valid approval for a committed event", async () => {
    await activate();
    const changed = { ...approval, confirmedAt: "2026-10-12T09:01:00.000Z" };
    const other = allocation;
    expect(fiscal.validateAllocationEnvelope(other, changed, context).ok).toBe(true);
    await expect(
      activate({ ...context, priorActivation: "committed" }, other, changed),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "event_mismatch" },
    });
  });

  it("does not reactivate a retired SIF through replay", async () => {
    const first = await activate();
    await suite.db
      .update(registroSif)
      .set({ revocadoEn: new Date("2026-10-12T10:00:00.000Z") })
      .where(eq(registroSif.id, first.sifId));
    await expect(activate({ ...context, priorActivation: "committed" })).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "activation_superseded" },
    });
  });

  it("does not replay a partial live series set", async () => {
    const first = await activate();
    await suite.db
      .update(invoiceSeries)
      .set({ retiredAt: new Date("2026-10-12T10:00:00.000Z") })
      .where(eq(invoiceSeries.id, first.series[1]!.id));
    await expect(activate({ ...context, priorActivation: "committed" })).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "activation_superseded" },
    });
  });

  it("starts an empty chain while retaining its existing sequence", async () => {
    await suite.db.execute(
      sql`insert into cadenas(node_id, secuencia, actualizado_en) values(${node.nodeId}, 13, ${new Date("2026-10-12T08:00:00.000Z").getTime()})`,
    );
    await activate();
    expect(
      (
        await suite.db.execute(
          sql`select ultimo_registro_id, ultima_huella, secuencia from cadenas where node_id=${node.nodeId}`,
        )
      ).rows,
    ).toEqual([{ ultimo_registro_id: null, ultima_huella: null, secuencia: 13 }]);
  });

  it("refuses a malformed new activation without changing any row", async () => {
    const before = await activationSnapshot();
    await expect(activate(context, null)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "malformed_allocation" },
    });
    expect(await activationSnapshot()).toEqual(before);
  });

  it("retains audit evidence against both update and deletion", async () => {
    await activate();
    const before = await activationSnapshot();
    await expect(
      withTransaction(suite.db, (tx) =>
        tx.execute(sql`update fiscal_allocations set allocation_key=${"rewritten"}`),
      ),
    ).rejects.toThrow("fiscal_allocations is append-only");
    await expect(
      withTransaction(suite.db, (tx) => tx.execute(sql`delete from fiscal_allocations`)),
    ).rejects.toThrow("fiscal_allocations is append-only");
    expect(await activationSnapshot()).toEqual(before);
  });
});

describe("activation over retained fiscal rows", () => {
  it("retains the old record and identity while retiring its series and resetting only the head", async () => {
    const old = await withTransaction(suite.db, (tx) =>
      seedFixtureSif(tx, {
        nodeId: node.nodeId,
        nif: candidate.taxpayerNif,
        idSistemaInformatico: candidate.softwareId,
      }),
    );
    await seedSoldRegistro(suite.db, {
      locationId: node.locationId,
      nodeId: node.nodeId,
      sifId: old.id,
      nif: candidate.taxpayerNif,
      secuencia: 13,
      huella: "A".repeat(64),
      entorno: "preproduction",
    });
    const before = (await suite.db.execute(sql`select * from registros_facturacion`)).rows;
    const oldSeries = await suite.db.select().from(invoiceSeries);
    const input = signed({
      ...candidate,
      series: [...candidate.series, { code: "S13-P000042", purpose: "standard" }],
    });
    const result = await activate(context, input);
    expect(result.sifId).not.toBe(old.id);
    expect((await suite.db.execute(sql`select * from registros_facturacion`)).rows).toEqual(before);
    const oldRow = (
      await suite.db.select().from(registroSif).where(eq(registroSif.id, old.id))
    )[0]!;
    expect(oldRow).toEqual({ ...old, revocadoEn: expect.any(Date) });
    const afterSeries = await suite.db.select().from(invoiceSeries);
    for (const retained of oldSeries)
      expect(afterSeries.find((s) => s.id === retained.id)).toEqual({
        ...retained,
        retiredAt: expect.any(Date),
      });
    expect(
      (
        await suite.db.execute(
          sql`select ultimo_registro_id, ultima_huella, secuencia from cadenas where node_id=${node.nodeId}`,
        )
      ).rows,
    ).toEqual([{ ultimo_registro_id: null, ultima_huella: null, secuencia: 13 }]);
    expect(result.series.map((s) => ({ code: s.code, purpose: s.purpose }))).toEqual([
      { code: "A-P000042", purpose: "standard" },
      { code: "R-P000042", purpose: "rectificative" },
      { code: "S13-P000042", purpose: "standard" },
    ]);
  });
});

function emergencyInput() {
  const draw = fiscal.drawEmergencyIdentity();
  const input: FiscalAllocation = {
    ...candidate,
    allocationId: `emergency-${draw.identity}`,
    source: "emergency",
    installationIdentity: draw.identity,
    series: bases.map((base) => ({ code: `${base.code}-${draw.identity}`, purpose: base.purpose })),
    reservationEvidence: { checksum: draw.checksum },
  };
  const expected: AllocationContext = {
    ...context,
    authority: {
      kind: "emergency",
      draw,
      knownIdentities: [],
      incidentRecorded: true,
      uncertaintyRecorded: false,
    },
  };
  return { input, expected, draw };
}

async function inRestoredCopy(body: (db: Database) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "waitron-allocation-replay-"));
  let opened: VenueDatabase | undefined;
  try {
    await suite.db.archiveTo(join(directory, "venue.db"));
    opened = await openVenueDatabase(directory);
    await opened.close();
    opened = undefined;
    opened = await openVenueDatabase(directory);
    await body(opened.venue);
  } finally {
    if (opened !== undefined) await opened.close();
    await rm(directory, { recursive: true, force: true });
  }
}

async function rawActivationSnapshot(db: Database) {
  const result: Record<string, unknown> = {};
  for (const table of ["registro_sif", "invoice_series", "cadenas", "fiscal_allocations"]) {
    if (!/^[a-z_]+$/.test(table)) throw new Error("invalid snapshot table");
    result[table] = (await db.execute(sql.raw(`select * from "${table}" order by rowid`))).rows;
  }
  return result;
}

describe("emergency activation after reopening a restored database", () => {
  it("returns the committed result from each of two restored copies without the original random draw", async () => {
    const { input, expected, draw } = emergencyInput();
    const first = await activate(expected, input);
    const replay: AllocationContext = {
      ...expected,
      priorActivation: "committed",
      authority: {
        kind: "emergency",
        draw: structuredClone(draw),
        knownIdentities: [draw.identity],
        incidentRecorded: true,
        uncertaintyRecorded: false,
      },
    };
    for (let copy = 0; copy < 2; copy++) {
      await inRestoredCopy(async (db) => {
        const before = await rawActivationSnapshot(db);
        expect(
          await withTransaction(db, (tx) => activateAllocation(tx, node, input, approval, replay)),
        ).toEqual(first);
        expect(await rawActivationSnapshot(db)).toEqual(before);
      });
    }
  });

  it("refuses a reconstructed draw for a new activation", async () => {
    const { input, expected, draw } = emergencyInput();
    const reconstructed: AllocationContext = {
      ...expected,
      authority: {
        kind: "emergency",
        draw: structuredClone(draw),
        knownIdentities: [],
        incidentRecorded: true,
        uncertaintyRecorded: false,
      },
    };
    const before = await activationSnapshot();
    await expect(activate(reconstructed, input)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "emergency_draw_untrusted" },
    });
    expect(await activationSnapshot()).toEqual(before);
  });

  it("does not replay the committed emergency result without renewed outside confirmation", async () => {
    const { input, expected, draw } = emergencyInput();
    await activate(expected, input);
    const replay: AllocationContext = {
      ...expected,
      priorActivation: "committed",
      authority: {
        kind: "emergency",
        draw: structuredClone(draw),
        knownIdentities: [],
        incidentRecorded: false,
        uncertaintyRecorded: false,
      },
    };
    const before = await activationSnapshot();
    await expect(activate(replay, input)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
    expect(await activationSnapshot()).toEqual(before);
  });

  it("cannot change the complete emergency identity set while replaying an event", async () => {
    const { input, expected } = emergencyInput();
    await activate(expected, input);
    const other = emergencyInput();
    const before = await activationSnapshot();
    await expect(
      activate({ ...other.expected, priorActivation: "committed" }, other.input),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "event_mismatch" },
    });
    expect(await activationSnapshot()).toEqual(before);
  });
});

describe("independent attempts from the same old backup", () => {
  it("cannot reuse an outside-committed emergency event when the local result is absent", async () => {
    const { input, expected, draw } = emergencyInput();
    const replay: AllocationContext = {
      ...expected,
      priorActivation: "committed",
      authority: {
        kind: "emergency",
        draw: structuredClone(draw),
        knownIdentities: [draw.identity],
        incidentRecorded: true,
        uncertaintyRecorded: false,
      },
    };
    for (let copy = 0; copy < 2; copy++) {
      await inRestoredCopy(async (db) => {
        const before = await rawActivationSnapshot(db);
        await expect(
          withTransaction(db, (tx) => activateAllocation(tx, node, input, approval, replay)),
        ).rejects.toMatchObject({
          code: "sif.allocation_invalid",
          params: { reason: "prior_activation_requires_replay" },
        });
        expect(await rawActivationSnapshot(db)).toEqual(before);
      });
    }
  });

  it("uses different outside incident events and fresh complete identities for two restored copies", async () => {
    const known: string[] = [];
    const results: Awaited<ReturnType<typeof activateAllocation>>[] = [];
    for (const eventId of ["recovery-attempt-1", "recovery-attempt-2"]) {
      await inRestoredCopy(async (db) => {
        const { input, expected, draw } = emergencyInput();
        const permission = { ...approval, eventId, incidentEvidence: `master/${eventId}` };
        const attempt: AllocationContext = {
          ...expected,
          eventId,
          incidentEvidence: permission.incidentEvidence,
          reauthentication: { operatorId: permission.operatorId, eventId },
          authority: {
            kind: "emergency",
            draw,
            knownIdentities: [...known],
            incidentRecorded: true,
            uncertaintyRecorded: false,
          },
        };
        const result = await withTransaction(db, (tx) =>
          activateAllocation(tx, node, input, permission, attempt),
        );
        expect(result.activationEventId).toBe(eventId);
        expect(result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
          { code: `A-${draw.identity}`, purpose: "standard" },
          { code: `R-${draw.identity}`, purpose: "rectificative" },
        ]);
        expect(
          (await db.execute(sql`select installation_identity from fiscal_allocations`)).rows,
        ).toEqual([{ installation_identity: draw.identity }]);
        expect(known).not.toContain(draw.identity);
        known.push(draw.identity);
        results.push(result);
      });
    }
    expect(results[0]!.sifId).not.toBe(results[1]!.sifId);
    for (const series of results[0]!.series)
      expect(results[1]!.series.map((entry) => entry.code)).not.toContain(series.code);
    expect(
      (await suite.db.execute(sql`select count(*) as n from fiscal_allocations`)).rows,
    ).toEqual([{ n: 0 }]);
  });
});
