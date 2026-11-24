import { seedInvoiceNumber } from "@waitron/db/testing/seed.js";
import { readChainHead } from "./chain.js";
import { seedFixtureSif as registerSif, withoutIdentityTriggers } from "../test/sif-fixture.js";
import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  deployment,
  invoiceSeries,
  readTaxpayer,
  withTransaction,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { isAppError } from "@waitron/shared";
import type { ProvisionedNode } from "@waitron/module";
import { allocationFixture } from "../test/allocation-fixture.js";
import { ALLOCATED_FISCAL_RESTORE } from "./allocated-lifecycle.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { TAXPAYER_A, seedSoldRegistro, seedTaxpayers } from "../test/fixtures.js";
import { appendToChain } from "./chain.js";
import { currentSif, type SifRegistration } from "./registro-sif.js";
import { MAX_BASE_CODE_LENGTH, liveSeriesBases } from "./reserved-series.js";
import { FISCAL_RESTORE, restoreFiscal } from "./restore.js";
import { verifactuRecords } from "./schema/verifactu-records.js";
import { altaFor, seedSale, seedNode } from "./testing/seed.js";
import { verifyChain } from "./verify.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS, timeoutMs: 60_000 });

let db: Database;

beforeAll(() => {
  db = suite.db;
});

const NODE: ProvisionedNode = {
  nodeId: TAXPAYER_A.nodeId,
};
const SIF = { nif: "89890001K", idSistemaInformatico: "WT" } as const;
const NOW = new Date("2026-09-06T10:00:00.000Z");

/** A live node: registered SIF + `FA` (standard, numbered through 4) and `RE` (corrective). */
async function seedLiveNode(
  seriesCode: (sif: SifRegistration) => string = () => "FA",
): Promise<SifRegistration> {
  const sif = await withTransaction(db, (tx) =>
    registerSif(tx, { ...SIF, nodeId: TAXPAYER_A.nodeId }),
  );
  const [standard] = await db
    .insert(invoiceSeries)
    .values([
      { nodeId: TAXPAYER_A.nodeId, code: seriesCode(sif), purpose: "standard" },
      { nodeId: TAXPAYER_A.nodeId, code: "RE", purpose: "corrective" },
    ])
    .returning({ seriesId: invoiceSeries.id, nodeId: invoiceSeries.nodeId });
  await seedInvoiceNumber(db, standard!, 4);
  return sif;
}

async function liveSeriesCodes(): Promise<string[]> {
  const { rows } = await db.execute<{ code: string }>(sql`
    select code from invoice_series
    where node_id = ${TAXPAYER_A.nodeId} and retired_at is null order by code
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
    await seedTaxpayers(db);
    await db.insert(deployment).values({ id: 1, environment: "preproduction" });
  });

  it("activates the supplied restore identity and complete series, resets the head and keeps the ledger", async () => {
    const first = await seedLiveNode();
    await seedSoldRegistro(db, {
      nodeId: TAXPAYER_A.nodeId,
      sifId: first.id,
      nif: SIF.nif,
      secuencia: 7,
      huella: "C".repeat(64),
    });

    const fixture = recoveryFixture([
      { code: "FA", purpose: "standard" },
      { code: "RE", purpose: "corrective" },
      { code: "S7", purpose: "standard" },
    ]);
    const outcome = await fixture.transaction(db, "restore", (tx, operation) =>
      ALLOCATED_FISCAL_RESTORE(tx, NODE, operation),
    );

    const fresh = await withTransaction(db, (tx) => currentSif(tx, TAXPAYER_A.nodeId));
    expect(fresh.id).not.toBe(first.id);
    expect(fresh.numeroInstalacion).toBe("P000042");
    expect(fresh.numeroInstalacion).not.toBe(first.numeroInstalacion);
    const { rows: old } = await db.execute<{ revocado_en: string | null }>(
      sql`select revocado_en from verifactu_identities where id = ${first.id}`,
    );
    expect(old[0]?.revocado_en).not.toBeNull();
    const head = await withTransaction(db, (tx) => readChainHead(tx, TAXPAYER_A.nodeId));
    expect(head.secuencia).toBe(7);
    expect(head.ultimoRegistroId).toBeNull();
    const { rows: ledger } = await db.execute<{ n: number }>(
      sql`select cast(count(*) as int) as n from verifactu_records`,
    );
    expect(ledger[0]?.n).toBe(1); // the seeded S7/1 registro is untouched
    // seedSoldRegistro also opened an `S7` series on the node — it is live, so it is re-derived too.
    const n = fresh.numeroInstalacion;
    expect(outcome.series).toBeUndefined();
    expect(await activeSeriesWithPurposes()).toEqual([
      { code: "FA-P000042", purpose: "standard" },
      { code: "RE-P000042", purpose: "corrective" },
      { code: "S7-P000042", purpose: "standard" },
    ]);
    expect(outcome.report).toContain(`installation ${n}`);
    expect(await liveSeriesCodes()).toEqual(["FA-P000042", "RE-P000042", "S7-P000042"]);
  });

  it("THE REUSE EXPERIMENT: restoring an older artifact cannot re-mint a number a later restore used", async () => {
    await seedLiveNode();
    const later = await withTransaction(db, (tx) =>
      registerSif(tx, { ...SIF, nodeId: TAXPAYER_A.nodeId, numeroInstalacion: "P000042" }),
    );
    await withoutIdentityTriggers(db, async (tx) => {
      await tx.execute(sql`delete from verifactu_identities where id = ${later.id}`);
      await tx.execute(
        sql`update verifactu_identities set revocado_en = null where node_id = ${TAXPAYER_A.nodeId}`,
      );
    });
    const fixture = recoveryFixture(
      [
        { code: "FA", purpose: "standard" },
        { code: "RE", purpose: "corrective" },
      ],
      "P000043",
    );
    await fixture.transaction(db, "restore", (tx, operation) => restoreFiscal(tx, NODE, operation));
    const fresh = await withTransaction(db, (tx) => currentSif(tx, TAXPAYER_A.nodeId));
    expect(fresh.numeroInstalacion).not.toBe(later.numeroInstalacion);
    expect(fresh.numeroInstalacion).toBe("P000043");
  });

  it("uses the supplied recovery identity with a clock far ahead", async () => {
    await seedLiveNode();
    vi.setSystemTime(new Date("2039-01-01T00:00:00.000Z"));
    const fixture = recoveryFixture([
      { code: "FA", purpose: "standard" },
      { code: "RE", purpose: "corrective" },
    ]);
    await fixture.transaction(db, "restore", (tx, operation) => restoreFiscal(tx, NODE, operation));
    const fresh = await withTransaction(db, (tx) => currentSif(tx, TAXPAYER_A.nodeId));
    expect(fresh.numeroInstalacion).toBe("P000042");
    expect(counterAbsent()).toBe(true);
  });

  it("uses the supplied recovery identity without a local allocator", async () => {
    await seedLiveNode();
    const fixture = recoveryFixture([
      { code: "FA", purpose: "standard" },
      { code: "RE", purpose: "corrective" },
    ]);
    await fixture.transaction(db, "restore", (tx, operation) => restoreFiscal(tx, NODE, operation));
    const fresh = await withTransaction(db, (tx) => currentSif(tx, TAXPAYER_A.nodeId));
    expect(fresh.numeroInstalacion).toBe("P000042");
    expect(counterAbsent()).toBe(true);
  });

  it("does nothing for a node with no live SIF: no mint, no series", async () => {
    await db.insert(invoiceSeries).values({ nodeId: TAXPAYER_A.nodeId, code: "FA" });
    const outcome = await withTransaction(db, (tx) => restoreFiscal(tx, NODE));
    expect(outcome.series).toBeUndefined();
    expect(outcome.report).toMatch(/no live SIF/);
    const { rows } = await db.execute<{ n: number }>(
      sql`select cast(count(*) as int) as n from verifactu_identities`,
    );
    expect(rows[0]?.n).toBe(0);
  });

  it("derives from live series only, stripping our own suffixes, and ignores retired ones", async () => {
    await seedLiveNode((first) => `FA-${first.numeroInstalacion}`);
    await db
      .update(invoiceSeries)
      .set({ retiredAt: new Date() })
      .where(eq(invoiceSeries.code, "RE"));
    const fixture = recoveryFixture([{ code: "FA", purpose: "standard" }]);
    const outcome = await fixture.transaction(db, "restore", (tx, operation) =>
      ALLOCATED_FISCAL_RESTORE(tx, NODE, operation),
    );
    const fresh = await withTransaction(db, (tx) => currentSif(tx, TAXPAYER_A.nodeId));
    expect(fresh.numeroInstalacion).toBe("P000042");
    expect(outcome.series).toBeUndefined();
    expect(await activeSeriesWithPurposes()).toEqual([{ code: "FA-P000042", purpose: "standard" }]);
  });

  it("refuses a base code that cannot carry a suffix within the 60-character invoice-number cap, rolling back the restore", async () => {
    const long = "L".repeat(MAX_BASE_CODE_LENGTH + 1);
    await seedLiveNode(() => long);
    const fixture = recoveryFixture([
      { code: "FA", purpose: "standard" },
      { code: "RE", purpose: "corrective" },
    ]);
    const err = await fixture
      .transaction(db, "restore", (tx, operation) => restoreFiscal(tx, NODE, operation))
      .catch((e: unknown) => e);
    expect(isAppError(err) && err.code).toBe("series.code_too_long");
    // Only the seeded SIF remains after the transaction rolls back.
    const { rows } = await db.execute<{ n: number }>(
      sql`select cast(count(*) as int) as n from verifactu_identities`,
    );
    expect(rows[0]?.n).toBe(1);
  });

  it("the first record appended after the restore is a chain start under the new SIF, and the chain verifies", async () => {
    // Through the REAL append path (appendToChain computes the hash and derives primer_registro),
    // before and after the hook — never a fixture that writes the hash by hand.
    const seededNode = await seedNode(db);
    const node: ProvisionedNode = {
      nodeId: seededNode.nodeId,
    };
    const sale1 = await seedSale(db, seededNode, 1);
    const before = await db.transaction((tx) =>
      appendToChain(tx, seededNode.nodeId, altaFor(seededNode, sale1, 1, 1)),
    );

    const bases = await liveSeriesBases(db, node);
    const taxpayer = (await readTaxpayer(db))!;
    const previous = await currentSif(db, node.nodeId);
    const fixture = allocationFixture({
      node,
      bases,
      identity: "P000042",
      taxpayerNif: taxpayer.taxId,
      softwareId: previous.idSistemaInformatico,
    });
    await fixture.transaction(db, "restore", (tx, operation) => restoreFiscal(tx, node, operation));
    const fresh = await withTransaction(db, (tx) => currentSif(tx, seededNode.nodeId));

    const sale2 = await seedSale(db, seededNode, 2);
    const after = await db.transaction((tx) =>
      appendToChain(tx, seededNode.nodeId, altaFor(seededNode, sale2, 2, 2)),
    );
    // Through the builder: only it maps the stored 0/1 `primer_registro` back to a boolean.
    const rec = await db
      .select({
        primer_registro: verifactuRecords.primerRegistro,
        anterior_huella: verifactuRecords.anteriorHuella,
        sif_id: verifactuRecords.sifId,
      })
      .from(verifactuRecords)
      .where(eq(verifactuRecords.id, after.id));
    expect(rec[0]).toEqual({ primer_registro: true, anterior_huella: null, sif_id: fresh.id });
    expect(after.secuencia).toBe(before.secuencia + 1); // the sequence is ours and continues
    const report = await withTransaction(db, (tx) => verifyChain(tx, seededNode.nodeId));
    expect(report).toMatchObject({ ok: true, issues: [] });
  });

  it("FISCAL_RESTORE uses the supplied identity at the stated clock", async () => {
    await seedLiveNode();
    vi.setSystemTime(NOW);
    const fixture = recoveryFixture([
      { code: "FA", purpose: "standard" },
      { code: "RE", purpose: "corrective" },
    ]);
    await fixture.transaction(db, "restore", (tx, operation) =>
      FISCAL_RESTORE(tx, NODE, operation),
    );
    const fresh = await withTransaction(db, (tx) => currentSif(tx, TAXPAYER_A.nodeId));
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
