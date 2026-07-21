import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  captureError,
  CORE_MIGRATIONS,
  createPgliteDb,
  pgErrorCode,
  runMigrations,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { buildAltaRecord, computeHuella, formatDateTime } from "@waitron/verifactu";
import { appendToChain, isUniqueViolation, lockChainHead } from "./chain.js";
import { FISCAL_MIGRATIONS } from "./migrations.js";
import { altaFor, anulacionFor, seedSale, seedTill, type SeededTill } from "./testing/seed.js";

let db: Database;
let till: SeededTill;

// No withTenant/asAppUser here, unlike registro-sif.test.ts: this suite is about appendToChain's
// OWN logic (ordering, error shape, the row lock's ability to serialise), never about RLS or role
// privilege, and PGlite's default connection is a superuser that bypasses RLS unconditionally
// regardless (see test/fixtures.ts's identical observation) — wrapping every call in withTenant
// here would add a set_config round trip that asserts nothing this suite is about.
beforeEach(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, FISCAL_MIGRATIONS);
  till = await seedTill(db);
});

afterAll(async () => {
  await db.close();
});

async function records(): Promise<
  {
    secuencia: number;
    huella: string;
    primer_registro: boolean;
    anterior_huella: string | null;
    num_serie_factura: string;
  }[]
> {
  const { rows } = await db.execute<{
    secuencia: number;
    huella: string;
    primer_registro: boolean;
    anterior_huella: string | null;
    num_serie_factura: string;
  }>(sql`
    select secuencia, huella, primer_registro, anterior_huella, num_serie_factura
    from registros_facturacion
    where till_id = ${till.tillId}
    order by secuencia
  `);
  return rows;
}

describe("appendToChain", () => {
  it("assigns secuencia 1 to the first record of a chain", async () => {
    const saleId = await seedSale(db, till, 1);
    const result = await db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.tillId, altaFor(saleId, 1, 1)),
    );
    expect(result.secuencia).toBe(1);
  });

  it("marks the first record PrimerRegistro=S and stores a huella anyway", async () => {
    // The trap from spec §5: on the first record the predecessor huella field is present but
    // EMPTY, and the record's own huella is still computed and stored. A start-of-chain is a
    // normal state, not an absence of hashing.
    const saleId = await seedSale(db, till, 1);
    await db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.tillId, altaFor(saleId, 1, 1)),
    );
    const [first] = await records();
    expect(first?.primer_registro).toBe(true);
    expect(first?.huella).toMatch(/^[0-9A-F]{64}$/);
    // Not merely falsy: an absent pointer and a pointer explicitly set to null are different
    // defects, and a truthiness check cannot tell them apart.
    expect(first?.anterior_huella).toBeNull();
  });

  it("chains the second record to the first via the four-part pointer", async () => {
    const a = await seedSale(db, till, 1);
    const b = await seedSale(db, till, 2);
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(a, 1, 1)));
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(b, 2, 2)));
    const [first, second] = await records();
    expect(second?.secuencia).toBe(2);
    expect(second?.primer_registro).toBe(false);
    expect(second?.anterior_huella).toBe(first?.huella);
  });

  it("advances the chain head to the record just written", async () => {
    const a = await seedSale(db, till, 1);
    const { huella } = await db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.tillId, altaFor(a, 1, 1)),
    );
    const { rows } = await db.execute<{ secuencia: number; ultima_huella: string }>(sql`
      select secuencia, ultima_huella from cadenas where till_id = ${till.tillId}
    `);
    expect(rows[0]?.secuencia).toBe(1);
    expect(rows[0]?.ultima_huella).toBe(huella);
  });

  it("interleaves alta and anulación in one chain in generation order", async () => {
    // Findings §1: it is a RECORD chain, not an invoice chain. A void does not start a second
    // chain and does not jump the queue.
    const a = await seedSale(db, till, 1);
    const b = await seedSale(db, till, 2);
    const c = await seedSale(db, till, 3);
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(a, 1, 1)));
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(b, 2, 2)));
    await db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.tillId, anulacionFor(b, 2, 3)),
    );
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(c, 3, 4)));
    const rows = await records();
    expect(rows.map((r) => r.secuencia)).toEqual([1, 2, 3, 4]);
    // The anulación links to the ALTA that preceded it in generation order, not to the record it
    // annuls — those are different pointers.
    expect(rows[2]?.anterior_huella).toBe(rows[1]?.huella);
    expect(rows[3]?.anterior_huella).toBe(rows[2]?.huella);
  });

  it("does not derive chain position from the invoice number", async () => {
    // AEAT's own sample chains invoice 12345 to predecessor invoice 44, which is structurally
    // impossible if position tracks the counter. This test fails the moment someone "helpfully"
    // couples them — by ordering on the number, by validating contiguity, or by deriving one from
    // the other.
    const a = await seedSale(db, till, 500);
    const b = await seedSale(db, till, 7);
    const c = await seedSale(db, till, 44);
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(a, 500, 1)));
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(b, 7, 2)));
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(c, 44, 3)));
    const rows = await records();
    expect(rows.map((r) => r.secuencia)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.num_serie_factura)).toEqual(["A/500", "A/7", "A/44"]);
  });

  it("keeps chain positions contiguous across a gap in invoice numbers", async () => {
    // Burned invoice numbers are permitted (a crash between allocation and commit). Chain
    // positions are ours and have no gaps.
    const a = await seedSale(db, till, 1);
    const b = await seedSale(db, till, 9);
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(a, 1, 1)));
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(b, 9, 2)));
    expect((await records()).map((r) => r.secuencia)).toEqual([1, 2]);
  });

  it("stores the exact literals that were hashed", async () => {
    // The "serialise once, hash that exact literal" rule, enforced at rest. 123.45 must come back
    // as the STRING "123.45" — not 123.45 the numeric, which would re-render as a different
    // literal and hash differently. Checked against a locally rebuilt record rather than a
    // hard-coded digest, so the test still names the property if AEAT's canonical string ever
    // gains a field.
    const a = await seedSale(db, till, 1);
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(a, 1, 1)));
    const { rows } = await db.execute<{
      importe_total: string;
      cuota_total: string;
      huella: string;
      // A raw db.execute(sql`...`) result is not tied to any schema column, so drizzle has no
      // PgColumn to run mapFromDriverValue through — unlike the query builder's typed .select(),
      // it hands back whatever the driver itself returns for a timestamptz, which is a plain
      // string here, not a JS Date.
      fecha_hora_huso_gen_registro: string;
      offset_minutos: number;
    }>(sql`
      select importe_total, cuota_total, huella, fecha_hora_huso_gen_registro, offset_minutos
      from registros_facturacion where till_id = ${till.tillId} and secuencia = 1
    `);
    const row = rows[0];
    expect(row?.importe_total).toBe("123.45");
    expect(row?.cuota_total).toBe("21.43");
    // fecha_hora_huso_gen_registro is a timestamptz: it stores the correct absolute instant but
    // cannot, by itself, tell you which offset the huella was hashed with. offset_minutos is what
    // makes the ORIGINAL literal reproducible, not merely a value equal to it in wall-clock terms.
    expect(formatDateTime(new Date(row!.fecha_hora_huso_gen_registro), row!.offset_minutos)).toBe(
      "2026-07-20T19:20:01+02:00",
    );
    const expected = buildAltaRecord({
      ...altaFor(a, 1, 1).input,
      Encadenamiento: { PrimerRegistro: "S" },
    });
    expect(computeHuella(expected)).toBe(row?.huella);
  });

  it("rejects a second record claiming an occupied chain position", async () => {
    const a = await seedSale(db, till, 1);
    const b = await seedSale(db, till, 2);
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(a, 1, 1)));
    // Bypasses appendToChain entirely: this is the backstop, and it must hold against a writer
    // that never took the lock. captureError + pgErrorCode, not `.rejects.toMatchObject({ code:
    // "23505" })` — drizzle wraps every failed query in a DrizzleQueryError whose own `.code` is
    // undefined; the real SQLSTATE lives on `.cause.code`, so a bare `.rejects.toMatchObject`
    // assertion never sees it and fails even against a correctly-enforced constraint.
    const error = await captureError(() =>
      db.execute(sql`
        insert into registros_facturacion (tenant_id, till_id, sif_id, sale_id, secuencia, tipo_registro,
          id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
          primer_registro, sistema_informatico,
          fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella)
        values (${till.tenantId}, ${till.tillId}, ${till.sifId}, ${b}, 1, 'alta', '89890001K', 'A/2',
          '2026-07-20', 'Waitron SL', true, '{}'::jsonb,
          '2026-07-20T19:20:31+02:00', 120, '01', ${"0".repeat(64)})
      `),
    );
    expect(pgErrorCode(error)).toBe("23505");
  });

  it("retries inside a savepoint, so a real collision does not poison the whole transaction", async () => {
    // Unlike the stubbed test below (which proves the RETRY BOUND deterministically, since PGlite
    // cannot generate three real CONCURRENT collisions), this one proves the SAVEPOINT itself,
    // deterministically, with no concurrency at all: a single writer, sequentially, against a
    // position that is ALREADY occupied before appendToChain ever runs. Every attempt collides for
    // the same reason, so this also reaches exhaustion — but it reaches it via three REAL 23505s
    // from Postgres, not a stubbed rejection, which only a savepoint per attempt can survive even
    // once. Without one (this is exactly what the mutation this test was written to catch does),
    // the first real 23505 aborts the OUTER transaction, and the second attempt's very first
    // statement fails immediately with 25P02 ("current transaction is aborted") — a code
    // isUniqueViolation does not recognise — so appendToChain rethrows that raw driver error
    // instead of ever reaching a clean, structured chain.append_contention.
    const occupied = await seedSale(db, till, 1);
    await db.execute(sql`
      insert into registros_facturacion (tenant_id, till_id, sif_id, sale_id, secuencia, tipo_registro,
        id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
        primer_registro, sistema_informatico,
        fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella)
      values (${till.tenantId}, ${till.tillId}, ${till.sifId}, ${occupied}, 1, 'alta', '89890001K', 'A/999',
        '2026-07-20', 'Waitron SL', true, '{}'::jsonb,
        '2026-07-20T19:20:31+02:00', 120, '01', ${"1".repeat(64)})
    `);

    const saleId = await seedSale(db, till, 2);
    const error = await db
      .transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(saleId, 2, 2)))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("chain.append_contention");
    expect((error as AppError).params).toEqual({
      tenantId: till.tenantId,
      tillId: till.tillId,
      attempts: 3,
    });
  });

  it("surfaces exhausted retries as a structured AppError, never a bare string", async () => {
    const saleId = await seedSale(db, till, 1);
    // Every savepoint attempt loses its race. Stubbing tx.transaction is the only way to reach
    // exhaustion deterministically: PGlite cannot generate three real collisions (see the file
    // that proves it), and a test that waited for one on real Postgres would be a flake by
    // construction. appendToChain touches only tx.transaction on this path, so the stub is
    // exactly that one method and nothing else — a wider fake would let the test keep passing if
    // the retry loop started doing something else.
    const alwaysCollides = {
      transaction: () => Promise.reject(Object.assign(new Error("dup"), { code: "23505" })),
    } as never;

    const error = await appendToChain(
      alwaysCollides,
      till.tenantId,
      till.tillId,
      altaFor(saleId, 1, 1),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("chain.append_contention");
    expect((error as AppError).params).toEqual({
      tenantId: till.tenantId,
      tillId: till.tillId,
      attempts: 3,
    });
  });

  it("does not retry an error that is not a chain collision", async () => {
    // A foreign-key violation retried three times is three identical failures reported as
    // contention, sending whoever reads the incident after a race that never happened.
    const saleId = await seedSale(db, till, 1);
    const alwaysFk = {
      transaction: () => Promise.reject(Object.assign(new Error("fk"), { code: "23503" })),
    } as never;

    const error = await appendToChain(
      alwaysFk,
      till.tenantId,
      till.tillId,
      altaFor(saleId, 1, 1),
    ).catch((caught: unknown) => caught);

    expect(error).not.toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "23503" });
  });
});

describe("lockChainHead", () => {
  it("creates the chain head row from scratch when a till has none yet", async () => {
    // Every other test in this file reaches lockChainHead through appendToChain on a till that
    // seedTill already provisioned via registerSif — which itself always inserts (or resets) a
    // cadenas row as its own last step (./registro-sif.ts). That leaves lockChainHead's OWN
    // create-the-head-if-missing branch — the one Task 14 exists to build, for "the residual
    // window where there is no head row yet to lock" — untouched by every test above. Deleting the
    // row this fixture's registerSif already created reproduces that cold-start state directly,
    // without inventing a second, non-SIF-registered kind of till fixture just to reach it.
    await db.execute(
      sql`delete from cadenas where tenant_id = ${till.tenantId} and till_id = ${till.tillId}`,
    );

    const head = await db.transaction((tx) => lockChainHead(tx, till.tenantId, till.tillId));
    expect(head).toEqual({ secuencia: 0, ultimoRegistroId: null, ultimaHuella: null });

    const { rows } = await db.execute<{ secuencia: number }>(
      sql`select secuencia from cadenas where tenant_id = ${till.tenantId} and till_id = ${till.tillId}`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.secuencia).toBe(0);
  });

  it("locks the existing head row rather than creating a second one", async () => {
    // The common case, exercised directly rather than only through appendToChain: a till that
    // already sold once must have lockChainHead read that same row, not silently create a rival.
    const saleId = await seedSale(db, till, 1);
    await db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.tillId, altaFor(saleId, 1, 1)),
    );

    const head = await db.transaction((tx) => lockChainHead(tx, till.tenantId, till.tillId));
    expect(head.secuencia).toBe(1);
    expect(head.ultimoRegistroId).not.toBeNull();
    expect(head.ultimaHuella).not.toBeNull();

    const { rows } = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from cadenas where tenant_id = ${till.tenantId} and till_id = ${till.tillId}`,
    );
    expect(rows[0]?.count).toBe(1);
  });
});

describe("isUniqueViolation", () => {
  it("recognises a bare driver error", () => {
    expect(isUniqueViolation(Object.assign(new Error("dup"), { code: "23505" }))).toBe(true);
  });

  it("recognises a violation wrapped in a cause chain", () => {
    // Drizzle wraps some driver errors; a guard that only inspects the top level silently stops
    // retrying and starts throwing the wrong error.
    const inner = Object.assign(new Error("dup"), { code: "23505" });
    expect(
      isUniqueViolation(new Error("outer", { cause: new Error("mid", { cause: inner }) })),
    ).toBe(true);
  });

  it("does not treat a foreign-key violation as a chain collision", () => {
    // 23503, not 23505. Retrying an FK violation loops pointlessly and then reports contention
    // that never happened.
    expect(isUniqueViolation(Object.assign(new Error("fk"), { code: "23503" }))).toBe(false);
  });

  it("terminates on a self-referential cause chain", () => {
    const looped: Error & { cause?: unknown } = new Error("loop");
    looped.cause = looped;
    expect(isUniqueViolation(looped)).toBe(false);
  });
});
