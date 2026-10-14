import { seedFixtureSif as registerSif } from "../test/sif-fixture.js";
import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { deployment, invoiceSeries, readTenant, withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { isAppError, locationId as brandLocationId } from "@waitron/shared";
import type { ProvisionedNode } from "@waitron/module";
import { allocationFixture } from "../test/allocation-fixture.js";
import { ALLOCATED_FISCAL_RESTORE } from "./allocated-lifecycle.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { TENANT_A, seedSoldRegistro, seedTenants } from "../test/fixtures.js";
import { appendToChain } from "./chain.js";
import { currentSif, esPrimerRegistro, type SifRegistration } from "./registro-sif.js";
import { MAX_BASE_CODE_LENGTH, liveSeriesBases } from "./reserved-series.js";
import { FISCAL_RESTORE, restoreFiscal } from "./restore.js";
import { registrosFacturacion } from "./schema/registros.js";
import { altaFor, seedSale, seedTill } from "./testing/seed.js";
import { verifyChain } from "./verify.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS, timeoutMs: 60_000 });

let db: Database;

beforeAll(() => {
  db = suite.db;
});

const NODE: ProvisionedNode = {
  locationId: brandLocationId(TENANT_A.locationId),
  nodeId: TENANT_A.nodeId,
};
const SIF = { nif: "89890001K", idSistemaInformatico: "WT" } as const;
const NOW = new Date("2026-09-06T10:00:00.000Z");

/** A live node: registered SIF + `FA` (standard, next_number 5) and `RE` (rectificative). */
async function seedLiveNode(): Promise<SifRegistration> {
  const sif = await withTransaction(db, (tx) =>
    registerSif(tx, { ...SIF, nodeId: TENANT_A.nodeId }),
  );
  await db.insert(invoiceSeries).values([
    { nodeId: TENANT_A.nodeId, code: "FA", purpose: "standard", nextNumber: 5 },
    { nodeId: TENANT_A.nodeId, code: "RE", purpose: "rectificative", nextNumber: 1 },
  ]);
  return sif;
}

async function liveSeriesCodes(): Promise<string[]> {
  const { rows } = await db.execute<{ code: string }>(sql`
    select code from invoice_series
    where node_id = ${TENANT_A.nodeId} and retired_at is null order by code
  `);
  return rows.map((r) => r.code);
}

function counterAbsent(): boolean {
  return (
    db.execute(sql`select name from sqlite_master where name = 'contadores_instalacion'`).rows
      .length === 0
  );
}

afterEach(() => vi.useRealTimers());

describe("restoreFiscal", () => {
  beforeEach(async () => {
    await seedTenants(db);
    await db.insert(deployment).values({ id: 1, environment: "preproduction" });
  });

  it("activates the supplied restore identity and complete series, resets the head and keeps the ledger", async () => {
    const first = await seedLiveNode();
    await seedSoldRegistro(db, {
      locationId: TENANT_A.locationId,
      nodeId: TENANT_A.nodeId,
      sifId: first.id,
      nif: SIF.nif,
      secuencia: 7,
      huella: "C".repeat(64),
    });

    const fixture = recoveryFixture([
      { code: "FA", purpose: "standard" },
      { code: "RE", purpose: "rectificative" },
      { code: "S7", purpose: "standard" },
    ]);
    const outcome = await fixture.transaction(db, "restore", (tx, operation) =>
      ALLOCATED_FISCAL_RESTORE(tx, NODE, operation),
    );

    const fresh = await withTransaction(db, (tx) => currentSif(tx, TENANT_A.nodeId));
    expect(fresh.id).not.toBe(first.id);
    expect(fresh.numeroInstalacion).toBe("P000042");
    expect(fresh.numeroInstalacion).not.toBe(first.numeroInstalacion);
    const { rows: old } = await db.execute<{ revocado_en: string | null }>(
      sql`select revocado_en from registro_sif where id = ${first.id}`,
    );
    expect(old[0]?.revocado_en).not.toBeNull();
    expect(await withTransaction(db, (tx) => esPrimerRegistro(tx, TENANT_A.nodeId))).toBe(true);
    const { rows: head } = await db.execute<{ secuencia: number }>(
      sql`select secuencia from cadenas where node_id = ${TENANT_A.nodeId}`,
    );
    expect(head[0]?.secuencia).toBe(7); // ours; never reset
    const { rows: ledger } = await db.execute<{ n: number }>(
      sql`select cast(count(*) as int) as n from registros_facturacion`,
    );
    expect(ledger[0]?.n).toBe(1); // the seeded S7/1 registro is untouched
    // seedSoldRegistro also opened an `S7` series on the node — it is live, so it is re-derived too.
    const n = fresh.numeroInstalacion;
    expect(outcome.series).toBeUndefined();
    expect(await activeSeriesWithPurposes()).toEqual([
      { code: "FA-P000042", purpose: "standard" },
      { code: "RE-P000042", purpose: "rectificative" },
      { code: "S7-P000042", purpose: "standard" },
    ]);
    expect(outcome.report).toContain(`installation ${n}`);
    expect(await liveSeriesCodes()).toEqual(["FA-P000042", "RE-P000042", "S7-P000042"]);
  });

  it("THE REUSE EXPERIMENT: restoring an older artifact cannot re-mint a number a later restore used", async () => {
    await seedLiveNode();
    const later = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF, nodeId: TENANT_A.nodeId, numeroInstalacion: "P000042" }),
    );
    await db.execute(sql`delete from registro_sif where id = ${later.id}`);
    await db.execute(
      sql`update registro_sif set revocado_en = null where node_id = ${TENANT_A.nodeId}`,
    );
    const fixture = recoveryFixture(
      [
        { code: "FA", purpose: "standard" },
        { code: "RE", purpose: "rectificative" },
      ],
      "P000043",
    );
    await fixture.transaction(db, "restore", (tx, operation) => restoreFiscal(tx, NODE, operation));
    const fresh = await withTransaction(db, (tx) => currentSif(tx, TENANT_A.nodeId));
    expect(fresh.numeroInstalacion).not.toBe(later.numeroInstalacion);
    expect(fresh.numeroInstalacion).toBe("P000043");
  });

  it("uses the supplied recovery identity with a clock far ahead", async () => {
    await seedLiveNode();
    vi.setSystemTime(new Date("2039-01-01T00:00:00.000Z"));
    const fixture = recoveryFixture([
      { code: "FA", purpose: "standard" },
      { code: "RE", purpose: "rectificative" },
    ]);
    await fixture.transaction(db, "restore", (tx, operation) => restoreFiscal(tx, NODE, operation));
    const fresh = await withTransaction(db, (tx) => currentSif(tx, TENANT_A.nodeId));
    expect(fresh.numeroInstalacion).toBe("P000042");
    expect(counterAbsent()).toBe(true);
  });

  it("uses the supplied recovery identity without a local allocator", async () => {
    await seedLiveNode();
    const fixture = recoveryFixture([
      { code: "FA", purpose: "standard" },
      { code: "RE", purpose: "rectificative" },
    ]);
    await fixture.transaction(db, "restore", (tx, operation) => restoreFiscal(tx, NODE, operation));
    const fresh = await withTransaction(db, (tx) => currentSif(tx, TENANT_A.nodeId));
    expect(fresh.numeroInstalacion).toBe("P000042");
    expect(counterAbsent()).toBe(true);
  });

  it("does nothing for a node with no live SIF: no mint, no series", async () => {
    await db.insert(invoiceSeries).values({ nodeId: TENANT_A.nodeId, code: "FA" });
    const outcome = await withTransaction(db, (tx) => restoreFiscal(tx, NODE));
    expect(outcome.series).toBeUndefined();
    expect(outcome.report).toMatch(/no live SIF/);
    const { rows } = await db.execute<{ n: number }>(
      sql`select cast(count(*) as int) as n from registro_sif`,
    );
    expect(rows[0]?.n).toBe(0);
  });

  it("derives from live series only, stripping our own suffixes, and ignores retired ones", async () => {
    const first = await seedLiveNode();
    await db
      .update(invoiceSeries)
      .set({ retiredAt: new Date() })
      .where(eq(invoiceSeries.code, "RE"));
    // A previous restore's derived code, live (the unique key is per code, so the rename is allowed).
    await db.execute(
      sql`update invoice_series set code = ${`FA-${first.numeroInstalacion}`} where code = 'FA'`,
    );
    const fixture = recoveryFixture([{ code: "FA", purpose: "standard" }]);
    const outcome = await fixture.transaction(db, "restore", (tx, operation) =>
      ALLOCATED_FISCAL_RESTORE(tx, NODE, operation),
    );
    const fresh = await withTransaction(db, (tx) => currentSif(tx, TENANT_A.nodeId));
    expect(fresh.numeroInstalacion).toBe("P000042");
    expect(outcome.series).toBeUndefined();
    expect(await activeSeriesWithPurposes()).toEqual([{ code: "FA-P000042", purpose: "standard" }]);
  });

  it("refuses a base code that cannot carry a suffix within the 60-character invoice-number cap, rolling back the restore", async () => {
    await seedLiveNode();
    const long = "L".repeat(MAX_BASE_CODE_LENGTH + 1);
    await db.execute(sql`update invoice_series set code = ${long} where code = 'FA'`);
    const fixture = recoveryFixture([
      { code: "FA", purpose: "standard" },
      { code: "RE", purpose: "rectificative" },
    ]);
    const err = await fixture
      .transaction(db, "restore", (tx, operation) => restoreFiscal(tx, NODE, operation))
      .catch((e: unknown) => e);
    expect(isAppError(err) && err.code).toBe("series.code_too_long");
    // Only the seeded SIF remains after the transaction rolls back.
    const { rows } = await db.execute<{ n: number }>(
      sql`select cast(count(*) as int) as n from registro_sif`,
    );
    expect(rows[0]?.n).toBe(1);
  });

  it("the first record appended after the restore is a chain start under the new SIF, and the chain verifies", async () => {
    // Through the REAL append path (appendToChain computes the hash and derives primer_registro),
    // before and after the hook — never a fixture that writes the hash by hand.
    const till = await seedTill(db);
    const { rows } = await db.execute<{ location_id: string }>(
      sql`select location_id from nodes where id = ${till.nodeId}`,
    );
    const node: ProvisionedNode = {
      locationId: brandLocationId(rows[0]!.location_id),
      nodeId: till.nodeId,
    };
    const sale1 = await seedSale(db, till, 1);
    const before = await db.transaction((tx) =>
      appendToChain(tx, till.nodeId, altaFor(till, sale1, 1, 1)),
    );

    const bases = await liveSeriesBases(db, node);
    const tenant = (await readTenant(db))!;
    const previous = await currentSif(db, node.nodeId);
    const fixture = allocationFixture({
      node,
      bases,
      identity: "P000042",
      taxpayerNif: tenant.taxId,
      softwareId: previous.idSistemaInformatico,
    });
    await fixture.transaction(db, "restore", (tx, operation) => restoreFiscal(tx, node, operation));
    const fresh = await withTransaction(db, (tx) => currentSif(tx, till.nodeId));

    const sale2 = await seedSale(db, till, 2);
    const after = await db.transaction((tx) =>
      appendToChain(tx, till.nodeId, altaFor(till, sale2, 2, 2)),
    );
    // Through the builder: only it maps the stored 0/1 `primer_registro` back to a boolean.
    const rec = await db
      .select({
        primer_registro: registrosFacturacion.primerRegistro,
        anterior_huella: registrosFacturacion.anteriorHuella,
        sif_id: registrosFacturacion.sifId,
      })
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.id, after.id));
    expect(rec[0]).toEqual({ primer_registro: true, anterior_huella: null, sif_id: fresh.id });
    expect(after.secuencia).toBe(before.secuencia + 1); // the sequence is ours and continues
    const report = await withTransaction(db, (tx) => verifyChain(tx, till.nodeId));
    expect(report).toMatchObject({ ok: true, issues: [] });
  });

  it("FISCAL_RESTORE uses the supplied identity at the stated clock", async () => {
    await seedLiveNode();
    vi.setSystemTime(NOW);
    const fixture = recoveryFixture([
      { code: "FA", purpose: "standard" },
      { code: "RE", purpose: "rectificative" },
    ]);
    await fixture.transaction(db, "restore", (tx, operation) =>
      FISCAL_RESTORE(tx, NODE, operation),
    );
    const fresh = await withTransaction(db, (tx) => currentSif(tx, TENANT_A.nodeId));
    expect(fresh.numeroInstalacion).toBe("P000042");
  });
});

function recoveryFixture(
  bases: readonly { code: string; purpose: string }[],
  identity = "P000042",
) {
  return allocationFixture({
    node: NODE,
    bases,
    identity,
    softwareId: SIF.idSistemaInformatico,
  });
}
async function activeSeriesWithPurposes() {
  const { rows } = await db.execute<{ code: string; purpose: string }>(sql`
    select code, purpose from invoice_series
    where node_id = ${NODE.nodeId} and retired_at is null order by code
  `);
  return rows;
}
