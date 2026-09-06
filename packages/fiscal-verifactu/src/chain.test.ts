import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { captureError, pgErrorCode } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { AppError } from "@waitron/shared";
import { buildAltaRecord, computeHuella, formatDateTime } from "@waitron/verifactu";
import { appendToChain, isUniqueViolation, lockChainHead } from "./chain.js";
import { currentSif } from "./registro-sif.js";
import { altaFor, anulacionFor, seedSale, seedTill, type SeededTill } from "./testing/seed.js";

// ONE database for the suite, reseeded per test — chain.concurrency.test.ts's convention, and for
// its reason: `seedTill` mints a fresh tenant (and therefore a fresh NIF) per call, and every query
// below is scoped to that node's `node_id`, so a previous test's committed rows are simply out of
// scope rather than something to clean up. Nothing here can truncate `registros_facturacion`
// anyway — the append-only trigger blocks it (src/testing/seed.ts's own note).
//
// Until 2026-07-31 this was a fresh PGlite per test closed by a single `afterAll` — one close for
// however many instances the run opened, leaving every one but the last alive for the whole run.
const pg = usePgliteDb({ migrations: TEST_MIGRATIONS });

let till: SeededTill;

// PGlite exercises append ordering and error handling; concurrency lives in the real-PG suite.
beforeEach(async () => {
  till = await seedTill(pg.db);
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
  const { rows } = await pg.db.execute<{
    secuencia: number;
    huella: string;
    primer_registro: boolean;
    anterior_huella: string | null;
    num_serie_factura: string;
  }>(sql`
    select secuencia, huella, primer_registro, anterior_huella, num_serie_factura
    from registros_facturacion
    where node_id = ${till.nodeId}
    order by secuencia
  `);
  return rows;
}

describe("appendToChain", () => {
  it("assigns secuencia 1 to the first record of a chain", async () => {
    const saleId = await seedSale(pg.db, till, 1);
    const result = await pg.db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.nodeId, altaFor(till.tillId, saleId, 1, 1)),
    );
    expect(result.secuencia).toBe(1);
  });

  it("marks the first record PrimerRegistro=S and stores a huella anyway", async () => {
    // The trap from spec §5: on the first record the predecessor huella field is present but
    // EMPTY, and the record's own huella is still computed and stored. A start-of-chain is a
    // normal state, not an absence of hashing.
    const saleId = await seedSale(pg.db, till, 1);
    await pg.db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.nodeId, altaFor(till.tillId, saleId, 1, 1)),
    );
    const [first] = await records();
    expect(first?.primer_registro).toBe(true);
    expect(first?.huella).toMatch(/^[0-9A-F]{64}$/);
    // Not merely falsy: an absent pointer and a pointer explicitly set to null are different
    // defects, and a truthiness check cannot tell them apart.
    expect(first?.anterior_huella).toBeNull();
  });

  it("chains the second record to the first via the four-part pointer", async () => {
    const a = await seedSale(pg.db, till, 1);
    const b = await seedSale(pg.db, till, 2);
    await pg.db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.nodeId, altaFor(till.tillId, a, 1, 1)),
    );
    await pg.db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.nodeId, altaFor(till.tillId, b, 2, 2)),
    );
    const [first, second] = await records();
    expect(second?.secuencia).toBe(2);
    expect(second?.primer_registro).toBe(false);
    expect(second?.anterior_huella).toBe(first?.huella);
  });

  it("advances the chain head to the record just written", async () => {
    const a = await seedSale(pg.db, till, 1);
    const { huella } = await pg.db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.nodeId, altaFor(till.tillId, a, 1, 1)),
    );
    const { rows } = await pg.db.execute<{ secuencia: number; ultima_huella: string }>(sql`
      select secuencia, ultima_huella from cadenas where node_id = ${till.nodeId}
    `);
    expect(rows[0]?.secuencia).toBe(1);
    expect(rows[0]?.ultima_huella).toBe(huella);
  });

  it("interleaves alta and anulación in one chain in generation order", async () => {
    // Findings §1: it is a RECORD chain, not an invoice chain. A void does not start a second
    // chain and does not jump the queue.
    const a = await seedSale(pg.db, till, 1);
    const b = await seedSale(pg.db, till, 2);
    const c = await seedSale(pg.db, till, 3);
    await pg.db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.nodeId, altaFor(till.tillId, a, 1, 1)),
    );
    await pg.db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.nodeId, altaFor(till.tillId, b, 2, 2)),
    );
    await pg.db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.nodeId, anulacionFor(till.tillId, b, 2, 3)),
    );
    await pg.db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.nodeId, altaFor(till.tillId, c, 3, 4)),
    );
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
    const a = await seedSale(pg.db, till, 500);
    const b = await seedSale(pg.db, till, 7);
    const c = await seedSale(pg.db, till, 44);
    await pg.db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.nodeId, altaFor(till.tillId, a, 500, 1)),
    );
    await pg.db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.nodeId, altaFor(till.tillId, b, 7, 2)),
    );
    await pg.db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.nodeId, altaFor(till.tillId, c, 44, 3)),
    );
    const rows = await records();
    expect(rows.map((r) => r.secuencia)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.num_serie_factura)).toEqual(["A/500", "A/7", "A/44"]);
  });

  it("keeps chain positions contiguous across a gap in invoice numbers", async () => {
    // Burned invoice numbers are permitted (a crash between allocation and commit). Chain
    // positions are ours and have no gaps.
    const a = await seedSale(pg.db, till, 1);
    const b = await seedSale(pg.db, till, 9);
    await pg.db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.nodeId, altaFor(till.tillId, a, 1, 1)),
    );
    await pg.db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.nodeId, altaFor(till.tillId, b, 9, 2)),
    );
    expect((await records()).map((r) => r.secuencia)).toEqual([1, 2]);
  });

  it("stores the exact literals that were hashed", async () => {
    // The "serialise once, hash that exact literal" rule, enforced at rest. 123.45 must come back
    // as the STRING "123.45" — not 123.45 the numeric, which would re-render as a different
    // literal and hash differently. Checked against a locally rebuilt record rather than a
    // hard-coded digest, so the test still names the property if AEAT's canonical string ever
    // gains a field.
    const a = await seedSale(pg.db, till, 1);
    await pg.db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.nodeId, altaFor(till.tillId, a, 1, 1)),
    );
    const { rows } = await pg.db.execute<{
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
      from registros_facturacion where node_id = ${till.nodeId} and secuencia = 1
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
      ...altaFor(till.tillId, a, 1, 1).input,
      Encadenamiento: { PrimerRegistro: "S" },
    });
    expect(computeHuella(expected)).toBe(row?.huella);
  });

  it("records the environment the registro was generated for", async () => {
    const saleId = await seedSale(pg.db, till, 1);
    const appended = await pg.db.transaction((tx) =>
      appendToChain(
        tx,
        till.tenantId,
        till.nodeId,
        altaFor(till.tillId, saleId, 1, 1, "preproduction"),
      ),
    );

    const { rows } = await pg.db.execute<{ entorno: string }>(
      sql`select entorno from registros_facturacion where id = ${appended.id}`,
    );
    expect(rows[0]?.entorno).toBe("preproduction");
  });

  it("rejects a second record claiming an occupied chain position", async () => {
    const a = await seedSale(pg.db, till, 1);
    const b = await seedSale(pg.db, till, 2);
    await pg.db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.nodeId, altaFor(till.tillId, a, 1, 1)),
    );
    // Bypasses appendToChain entirely: this is the backstop, and it must hold against a writer
    // that never took the lock. captureError + pgErrorCode, not `.rejects.toMatchObject({ code:
    // "23505" })` — drizzle wraps every failed query in a DrizzleQueryError whose own `.code` is
    // undefined; the real SQLSTATE lives on `.cause.code`, so a bare `.rejects.toMatchObject`
    // assertion never sees it and fails even against a correctly-enforced constraint.
    const error = await captureError(() =>
      pg.db.execute(sql`
        insert into registros_facturacion (tenant_id, till_id, node_id, sif_id, sale_id, secuencia, tipo_registro,
          id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
          primer_registro, sistema_informatico,
          fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella)
        values (${till.tenantId}, ${till.tillId}, ${till.nodeId}, ${till.sifId}, ${b}, 1, 'alta', '89890001K', 'A/2',
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
    const occupied = await seedSale(pg.db, till, 1);
    await pg.db.execute(sql`
      insert into registros_facturacion (tenant_id, till_id, node_id, sif_id, sale_id, secuencia, tipo_registro,
        id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
        primer_registro, sistema_informatico,
        fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella)
      values (${till.tenantId}, ${till.tillId}, ${till.nodeId}, ${till.sifId}, ${occupied}, 1, 'alta', '89890001K', 'A/999',
        '2026-07-20', 'Waitron SL', true, '{}'::jsonb,
        '2026-07-20T19:20:31+02:00', 120, '01', ${"1".repeat(64)})
    `);

    const saleId = await seedSale(pg.db, till, 2);
    const error = await pg.db
      .transaction((tx) =>
        appendToChain(tx, till.tenantId, till.nodeId, altaFor(till.tillId, saleId, 2, 2)),
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("chain.append_contention");
    expect((error as AppError).params).toEqual({
      tenantId: till.tenantId,
      nodeId: till.nodeId,
      attempts: 3,
    });
  });

  it("surfaces exhausted retries as a structured AppError, never a bare string", async () => {
    const saleId = await seedSale(pg.db, till, 1);
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
      till.nodeId,
      altaFor(till.tillId, saleId, 1, 1),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("chain.append_contention");
    expect((error as AppError).params).toEqual({
      tenantId: till.tenantId,
      nodeId: till.nodeId,
      attempts: 3,
    });
  });

  it("does not retry an error that is not a chain collision", async () => {
    // A foreign-key violation retried three times is three identical failures reported as
    // contention, sending whoever reads the incident after a race that never happened.
    const saleId = await seedSale(pg.db, till, 1);
    const alwaysFk = {
      transaction: () => Promise.reject(Object.assign(new Error("fk"), { code: "23503" })),
    } as never;

    const error = await appendToChain(
      alwaysFk,
      till.tenantId,
      till.nodeId,
      altaFor(till.tillId, saleId, 1, 1),
    ).catch((caught: unknown) => caught);

    expect(error).not.toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "23503" });
  });
});

describe("appendToChain — pre-fetched SIF", () => {
  it("rejects a SIF that belongs to a different node", async () => {
    const saleId = await seedSale(pg.db, till, 1);
    await expect(
      pg.db.transaction(async (tx) => {
        const sif = await currentSif(tx, till.tenantId, till.nodeId);
        // A sif whose nodeId does not match the (tenant, node) being appended to — a caller bug the
        // dedup must never silently mis-attribute. A fabricated UUID stands in for another node.
        const wrongSif = {
          ...sif,
          nodeId: "ffffffff-0000-4000-8000-000000000000" as typeof sif.nodeId,
        };
        return appendToChain(
          tx,
          till.tenantId,
          till.nodeId,
          altaFor(till.tillId, saleId, 1, 1),
          wrongSif,
        );
      }),
    ).rejects.toThrow(/SIF/i);
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
    await pg.db.execute(
      sql`delete from cadenas where tenant_id = ${till.tenantId} and node_id = ${till.nodeId}`,
    );

    const head = await pg.db.transaction((tx) => lockChainHead(tx, till.tenantId, till.nodeId));
    expect(head).toEqual({ secuencia: 0, ultimoRegistroId: null, ultimaHuella: null });

    const { rows } = await pg.db.execute<{ secuencia: number }>(
      sql`select secuencia from cadenas where tenant_id = ${till.tenantId} and node_id = ${till.nodeId}`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.secuencia).toBe(0);
  });

  it("locks the existing head row rather than creating a second one", async () => {
    // The common case, exercised directly rather than only through appendToChain: a till that
    // already sold once must have lockChainHead read that same row, not silently create a rival.
    const saleId = await seedSale(pg.db, till, 1);
    await pg.db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.nodeId, altaFor(till.tillId, saleId, 1, 1)),
    );

    const head = await pg.db.transaction((tx) => lockChainHead(tx, till.tenantId, till.nodeId));
    expect(head.secuencia).toBe(1);
    expect(head.ultimoRegistroId).not.toBeNull();
    expect(head.ultimaHuella).not.toBeNull();

    const { rows } = await pg.db.execute<{ count: number }>(
      sql`select count(*)::int as count from cadenas where tenant_id = ${till.tenantId} and node_id = ${till.nodeId}`,
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
