import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPgliteDb, runMigrations, withTenant } from "@waitron/db";
import { isAppError, locationId as brandLocationId } from "@waitron/shared";
import type { ProvisionedNode } from "@waitron/module";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { TENANT_A, seedSoldRegistro, seedTenants } from "../test/fixtures.js";
import { appendToChain } from "./chain.js";
import { currentSif, esPrimerRegistro, registerSif, type SifRegistration } from "./registro-sif.js";
import { MAX_BASE_CODE_LENGTH } from "./reserved-series.js";
import { FISCAL_RESTORE, installationFloor, restoreFiscal } from "./restore.js";
import { altaFor, seedSale, seedTill } from "./testing/seed.js";
import { verifyChain } from "./verify.js";

let db: Awaited<ReturnType<typeof createPgliteDb>>;

const NODE: ProvisionedNode = {
  tenantId: TENANT_A.id,
  locationId: brandLocationId(TENANT_A.locationId),
  nodeId: TENANT_A.nodeId,
};
const SIF = { nif: "89890001K", idSistemaInformatico: "WT" } as const;
const NOW = new Date("2026-09-06T10:00:00.000Z");
const FLOOR = installationFloor(NOW);

/** A live node: registered SIF + `FA` (standard, next_number 5) and `RE` (rectificative). */
async function seedLiveNode(): Promise<SifRegistration> {
  const sif = await withTenant(db, TENANT_A.id, (tx) =>
    registerSif(tx, { ...SIF, tenantId: TENANT_A.id, nodeId: TENANT_A.nodeId }),
  );
  await db.execute(sql`
    insert into invoice_series (tenant_id, node_id, code, purpose, next_number) values
      (${TENANT_A.id}, ${TENANT_A.nodeId}, 'FA', 'standard', 5),
      (${TENANT_A.id}, ${TENANT_A.nodeId}, 'RE', 'rectificative', 1)
  `);
  return sif;
}

async function liveSeriesCodes(): Promise<string[]> {
  const { rows } = await db.execute<{ code: string }>(sql`
    select code from invoice_series
    where node_id = ${TENANT_A.nodeId} and retired_at is null order by code
  `);
  return rows.map((r) => r.code);
}

function counterOf() {
  return db
    .execute<{ proximo_numero: number }>(
      sql`select proximo_numero from contadores_instalacion where nif = ${SIF.nif} and id_sistema_informatico = ${SIF.idSistemaInformatico}`,
    )
    .then((r) => r.rows[0]?.proximo_numero);
}

describe("installationFloor", () => {
  it("is whole seconds since 2020-01-01T00:00:00Z", () => {
    expect(installationFloor(new Date("2020-01-01T00:00:00.000Z"))).toBe(0);
    expect(installationFloor(new Date("2020-01-01T00:01:00.999Z"))).toBe(60);
    // Fits `integer` until 2088.
    expect(installationFloor(new Date("2088-01-01T00:00:00Z"))).toBeLessThan(2 ** 31);
  });
});

describe("restoreFiscal", () => {
  beforeEach(async () => {
    db = await createPgliteDb();
    for (const migrations of TEST_MIGRATIONS) await runMigrations(db, migrations);
    await seedTenants(db);
  });
  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  it("revokes the live SIF, mints a floored number, resets the chain head, keeps the ledger, returns disjoint series", async () => {
    const first = await seedLiveNode();
    await seedSoldRegistro(db, {
      tenantId: TENANT_A.id,
      tillId: TENANT_A.tillId,
      nodeId: TENANT_A.nodeId,
      sifId: first.id,
      nif: SIF.nif,
      secuencia: 7,
      huella: "C".repeat(64),
    });

    const outcome = await withTenant(db, TENANT_A.id, (tx) => restoreFiscal(tx, NODE, NOW));

    const fresh = await withTenant(db, TENANT_A.id, (tx) =>
      currentSif(tx, TENANT_A.id, TENANT_A.nodeId),
    );
    expect(fresh.id).not.toBe(first.id);
    expect(fresh.numeroInstalacion).toBeGreaterThanOrEqual(FLOOR);
    expect(fresh.numeroInstalacion).toBeGreaterThan(first.numeroInstalacion);
    const { rows: old } = await db.execute<{ revocado_en: string | null }>(
      sql`select revocado_en from registro_sif where id = ${first.id}`,
    );
    expect(old[0]?.revocado_en).not.toBeNull();
    expect(
      await withTenant(db, TENANT_A.id, (tx) => esPrimerRegistro(tx, TENANT_A.id, TENANT_A.nodeId)),
    ).toBe(true);
    const { rows: head } = await db.execute<{ secuencia: number }>(
      sql`select secuencia from cadenas where node_id = ${TENANT_A.nodeId}`,
    );
    expect(head[0]?.secuencia).toBe(7); // ours; never reset
    const { rows: ledger } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from registros_facturacion`,
    );
    expect(ledger[0]?.n).toBe(1); // the seeded S7/1 registro is untouched
    // seedSoldRegistro also opened an `S7` series on the node — it is live, so it is re-derived too.
    const n = fresh.numeroInstalacion;
    expect(outcome.series).toEqual([
      { code: `FA-${n}`, purpose: "standard" },
      { code: `RE-${n}`, purpose: "rectificative" },
      { code: `S7-${n}`, purpose: "standard" },
    ]);
    expect(outcome.report).toContain(`installation ${n}`);
    // The hook writes NO series itself — the orchestrator does (spec §3.4).
    expect(await liveSeriesCodes()).toEqual(["FA", "RE", "S7"]);
  });

  it("THE REUSE EXPERIMENT: restoring an older artifact cannot re-mint a number a later restore used", async () => {
    // Spec §3.5. State A = the backup (installation 1 live, counter 2). A previous restore of A
    // minted 2 (revoking 1). Now rebuild state A EXACTLY — no row for 2, 1 live again, counter back —
    // which is what restoring the older artifact does, and run the hook: it must not mint 2 again.
    await seedLiveNode();
    const counterAtBackup = await counterOf();
    const later = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF, tenantId: TENANT_A.id, nodeId: TENANT_A.nodeId }),
    );
    await db.execute(sql`delete from registro_sif where id = ${later.id}`);
    await db.execute(
      sql`update registro_sif set revocado_en = null where node_id = ${TENANT_A.nodeId}`,
    );
    await db.execute(
      sql`update contadores_instalacion set proximo_numero = ${counterAtBackup} where nif = ${SIF.nif} and id_sistema_informatico = ${SIF.idSistemaInformatico}`,
    );

    await withTenant(db, TENANT_A.id, (tx) => restoreFiscal(tx, NODE, NOW));

    const fresh = await withTenant(db, TENANT_A.id, (tx) =>
      currentSif(tx, TENANT_A.id, TENANT_A.nodeId),
    );
    // Control (run it once): delete `raiseInstallationFloor` from restoreFiscal → this mints 2 → red.
    expect(fresh.numeroInstalacion).not.toBe(later.numeroInstalacion);
    expect(fresh.numeroInstalacion).toBeGreaterThan(later.numeroInstalacion);
  });

  it("keeps an existing counter above the wall-clock floor when minting", async () => {
    await seedLiveNode();
    const nextNumber = FLOOR + 1;
    await db.execute(sql`
      update contadores_instalacion set proximo_numero = ${nextNumber}
      where nif = ${SIF.nif} and id_sistema_informatico = ${SIF.idSistemaInformatico}
    `);

    await withTenant(db, TENANT_A.id, (tx) => restoreFiscal(tx, NODE, NOW));

    const fresh = await withTenant(db, TENANT_A.id, (tx) =>
      currentSif(tx, TENANT_A.id, TENANT_A.nodeId),
    );
    expect(fresh.numeroInstalacion).toBe(nextNumber);
    expect(await counterOf()).toBe(nextNumber + 1);
  });

  it("creates the counter row when the restored database has none (a promoted standby's backup)", async () => {
    await seedLiveNode();
    await db.execute(sql`delete from contadores_instalacion`);
    await withTenant(db, TENANT_A.id, (tx) => restoreFiscal(tx, NODE, NOW));
    const fresh = await withTenant(db, TENANT_A.id, (tx) =>
      currentSif(tx, TENANT_A.id, TENANT_A.nodeId),
    );
    expect(fresh.numeroInstalacion).toBe(FLOOR);
  });

  it("does nothing for a node with no live SIF: no mint, no series", async () => {
    await db.execute(sql`
      insert into invoice_series (tenant_id, node_id, code) values (${TENANT_A.id}, ${TENANT_A.nodeId}, 'FA')
    `);
    const outcome = await withTenant(db, TENANT_A.id, (tx) => restoreFiscal(tx, NODE, NOW));
    expect(outcome.series).toBeUndefined();
    expect(outcome.report).toMatch(/no live SIF/);
    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from registro_sif`,
    );
    expect(rows[0]?.n).toBe(0);
  });

  it("derives from live series only, stripping our own suffixes, and ignores retired ones", async () => {
    const first = await seedLiveNode();
    await db.execute(sql`update invoice_series set retired_at = now() where code = 'RE'`);
    // A previous restore's derived code, live (the unique key is per code, so the rename is allowed).
    await db.execute(
      sql`update invoice_series set code = ${`FA-${first.numeroInstalacion}`} where code = 'FA'`,
    );
    const outcome = await withTenant(db, TENANT_A.id, (tx) => restoreFiscal(tx, NODE, NOW));
    const fresh = await withTenant(db, TENANT_A.id, (tx) =>
      currentSif(tx, TENANT_A.id, TENANT_A.nodeId),
    );
    expect(outcome.series).toEqual([
      { code: `FA-${fresh.numeroInstalacion}`, purpose: "standard" },
    ]);
  });

  it("refuses a base code that cannot carry a suffix within the 60-character invoice-number cap, rolling back the restore", async () => {
    await seedLiveNode();
    const long = "L".repeat(MAX_BASE_CODE_LENGTH + 1);
    await db.execute(sql`update invoice_series set code = ${long} where code = 'FA'`);
    const err = await withTenant(db, TENANT_A.id, (tx) => restoreFiscal(tx, NODE, NOW)).catch(
      (e: unknown) => e,
    );
    expect(isAppError(err) && err.code).toBe("series.code_too_long");
    // Only the seeded SIF remains after the transaction rolls back.
    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from registro_sif`,
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
      tenantId: till.tenantId,
      locationId: brandLocationId(rows[0]!.location_id),
      nodeId: till.nodeId,
    };
    const sale1 = await seedSale(db, till, 1);
    const before = await db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.nodeId, altaFor(till.tillId, sale1, 1, 1)),
    );

    await withTenant(db, till.tenantId, (tx) => restoreFiscal(tx, node, NOW));
    const fresh = await withTenant(db, till.tenantId, (tx) =>
      currentSif(tx, till.tenantId, till.nodeId),
    );

    const sale2 = await seedSale(db, till, 2);
    const after = await db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.nodeId, altaFor(till.tillId, sale2, 2, 2)),
    );
    const { rows: rec } = await db.execute<{
      primer_registro: boolean;
      anterior_huella: string | null;
      sif_id: string;
    }>(
      sql`select primer_registro, anterior_huella, sif_id from registros_facturacion where id = ${after.id}`,
    );
    expect(rec[0]).toEqual({ primer_registro: true, anterior_huella: null, sif_id: fresh.id });
    expect(after.secuencia).toBe(before.secuencia + 1); // the sequence is ours and continues
    const report = await withTenant(db, till.tenantId, (tx) =>
      verifyChain(tx, till.tenantId, till.nodeId),
    );
    expect(report).toMatchObject({ ok: true, issues: [] });
  });

  it("FISCAL_RESTORE is restoreFiscal with the wall clock", async () => {
    await seedLiveNode();
    const before = installationFloor(new Date());
    await withTenant(db, TENANT_A.id, (tx) => FISCAL_RESTORE(tx, NODE));
    const fresh = await withTenant(db, TENANT_A.id, (tx) =>
      currentSif(tx, TENANT_A.id, TENANT_A.nodeId),
    );
    expect(fresh.numeroInstalacion).toBeGreaterThanOrEqual(before);
  });
});
