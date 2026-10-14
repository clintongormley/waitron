import { seedFixtureSif as registerSif } from "../test/sif-fixture.js";
import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { deployment, invoiceSeries, tenants, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A, TENANT_B } from "../test/fixtures.js";

import { registroSif } from "./schema/sif.js";
import { fiscalAllocations } from "./schema/allocations.js";
import * as fiscal from "./index.js";
import {
  enrolPaperCustodian,
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperReservationForBlock,
  verifyPaperReservation,
  type PaperAllocation,
  type PaperReservationContext,
} from "./paper-evidence.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const primary = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const target = TENANT_A.nodeId2;
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
const event = {
  eventId: "join-1",
  operatorId: "administrator",
  sourceId: primary.nodeId,
  targetNodeId: target,
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
  ...event,
  currentRegisterConfirmed: true,
  reservationConfirmed: true,
  currentEntryState: "reserved",
  requiredBases: bases,
};
function signed(input = allocation, scope = event) {
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
    reservation: signPaperReservationForBlock(block, input.allocationId, scope, privateKey),
  };
}
async function check(
  input: unknown = signed(),
  expected = context,
  source = primary,
  standbyNodeId: string = target,
) {
  return withTransaction(suite.db, (tx) =>
    fiscal.validateStandbyAllocation(tx, source, standbyNodeId, input, trust, expected),
  );
}

beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await withTransaction(suite.db, (tx) =>
    registerSif(tx, {
      nodeId: primary.nodeId,
      nif: allocation.taxpayerNif,
      idSistemaInformatico: allocation.softwareId,
    }),
  );
  await suite.db
    .insert(invoiceSeries)
    .values(bases.map((base) => ({ ...base, nodeId: primary.nodeId })));
});

describe("a dormant standby allocation checked against stored venue facts", () => {
  it("returns the reserved identities without writing a SIF, chain, series, activation or counter", async () => {
    const before = (await suite.db.execute(sql`select * from registro_sif`)).rows;
    const counters = (
      await suite.db.execute(
        sql`select name from sqlite_master where name = 'contadores_instalacion'`,
      )
    ).rows;
    const chains = (await suite.db.execute(sql`select * from cadenas`)).rows;
    const series = await suite.db.select().from(invoiceSeries);
    const input = signed();
    expect(await check(input)).toEqual({
      ok: true,
      allocation,
      reservation: input.reservation.payload,
    });
    expect((await suite.db.execute(sql`select * from registro_sif`)).rows).toEqual(before);
    expect(
      (
        await suite.db.execute(
          sql`select name from sqlite_master where name = 'contadores_instalacion'`,
        )
      ).rows,
    ).toEqual(counters);
    expect((await suite.db.execute(sql`select * from cadenas`)).rows).toEqual(chains);
    expect(await suite.db.select().from(invoiceSeries)).toEqual(series);
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  });

  it.each(["taxpayerNif", "softwareId", "environment"] as const)(
    "uses stored %s even if both submitted evidence and context agree on another value",
    async (field) => {
      const value = {
        taxpayerNif: "B12345678",
        softwareId: "ZZ",
        environment: "production" as const,
      }[field];
      const input = signed({ ...allocation, [field]: value });
      const expected = { ...context, [field]: value };
      expect(verifyPaperReservation(input, trust, expected).ok).toBe(true);
      expect(await check(input, expected)).toEqual({ ok: false, reason: "scope_mismatch" });
    },
  );

  it("uses the primary's complete stored series rather than accepting the caller's subset", async () => {
    const input = signed({ ...allocation, series: allocation.series.slice(0, 1) });
    const expected = { ...context, requiredBases: bases.slice(0, 1) };
    expect(verifyPaperReservation(input, trust, expected).ok).toBe(true);
    expect(await check(input, expected)).toEqual({ ok: false, reason: "series_mismatch" });
  });

  it("binds the proof to the actual primary even if caller and evidence name another source", async () => {
    const input = signed(allocation, { ...event, sourceId: TENANT_B.nodeId });
    const expected = { ...context, sourceId: TENANT_B.nodeId };
    expect(verifyPaperReservation(input, trust, expected).ok).toBe(true);
    expect(await check(input, expected)).toEqual({ ok: false, reason: "scope_mismatch" });
  });

  it("binds the proof to the actual requested standby even if caller and evidence name another target", async () => {
    const input = signed(allocation, { ...event, targetNodeId: TENANT_B.nodeId });
    const expected = { ...context, targetNodeId: TENANT_B.nodeId };
    expect(verifyPaperReservation(input, trust, expected).ok).toBe(true);
    expect(await check(input, expected)).toEqual({ ok: false, reason: "scope_mismatch" });
  });

  it("refuses a source node outside the requested location", async () => {
    expect(
      await check(undefined, context, { ...primary, locationId: locationId(TENANT_B.locationId) }),
    ).toEqual({ ok: false, reason: "node_mismatch" });
  });

  it("refuses a missing source node", async () => {
    expect(
      await check(undefined, context, { ...primary, nodeId: "missing" as typeof primary.nodeId }),
    ).toEqual({ ok: false, reason: "node_mismatch" });
  });

  it("refuses a missing taxpayer", async () => {
    await suite.db.delete(tenants);
    expect(await check()).toEqual({ ok: false, reason: "taxpayer_missing" });
  });

  it("refuses an unstamped deployment environment", async () => {
    await suite.db.delete(deployment);
    expect(await check()).toEqual({ ok: false, reason: "environment_unstamped" });
  });

  it("refuses a source whose SIF is revoked", async () => {
    await suite.db
      .update(registroSif)
      .set({ revocadoEn: new Date() })
      .where(eq(registroSif.nodeId, primary.nodeId));
    expect(await check()).toEqual({ ok: false, reason: "primary_not_registered" });
  });

  it("refuses a live SIF whose taxpayer no longer agrees with the venue", async () => {
    await suite.db
      .update(registroSif)
      .set({ nif: "B12345678" })
      .where(eq(registroSif.nodeId, primary.nodeId));
    expect(await check()).toEqual({ ok: false, reason: "scope_mismatch" });
  });

  it("refuses a source with no live invoice series", async () => {
    await suite.db
      .update(invoiceSeries)
      .set({ retiredAt: new Date() })
      .where(eq(invoiceSeries.nodeId, primary.nodeId));
    expect(await check()).toEqual({ ok: false, reason: "series_mismatch" });
  });

  it("refuses an installation already used by a revoked SIF", async () => {
    await suite.db.insert(registroSif).values({
      nodeId: TENANT_B.nodeId,
      nif: allocation.taxpayerNif,
      idSistemaInformatico: allocation.softwareId,
      numeroInstalacion: sql`${allocation.installationIdentity}`,
      revocadoEn: new Date(),
    });
    expect(await check()).toEqual({ ok: false, reason: "installation_used" });
  });

  it("refuses a locally committed allocation even if the outside context claims it is still reserved", async () => {
    const [sif] = await suite.db.select().from(registroSif);
    await suite.db.insert(fiscalAllocations).values({
      eventKey: "previous-activation",
      allocationKey: allocation.allocationId,
      nodeId: primary.nodeId,
      sifId: sif!.id,
      taxpayerNif: allocation.taxpayerNif,
      softwareId: allocation.softwareId,
      environment: allocation.environment,
      installationIdentity: allocation.installationIdentity,
      allocation: { ...allocation, reservationEvidence: null },
      approval: {
        version: 1,
        eventId: "previous-activation",
        operatorId: "administrator",
        sourceId: primary.nodeId,
        targetNodeId: primary.nodeId,
        incidentEvidence: "master-register/previous-activation",
        confirmedAt: event.reservedAt,
        oldMachineAbsent: false,
        oldMachineOffline: true,
        noParallelRecovery: true,
      },
      bases,
      result: { activationEventId: "previous-activation", sifId: sif!.id, series: [] },
    });
    expect(await check()).toEqual({ ok: false, reason: "allocation_consumed" });
  });

  it("refuses a reserved series already present on another node even when retired", async () => {
    await suite.db.insert(invoiceSeries).values({
      nodeId: TENANT_B.nodeId,
      code: "FF-P000042",
      purpose: "full",
      retiredAt: new Date(),
    });
    expect(await check()).toEqual({ ok: false, reason: "series_collision" });
  });

  it("preserves a refusal from current outside reservation evidence", async () => {
    expect(await check(undefined, { ...context, currentEntryState: "abandoned" })).toEqual({
      ok: false,
      reason: "reservation_not_current",
    });
  });
});
