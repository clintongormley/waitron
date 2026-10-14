import { seedFixtureSif as registerSif } from "../test/sif-fixture.js";
import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { deployment, invoiceSeries, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A, TENANT_B } from "../test/fixtures.js";

import * as standby from "./standby-allocation.js";
import { fiscalReservations } from "./schema/reservations.js";
import {
  enrolPaperCustodian,
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperReservationForBlock,
  type PaperAllocation,
  type PaperReservationContext,
} from "./paper-evidence.js";

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
const allocation: PaperAllocation = {
  version: 1,
  allocationId: "allocation-42",
  taxpayerNif: "89890001K",
  softwareId: "W1",
  environment: "preproduction",
  installationIdentity: "P000042",
  series: [
    { code: "A-P000042", purpose: "standard" },
    { code: "FF-P000042", purpose: "full" },
    { code: "R-P000042", purpose: "rectificative" },
  ],
  source: "paper",
  issuedAt: "2026-10-12T08:00:00.000Z",
};
const join = {
  eventId: "join-1",
  operatorId: "administrator",
  sourceId: primary.nodeId,
  targetNodeId: target.nodeId,
  incidentEvidence: "master-register/join-1",
  reservedAt: "2026-10-12T09:00:00.000Z",
};
const context: PaperReservationContext = {
  allocationId: allocation.allocationId,
  taxpayerNif: allocation.taxpayerNif,
  softwareId: allocation.softwareId,
  environment: allocation.environment,
  recipientVenueId: "venue-1",
  generationId: "generation-1",
  blockId: "block-1",
  ...join,
  currentRegisterConfirmed: true,
  reservationConfirmed: true,
  currentEntryState: "reserved",
  requiredBases: bases,
};
function evidence(input = allocation, event = join) {
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
  return {
    block,
    reservation: signPaperReservationForBlock(block, input.allocationId, event, privateKey),
  };
}
type Establish = (
  tx: Transaction,
  source: typeof primary,
  node: typeof target,
  proof: unknown,
  key: unknown,
  expected: PaperReservationContext,
) => Promise<unknown>;
async function establish(
  proof: unknown = evidence(),
  expected = context,
  node = target,
  key: unknown = trust,
) {
  const api = standby as unknown as { establishDormantAllocation?: Establish };
  expect(api.establishDormantAllocation).toBeTypeOf("function");
  return withTransaction(suite.db, (tx) =>
    api.establishDormantAllocation!(tx, primary, node, proof, key, expected),
  );
}
async function rows(table: string) {
  return (await suite.db.execute(sql`select * from ${sql.identifier(table)}`)).rows;
}

beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await withTransaction(suite.db, (tx) =>
    registerSif(tx, {
      nodeId: primary.nodeId,
      nif: allocation.taxpayerNif,
      idSistemaInformatico: "W1",
    }),
  );
  await suite.db
    .insert(invoiceSeries)
    .values(bases.map((base) => ({ ...base, nodeId: primary.nodeId })));
});

describe("persisting a named spare's dormant paper allocation", () => {
  it("retains the signed reservation and complete bases without creating any active fiscal state", async () => {
    const active = [
      await rows("registro_sif"),
      await rows("cadenas"),
      await rows("invoice_series"),
      await suite.db.execute(
        sql`select name from sqlite_master where name = 'contadores_instalacion'`,
      ).rows,
      await rows("fiscal_allocations"),
    ];
    const proof = evidence();
    await establish(proof);
    const saved = await rows("fiscal_reservations");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      event_key: "join-1",
      allocation_key: "allocation-42",
      node_id: target.nodeId,
      source_node_id: primary.nodeId,
      installation_identity: "P000042",
      taxpayer_nif: "89890001K",
      software_id: "W1",
      environment: "preproduction",
    });
    expect(JSON.parse(String(saved[0]!.evidence))).toEqual(proof);
    expect(JSON.parse(String(saved[0]!.bases))).toEqual(bases);
    expect([
      await rows("registro_sif"),
      await rows("cadenas"),
      await rows("invoice_series"),
      await suite.db.execute(
        sql`select name from sqlite_master where name = 'contadores_instalacion'`,
      ).rows,
      await rows("fiscal_allocations"),
    ]).toEqual(active);
  });

  it("replays the same join without adding a second reservation", async () => {
    const first = await establish();
    const before = await rows("fiscal_reservations");
    expect(await establish()).toEqual(first);
    expect(await rows("fiscal_reservations")).toEqual(before);
  });

  it("persists the verified snapshot even if the caller changes its object during a later read", async () => {
    const proof = evidence();
    const expected = structuredClone(proof);
    await withTransaction(suite.db, async (tx) => {
      const select = tx.select.bind(tx);
      const spy = vi
        .spyOn(tx, "select")
        .mockImplementation((...args: Parameters<typeof tx.select>) => {
          const query = select(...args);
          const from = query.from.bind(query);
          vi.spyOn(query, "from").mockImplementation((table: Parameters<typeof query.from>[0]) => {
            if (table === fiscalReservations)
              (proof.reservation.payload as { operatorId: string }).operatorId =
                "changed-after-validation";
            return from(table);
          });
          return query;
        });
      try {
        await standby.establishDormantAllocation(tx, primary, target, proof, trust, context);
      } finally {
        spy.mockRestore();
      }
    });
    const saved = await rows("fiscal_reservations");
    expect(proof.reservation.payload.operatorId).toBe("changed-after-validation");
    expect(JSON.parse(String(saved[0]!.evidence))).toEqual(expected);
  });

  it.each(["event", "allocation", "identity"])(
    "refuses reusing a retained %s for another reservation",
    async (key) => {
      await establish();
      const changed =
        key === "event"
          ? {
              ...allocation,
              allocationId: "allocation-43",
              installationIdentity: "P000043",
              series: bases.map((b) => ({ code: `${b.code}-P000043`, purpose: b.purpose })),
            }
          : key === "allocation"
            ? allocation
            : { ...allocation, allocationId: "allocation-43" };
      const event =
        key === "event"
          ? join
          : { ...join, eventId: "join-2", incidentEvidence: "master-register/join-2" };
      const before = await rows("fiscal_reservations");
      await expect(
        establish(evidence(changed, event), {
          ...context,
          ...event,
          allocationId: changed.allocationId,
        }),
      ).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "reservation_reused" },
      });
      expect(await rows("fiscal_reservations")).toEqual(before);
    },
  );

  it("refuses a target in another location even if evidence and caller agree on its node id", async () => {
    const event = { ...join, targetNodeId: TENANT_B.nodeId };
    await expect(
      establish(
        evidence(allocation, event),
        { ...context, ...event },
        { ...target, nodeId: TENANT_B.nodeId },
      ),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "node_mismatch" },
    });
  });

  it("requires separately enrolled trust rather than a signer named by the supplied proof", async () => {
    await expect(establish(undefined, context, target, null)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "untrusted" },
    });
  });

  it("refuses a missing target node", async () => {
    const node = { ...target, nodeId: "missing" as typeof target.nodeId };
    const event = { ...join, targetNodeId: node.nodeId };
    await expect(
      establish(evidence(allocation, event), { ...context, ...event }, node),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "node_mismatch" },
    });
  });

  it("refuses reserving the primary as its own dormant spare", async () => {
    await expect(establish(undefined, context, primary)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "node_mismatch" },
    });
  });

  it.each(["SIF", "series"])("refuses a spare that already has an active %s", async (kind) => {
    if (kind === "SIF")
      await withTransaction(suite.db, (tx) =>
        registerSif(tx, {
          nodeId: target.nodeId,
          nif: allocation.taxpayerNif,
          idSistemaInformatico: "W1",
        }),
      );
    else await suite.db.insert(invoiceSeries).values({ nodeId: target.nodeId, code: "OLD" });
    await expect(establish()).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "standby_already_active" },
    });
  });

  it("propagates an invalid proof without retaining a reservation", async () => {
    const proof = evidence();
    const changed = { ...proof, reservation: { ...proof.reservation, signature: "A".repeat(86) } };
    await expect(establish(changed)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "untrusted" },
    });
    expect(await rows("fiscal_reservations")).toEqual([]);
  });

  it("refuses evidence carrying non-serialisable values", async () => {
    await expect(establish({ ...evidence(), unexpected: () => null })).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "malformed" },
    });
    expect(await rows("fiscal_reservations")).toEqual([]);
  });

  it("still checks the current outside register when replaying a locally retained join", async () => {
    await establish();
    await expect(
      establish(undefined, { ...context, currentEntryState: "abandoned" }),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_not_current" },
    });
  });

  it("refuses replacement signed join evidence under the same event and allocation", async () => {
    await establish();
    const event = { ...join, operatorId: "another-administrator" };
    await expect(
      establish(evidence(allocation, event), { ...context, ...event }),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_reused" },
    });
  });

  it("serialises simultaneous retries into one retained dormant reservation", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => establish()));
    expect(results).toEqual(
      Array.from({ length: 6 }, () => ({
        reservationEventId: "join-1",
        allocationId: "allocation-42",
      })),
    );
    expect(await rows("fiscal_reservations")).toHaveLength(1);
  });

  it("rolls the reservation back when a later adoption step fails", async () => {
    const api = standby as unknown as { establishDormantAllocation?: Establish };
    expect(api.establishDormantAllocation).toBeTypeOf("function");
    await expect(
      withTransaction(suite.db, async (tx) => {
        await api.establishDormantAllocation!(tx, primary, target, evidence(), trust, context);
        throw new Error("adoption refused");
      }),
    ).rejects.toThrow("adoption refused");
    expect(await rows("fiscal_reservations")).toEqual([]);
  });

  it.each([
    "update fiscal_reservations set installation_identity = 'P000043'",
    "delete from fiscal_reservations",
  ])("keeps the reservation immutable: %s", async (statement) => {
    await establish();
    const before = await rows("fiscal_reservations");
    await expect(withTransaction(suite.db, (tx) => tx.execute(sql.raw(statement)))).rejects.toThrow(
      "fiscal_reservations is append-only",
    );
    expect(await rows("fiscal_reservations")).toEqual(before);
  });
});
