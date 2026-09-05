import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { appendToChain } from "./chain.js";
import type { Entorno } from "./registro-row.js";
import { verifyChain } from "./verify.js";
import { altaFor, anulacionFor, seedSale, seedTill, type SeededTill } from "./testing/seed.js";

// ONE database for the suite, reseeded per test — chain.test.ts's convention, for the same reason:
// `seedTill` mints a fresh tenant per call and every statement below (including `corrupt`'s UPDATE
// and the deletion in "omits expected and found") is scoped to that node's `node_id`, so an earlier
// test's rows are out of scope rather than something to clean up.
//
// Until 2026-07-31 this was a fresh PGlite per test closed by a single `afterAll` — one close for
// however many instances the run opened, leaving every one but the last alive for the whole run.
const pg = usePgliteDb({ migrations: TEST_MIGRATIONS });

let till: SeededTill;

beforeEach(async () => {
  till = await seedTill(pg.db);
});

/** Appends `n` altas in generation order. */
async function appendAltas(n: number): Promise<void> {
  for (let i = 1; i <= n; i++) {
    const saleId = await seedSale(pg.db, till, i);
    await pg.db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.nodeId, altaFor(till.tillId, saleId, i, i)),
    );
  }
}

/**
 * Overwrites one column on one stored registro.
 *
 * This needs the OWNER role and a disabled trigger, which is the point: the fact that corrupting
 * a row takes both is the immutability control working. Nothing the application role can do
 * reaches this code path — which is also why every immutability test must run as app_user, never
 * as the owner (see inmutabilidad.test.ts). PGlite's default connection IS the owner/superuser
 * (that file's own note), so no role switch is needed here to reach the trigger-disable step.
 *
 * Trigger name is `registros_facturacion_enforce_immutability`
 * (packages/fiscal-verifactu/drizzle/0001_registros_inmutables.sql) — NOT
 * `registros_facturacion_immutable` as an earlier draft of this file had it.
 */
async function corrupt(secuencia: number, column: string, value: string): Promise<void> {
  await pg.db.execute(
    sql`alter table registros_facturacion disable trigger registros_facturacion_enforce_immutability`,
  );
  await pg.db.execute(
    sql`update registros_facturacion set ${sql.raw(column)} = ${value}
        where node_id = ${till.nodeId} and secuencia = ${secuencia}`,
  );
  await pg.db.execute(
    sql`alter table registros_facturacion enable trigger registros_facturacion_enforce_immutability`,
  );
}

const BOGUS = "F".repeat(64);

describe("verifyChain — normal states", () => {
  it("reports nothing checked on an empty chain", async () => {
    // n is itself the first record: neither check runs, and that is normal.
    const result = await pg.db.transaction((tx) => verifyChain(tx, till.tenantId, till.nodeId));
    expect(result).toEqual({ ok: true, checked: 0, issues: [] });
  });

  it("reports one record checked when n−1 carries PrimerRegistro=S", async () => {
    // There is no n−2, so the link check is vacuously true; only the recomputation applies, and
    // it passes.
    await appendAltas(1);
    const result = await pg.db.transaction((tx) => verifyChain(tx, till.tenantId, till.nodeId));
    expect(result).toEqual({ ok: true, checked: 1, issues: [] });
  });

  it("reports two records checked once n−1 and n−2 both exist", async () => {
    await appendAltas(2);
    const result = await pg.db.transaction((tx) => verifyChain(tx, till.tenantId, till.nodeId));
    expect(result).toEqual({ ok: true, checked: 2, issues: [] });
  });

  it("verifies across an alta/anulación boundary", async () => {
    // One chain, both record types, generation order. The recomputation must use the anulación's
    // five-field canonical string, not the alta's eight.
    await appendAltas(1);
    const saleId = await seedSale(pg.db, till, 2);
    await pg.db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.nodeId, anulacionFor(till.tillId, saleId, 1, 5)),
    );
    const result = await pg.db.transaction((tx) => verifyChain(tx, till.tenantId, till.nodeId));
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
    const result = await pg.db.transaction((tx) => verifyChain(tx, till.tenantId, till.nodeId));
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toEqual(["predecessor-hash-mismatch"]);
  });

  it("detects a broken link from n−1 to n−2", async () => {
    // Corrupting n−2's OWN huella leaves n−1 internally consistent, so the recomputation passes
    // and only AEAT's link check fires. This is the case that proves the two checks are
    // complementary rather than one covering the other.
    await appendAltas(2);
    await corrupt(1, "huella", BOGUS);
    const result = await pg.db.transaction((tx) => verifyChain(tx, till.tenantId, till.nodeId));
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toEqual(["predecessor-link-mismatch"]);
  });

  it("reports both failures when n−1's predecessor pointer is rewritten", async () => {
    // Rewriting anterior_huella breaks n−1's own hash AND its link, so both fire. `issues` is an
    // array, not a first-failure-wins field: an incident naming one of two problems sends staff
    // after half the story.
    await appendAltas(2);
    await corrupt(2, "anterior_huella", BOGUS);
    const result = await pg.db.transaction((tx) => verifyChain(tx, till.tenantId, till.nodeId));
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
    const result = await pg.db.transaction((tx) => verifyChain(tx, till.tenantId, till.nodeId));
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
    await pg.db.execute(
      sql`alter table registros_facturacion disable trigger registros_facturacion_enforce_immutability`,
    );
    await pg.db.execute(
      sql`delete from registros_facturacion where node_id = ${till.nodeId} and secuencia = 1`,
    );
    await pg.db.execute(
      sql`alter table registros_facturacion enable trigger registros_facturacion_enforce_immutability`,
    );
    const result = await pg.db.transaction((tx) => verifyChain(tx, till.tenantId, till.nodeId));
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
        appendToChain(tx, till.tenantId, till.nodeId, altaFor(till.tillId, saleId, number, i)),
      );
    }
    const result = await pg.db.transaction((tx) => verifyChain(tx, till.tenantId, till.nodeId));
    expect(result).toEqual({ ok: true, checked: 2, issues: [] });
  });
});

describe("entorno is not part of the huella", () => {
  // The single most important test in this file. Two records built from IDENTICAL input, differing
  // ONLY in entorno, must produce the same huella — entorno is Waitron's own metadata, never
  // AEAT's, and if it ever reached computeHuella's input every chain written under one environment
  // would become unverifiable under the other.
  //
  // A FRESH tenant per call (via seedTill, never the shared module-scope `till`) is what makes both
  // records a *first* record — same `null` predecessor — so any hash difference between them can
  // only come from entorno.
  async function appendOne(entorno: Entorno): Promise<{ id: string; huella: string }> {
    const fresh = await seedTill(pg.db);
    const saleId = await seedSale(pg.db, fresh, 1);
    return pg.db.transaction((tx) =>
      appendToChain(tx, fresh.tenantId, fresh.nodeId, altaFor(fresh.tillId, saleId, 1, 1, entorno)),
    );
  }

  it("hashes identically regardless of environment, because entorno is ours and not AEAT's", async () => {
    const a = await appendOne("production");
    const b = await appendOne("preproduction");
    expect(a.huella).toBe(b.huella);

    // Self-contained, not delegated to chain.test.ts's own "records the environment" test: without
    // this, a future regression in altaFor's entorno plumbing (e.g. it silently stopped forwarding
    // the argument) would leave both calls storing the SAME entorno and this test would still pass
    // — it would no longer be testing what its own name claims.
    const stored = await pg.db.execute<{ entorno: string }>(
      sql`select entorno from registros_facturacion where id in (${a.id}, ${b.id}) order by entorno`,
    );
    expect(stored.rows.map((r) => r.entorno)).toEqual(["preproduction", "production"]);
  });
});

describe("verifyChain — never blocks the sale", () => {
  it("returns rather than throws when verification fails", async () => {
    // The single most important assertion in this file. A throw propagates out of the sale
    // transaction and rolls the sale back, which is exactly what AEAT forbids: «la facturación
    // por este motivo NUNCA debe interrumpirse».
    await appendAltas(2);
    await corrupt(2, "importe_total", "999.99");
    const result = await pg.db.transaction((tx) => verifyChain(tx, till.tenantId, till.nodeId));
    expect(result.ok).toBe(false);
  });

  it("chains the next record anyway after a detected corruption", async () => {
    // The spec §10 teeth check, in full: corrupt a stored predecessor huella, art. 7.i detects
    // it, and the sale STILL COMPLETES. A test asserting the sale is blocked would enforce the
    // opposite of the requirement — if you find yourself writing `.rejects` here, stop and
    // re-read spec §4.
    await appendAltas(2);
    await corrupt(1, "huella", BOGUS);

    const saleId = await seedSale(pg.db, till, 3);
    const { verification, appended } = await pg.db.transaction(async (tx) => {
      const verification = await verifyChain(tx, till.tenantId, till.nodeId);
      const appended = await appendToChain(
        tx,
        till.tenantId,
        till.nodeId,
        altaFor(till.tillId, saleId, 3, 3),
      );
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
    // What Task 18 receives. No huellas by that name, no registro rows, no chain vocabulary — it
    // must work unchanged for a TicketBAI backend.
    await appendAltas(2);
    await corrupt(2, "importe_total", "999.99");
    const result = await pg.db.transaction((tx) => verifyChain(tx, till.tenantId, till.nodeId));
    expect(Object.keys(result).sort()).toEqual(["checked", "issues", "ok"]);
    expect(Object.keys(result.issues[0]!).sort()).toEqual(["code", "params", "recordId"]);
  });
});
