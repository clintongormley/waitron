import { sql, type SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { appendToChain } from "./chain.js";
import type { Entorno } from "./registro-row.js";
import { verifyChain } from "./verify.js";
import { altaFor, anulacionFor, seedSale, seedTill, type SeededTill } from "./testing/seed.js";

const pg = useVenueDb({ migrations: TEST_MIGRATIONS });

let till: SeededTill;

beforeEach(async () => {
  till = await seedTill(pg.db);
});

/** Appends `n` altas in generation order. */
async function appendAltas(n: number): Promise<void> {
  for (let i = 1; i <= n; i++) {
    const saleId = await seedSale(pg.db, till, i);
    await pg.db.transaction((tx) =>
      appendToChain(tx, till.nodeId, altaFor(till.tillId, saleId, i, i)),
    );
  }
}

/**
 * Runs one statement against `registros_facturacion` with its append-only triggers out of the way.
 *
 * Taking those triggers down is the point: the fact that corrupting a stored record needs the
 * immutability control removed first is that control working. Nothing on the application's own
 * write path reaches this code.
 *
 * SQLite has no `DISABLE TRIGGER`, so each trigger is dropped and recreated from the text SQLite
 * stored for it, as `packages/db/src/testing/venue-db.ts`'s per-test reset does. The triggers are
 * READ off `sqlite_master` rather than named here, so a rename cannot leave this helper silently
 * dropping nothing; the empty case throws for the same reason.
 */
async function withoutImmutability(statement: SQL): Promise<void> {
  const triggers = pg.db.all<{ name: string; sql: string }>(
    sql`select name, sql from sqlite_master
        where type = 'trigger' and tbl_name = 'registros_facturacion' order by name`,
  );
  if (triggers.length === 0) {
    throw new Error("registros_facturacion carries no append-only trigger to take down");
  }
  for (const trigger of triggers) pg.db.run(sql.raw(`drop trigger "${trigger.name}"`));
  try {
    await pg.db.execute(statement);
  } finally {
    // Replayed verbatim, never rebuilt: `sqlite_master.sql` is the statement the engine itself
    // kept, so what goes back is what was taken down.
    for (const trigger of triggers) pg.db.run(sql.raw(trigger.sql));
  }
}

/** Overwrites one column on one stored registro. */
async function corrupt(secuencia: number, column: string, value: string): Promise<void> {
  await withoutImmutability(
    sql`update registros_facturacion set ${sql.raw(column)} = ${value}
        where node_id = ${till.nodeId} and secuencia = ${secuencia}`,
  );
}

const BOGUS = "F".repeat(64);

describe("verifyChain — normal states", () => {
  it("reports nothing checked on an empty chain", async () => {
    // n is itself the first record: neither check runs, and that is normal.
    const result = await pg.db.transaction((tx) => verifyChain(tx, till.nodeId));
    expect(result).toEqual({ ok: true, checked: 0, issues: [] });
  });

  it("reports one record checked when n−1 carries PrimerRegistro=S", async () => {
    // There is no n−2, so the link check is vacuously true; only the recomputation applies, and
    // it passes.
    await appendAltas(1);
    const result = await pg.db.transaction((tx) => verifyChain(tx, till.nodeId));
    expect(result).toEqual({ ok: true, checked: 1, issues: [] });
  });

  it("reports two records checked once n−1 and n−2 both exist", async () => {
    await appendAltas(2);
    const result = await pg.db.transaction((tx) => verifyChain(tx, till.nodeId));
    expect(result).toEqual({ ok: true, checked: 2, issues: [] });
  });

  it("verifies across an alta/anulación boundary", async () => {
    // One chain, both record types, generation order. The recomputation must use the anulación's
    // five-field canonical string, not the alta's eight.
    await appendAltas(1);
    const saleId = await seedSale(pg.db, till, 2);
    await pg.db.transaction((tx) =>
      appendToChain(tx, till.nodeId, anulacionFor(till.tillId, saleId, 1, 5)),
    );
    const result = await pg.db.transaction((tx) => verifyChain(tx, till.nodeId));
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(2);
  });

  it("still stores a huella on every record it verified", async () => {
    await appendAltas(3);
    const { rows } = await pg.db.execute<{ huella: string }>(sql`
      select huella from registros_facturacion where node_id = ${till.nodeId} order by secuencia
    `);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.huella).toMatch(/^[0-9A-F]{64}$/);
  });
});

describe("verifyChain — detection", () => {
  it("detects tampering with n−1's own hashed content", async () => {
    // AEAT's link check is blind to this: n−1's pointer to n−2 is untouched. Only the
    // recomputation catches it, which is why we go beyond the letter.
    await appendAltas(2);
    await corrupt(2, "importe_total", "999.99");
    const result = await pg.db.transaction((tx) => verifyChain(tx, till.nodeId));
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toEqual(["predecessor-hash-mismatch"]);
  });

  it("detects a broken link from n−1 to n−2", async () => {
    // Corrupting n−2's OWN huella leaves n−1 internally consistent, so the recomputation passes
    // and only AEAT's link check fires. This is the case that proves the two checks are
    // complementary rather than one covering the other.
    await appendAltas(2);
    await corrupt(1, "huella", BOGUS);
    const result = await pg.db.transaction((tx) => verifyChain(tx, till.nodeId));
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toEqual(["predecessor-link-mismatch"]);
  });

  it("reports both failures when n−1's predecessor pointer is rewritten", async () => {
    // Rewriting anterior_huella breaks n−1's own hash AND its link, so both fire. `issues` is an
    // array, not a first-failure-wins field: an incident naming one of two problems sends staff
    // after half the story.
    await appendAltas(2);
    await corrupt(2, "anterior_huella", BOGUS);
    const result = await pg.db.transaction((tx) => verifyChain(tx, till.nodeId));
    expect(result.issues.map((i) => i.code).sort()).toEqual([
      "predecessor-hash-mismatch",
      "predecessor-link-mismatch",
    ]);
  });

  it("carries the expected and found values on a link failure", async () => {
    await appendAltas(2);
    const { rows: predecessorRows } = await pg.db.execute<{ huella: string }>(sql`
      select huella from registros_facturacion where node_id = ${till.nodeId} and secuencia = 1
    `);
    const predecessor = predecessorRows[0];
    await corrupt(1, "huella", BOGUS);
    const result = await pg.db.transaction((tx) => verifyChain(tx, till.nodeId));
    const link = result.issues.find((i) => i.code === "predecessor-link-mismatch");
    // expected: n−2's own huella as currently stored (the ground truth this check validates the
    // pointer against) — now BOGUS, since that is what we just corrupted.
    expect(link?.params.expected).toBe(BOGUS);
    // found: n−1's stored predecessor pointer, untouched by this corruption — still the ORIGINAL
    // value captured before corrupt() ran.
    expect(link?.params.found).toBe(predecessor?.huella);
  });

  it("omits expected and found entirely when the predecessor row is gone", async () => {
    // Object.hasOwn, not toBeUndefined: the latter cannot tell an absent key from a key explicitly
    // set to undefined, and a params object serialised into an incident row records those two
    // states differently.
    await appendAltas(2);
    await withoutImmutability(
      sql`delete from registros_facturacion where node_id = ${till.nodeId} and secuencia = 1`,
    );
    const result = await pg.db.transaction((tx) => verifyChain(tx, till.nodeId));
    const missing = result.issues.find((i) => i.code === "predecessor-missing");
    expect(missing).toBeDefined();
    expect(Object.hasOwn(missing!.params, "expected")).toBe(false);
    expect(Object.hasOwn(missing!.params, "found")).toBe(false);
  });

  it("locates the predecessor by chain position, never by invoice number", async () => {
    // Invoice numbers deliberately descend. A verifier that ordered by num_serie_factura would
    // compare the wrong pair and report a failure on an intact chain — noise indistinguishable
    // from a real incident.
    for (const [i, number] of [500, 44, 7].entries()) {
      const saleId = await seedSale(pg.db, till, number);
      await pg.db.transaction((tx) =>
        appendToChain(tx, till.nodeId, altaFor(till.tillId, saleId, number, i)),
      );
    }
    const result = await pg.db.transaction((tx) => verifyChain(tx, till.nodeId));
    expect(result).toEqual({ ok: true, checked: 2, issues: [] });
  });
});

describe("entorno is not part of the huella", () => {
  // The single most important test in this file. Two records built from IDENTICAL input, differing
  // ONLY in entorno, must produce the same huella — entorno is Waitron's own metadata, never
  // AEAT's, and if it ever reached computeHuella's input every chain written under one environment
  // would become unverifiable under the other.
  //
  // A DATABASE PER RECORD, not two fixtures in one: the two records must be byte-identical except
  // for `entorno`, and one database will not hold both — `registros_identidad_uq` does not carry
  // `node_id`. In its own database each record is also a *first* record (same `null` predecessor),
  // so any hash difference between the two can only come from entorno.
  const productionDb = useVenueDb({ migrations: TEST_MIGRATIONS });
  const preproductionDb = useVenueDb({ migrations: TEST_MIGRATIONS });

  async function appendOne(
    db: Database,
    entorno: Entorno,
  ): Promise<{ huella: string; stored: string | null }> {
    const fresh = await seedTill(db);
    const saleId = await seedSale(db, fresh, 1);
    const appended = await db.transaction((tx) =>
      appendToChain(tx, fresh.nodeId, altaFor(fresh.tillId, saleId, 1, 1, entorno)),
    );
    const row = await db.execute<{ entorno: string | null }>(
      sql`select entorno from registros_facturacion where id = ${appended.id}`,
    );
    return { huella: appended.huella, stored: row.rows[0]?.entorno ?? null };
  }

  it("hashes identically regardless of environment, because entorno is ours and not AEAT's", async () => {
    const a = await appendOne(productionDb.db, "production");
    const b = await appendOne(preproductionDb.db, "preproduction");
    expect(a.huella).toBe(b.huella);

    // Self-contained, not delegated to chain.test.ts's own "records the environment" test: without
    // this, a future regression in altaFor's entorno plumbing (e.g. it silently stopped forwarding
    // the argument) would leave both calls storing the SAME entorno and this test would still pass
    // — it would no longer be testing what its own name claims.
    expect([a.stored, b.stored]).toEqual(["production", "preproduction"]);
  });
});

describe("verifyChain — never blocks the sale", () => {
  it("returns rather than throws when verification fails", async () => {
    // The single most important assertion in this file. A throw propagates out of the sale
    // transaction and rolls the sale back, which is exactly what AEAT forbids: «la facturación
    // por este motivo NUNCA debe interrumpirse».
    await appendAltas(2);
    await corrupt(2, "importe_total", "999.99");
    const result = await pg.db.transaction((tx) => verifyChain(tx, till.nodeId));
    expect(result.ok).toBe(false);
  });

  it("chains the next record anyway after a detected corruption", async () => {
    // The teeth check, in full: corrupt a stored predecessor huella, art. 7.i detects
    // it, and the sale STILL COMPLETES. A test asserting the sale is blocked would enforce the
    // opposite of the requirement.
    await appendAltas(2);
    await corrupt(1, "huella", BOGUS);

    const saleId = await seedSale(pg.db, till, 3);
    const { verification, appended } = await pg.db.transaction(async (tx) => {
      const verification = await verifyChain(tx, till.nodeId);
      const appended = await appendToChain(tx, till.nodeId, altaFor(till.tillId, saleId, 3, 3));
      return { verification, appended };
    });

    expect(verification.ok).toBe(false);
    expect(appended.secuencia).toBe(3);
    const { rows } = await pg.db.execute<{
      secuencia: number;
      huella: string;
      anterior_huella: string | null;
    }>(sql`
      select secuencia, huella, anterior_huella
      from registros_facturacion where node_id = ${till.nodeId} order by secuencia
    `);
    expect(rows).toHaveLength(3);
    // And it chained onto the record that was actually there, corruption and all — the chain
    // continues, it does not fork or restart.
    expect(rows[2]?.anterior_huella).toBe(rows[1]?.huella);
    expect(rows[2]?.huella).toMatch(/^[0-9A-F]{64}$/);
  });

  it("hands the incident recorder a regime-neutral payload", async () => {
    // No huellas by that name, no registro rows, no chain vocabulary — the incident recorder must
    // work unchanged for a TicketBAI backend.
    await appendAltas(2);
    await corrupt(2, "importe_total", "999.99");
    const result = await pg.db.transaction((tx) => verifyChain(tx, till.nodeId));
    expect(Object.keys(result).sort()).toEqual(["checked", "issues", "ok"]);
    expect(Object.keys(result.issues[0]!).sort()).toEqual(["code", "params", "recordId"]);
  });
});
