import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { captureError, constraintTarget, isUniqueViolation } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError } from "@waitron/shared";
import { buildAltaRecord, computeHuella, formatDateTime } from "@waitron/verifactu";
import { registrosFacturacion } from "./schema/registros.js";
import { appendToChain, readChainHead } from "./chain.js";
import { currentSif } from "./registro-sif.js";
import { altaFor, anulacionFor, seedSale, seedTill, type SeededTill } from "./testing/seed.js";

// ONE database for the suite, reseeded per test — chain.concurrency.test.ts's convention, and for
// its reason: `seedTill` mints a fresh node (and therefore a fresh NIF) per call, and every query
// below is scoped to that node's `node_id`, so a previous test's committed rows are simply out of
// scope rather than something to clean up. Nothing here can truncate `registros_facturacion`
// anyway — the append-only trigger blocks it (src/testing/seed.ts's own note).
//
// Until 2026-07-31 this was a fresh PGlite per test closed by a single `afterAll` — one close for
// however many instances the run opened, leaving every one but the last alive for the whole run.
const pg = useVenueDb({ migrations: TEST_MIGRATIONS });

let till: SeededTill;

// This file covers append ordering and error handling; the simultaneously-started cases live in
// chain.concurrency.test.ts.
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
  // Through the table definition, not raw SQL: `primer_registro` is a flag, which this engine
  // stores as 0 or 1, and only the builder maps it back to a boolean. A raw read returns the
  // number, so `toBe(true)` reads `expected 1 to be true` against a perfectly correct row. The
  // keys are aliased to the column names so every assertion below is unchanged.
  return pg.db
    .select({
      secuencia: registrosFacturacion.secuencia,
      huella: registrosFacturacion.huella,
      primer_registro: registrosFacturacion.primerRegistro,
      anterior_huella: registrosFacturacion.anteriorHuella,
      num_serie_factura: registrosFacturacion.numSerieFactura,
    })
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.nodeId, till.nodeId))
    .orderBy(registrosFacturacion.secuencia);
}

describe("appendToChain", () => {
  it("assigns secuencia 1 to the first record of a chain", async () => {
    const saleId = await seedSale(pg.db, till, 1);
    const result = await pg.db.transaction((tx) =>
      appendToChain(tx, till.nodeId, altaFor(till.tillId, saleId, 1, 1)),
    );
    expect(result.secuencia).toBe(1);
  });

  it("marks the first record PrimerRegistro=S and stores a huella anyway", async () => {
    // The trap from spec §5: on the first record the predecessor huella field is present but
    // EMPTY, and the record's own huella is still computed and stored. A start-of-chain is a
    // normal state, not an absence of hashing.
    const saleId = await seedSale(pg.db, till, 1);
    await pg.db.transaction((tx) =>
      appendToChain(tx, till.nodeId, altaFor(till.tillId, saleId, 1, 1)),
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
    await pg.db.transaction((tx) => appendToChain(tx, till.nodeId, altaFor(till.tillId, a, 1, 1)));
    await pg.db.transaction((tx) => appendToChain(tx, till.nodeId, altaFor(till.tillId, b, 2, 2)));
    const [first, second] = await records();
    expect(second?.secuencia).toBe(2);
    expect(second?.primer_registro).toBe(false);
    expect(second?.anterior_huella).toBe(first?.huella);
  });

  it("advances the chain head to the record just written", async () => {
    const a = await seedSale(pg.db, till, 1);
    const { huella } = await pg.db.transaction((tx) =>
      appendToChain(tx, till.nodeId, altaFor(till.tillId, a, 1, 1)),
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
    await pg.db.transaction((tx) => appendToChain(tx, till.nodeId, altaFor(till.tillId, a, 1, 1)));
    await pg.db.transaction((tx) => appendToChain(tx, till.nodeId, altaFor(till.tillId, b, 2, 2)));
    await pg.db.transaction((tx) =>
      appendToChain(tx, till.nodeId, anulacionFor(till.tillId, b, 2, 3)),
    );
    await pg.db.transaction((tx) => appendToChain(tx, till.nodeId, altaFor(till.tillId, c, 3, 4)));
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
      appendToChain(tx, till.nodeId, altaFor(till.tillId, a, 500, 1)),
    );
    await pg.db.transaction((tx) => appendToChain(tx, till.nodeId, altaFor(till.tillId, b, 7, 2)));
    await pg.db.transaction((tx) => appendToChain(tx, till.nodeId, altaFor(till.tillId, c, 44, 3)));
    const rows = await records();
    expect(rows.map((r) => r.secuencia)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.num_serie_factura)).toEqual(["A/500", "A/7", "A/44"]);
  });

  it("keeps chain positions contiguous across a gap in invoice numbers", async () => {
    // Burned invoice numbers are permitted (a crash between allocation and commit). Chain
    // positions are ours and have no gaps.
    const a = await seedSale(pg.db, till, 1);
    const b = await seedSale(pg.db, till, 9);
    await pg.db.transaction((tx) => appendToChain(tx, till.nodeId, altaFor(till.tillId, a, 1, 1)));
    await pg.db.transaction((tx) => appendToChain(tx, till.nodeId, altaFor(till.tillId, b, 9, 2)));
    expect((await records()).map((r) => r.secuencia)).toEqual([1, 2]);
  });

  it("stores the exact literals that were hashed", async () => {
    // The "serialise once, hash that exact literal" rule, enforced at rest. 123.45 must come back
    // as the STRING "123.45" — not 123.45 the numeric, which would re-render as a different
    // literal and hash differently. Checked against a locally rebuilt record rather than a
    // hard-coded digest, so the test still names the property if AEAT's canonical string ever
    // gains a field.
    const a = await seedSale(pg.db, till, 1);
    await pg.db.transaction((tx) => appendToChain(tx, till.nodeId, altaFor(till.tillId, a, 1, 1)));
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
      appendToChain(tx, till.nodeId, altaFor(till.tillId, saleId, 1, 1, "preproduction")),
    );

    const { rows } = await pg.db.execute<{ entorno: string }>(
      sql`select entorno from registros_facturacion where id = ${appended.id}`,
    );
    expect(rows[0]?.entorno).toBe("preproduction");
  });

  it("rejects a second record claiming an occupied chain position", async () => {
    const a = await seedSale(pg.db, till, 1);
    const b = await seedSale(pg.db, till, 2);
    await pg.db.transaction((tx) => appendToChain(tx, till.nodeId, altaFor(till.tillId, a, 1, 1)));
    // Bypasses appendToChain entirely: this is the backstop, and it must hold against a writer
    // that never took the lock. captureError + pgErrorCode, not `.rejects.toMatchObject({ code:
    // "23505" })` — drizzle wraps every failed query in a DrizzleQueryError whose own `.code` is
    // undefined; the real SQLSTATE lives on `.cause.code`, so a bare `.rejects.toMatchObject`
    // assertion never sees it and fails even against a correctly-enforced constraint.
    const error = await captureError(() =>
      pg.db.insert(registrosFacturacion).values({
        tillId: till.tillId,
        nodeId: till.nodeId,
        sifId: till.sifId,
        saleId: b,
        secuencia: 1,
        tipoRegistro: "alta",
        idEmisorFactura: "89890001K",
        numSerieFactura: "A/2",
        fechaExpedicionFactura: "2026-07-20",
        nombreRazonEmisor: "Waitron SL",
        primerRegistro: true,
        sistemaInformatico: {},
        fechaHoraHusoGenRegistro: new Date("2026-07-20T19:20:31+02:00"),
        offsetMinutos: 120,
        tipoHuella: "01",
        huella: "0".repeat(64),
      }),
    );
    // The class, and then WHICH key — stronger than the SQLSTATE this used to assert, which said
    // only that something unique was violated. This engine names the table and the columns for a
    // unique index over plain columns (`packages/db/src/constraint-target.ts`).
    expect(isUniqueViolation(error)).toBe(true);
    expect(constraintTarget(error)).toEqual({
      table: "registros_facturacion",
      columns: ["node_id", "secuencia"],
    });
  });

  it("retries inside a savepoint, so a real collision does not poison the whole transaction", async () => {
    // Unlike the stubbed test below (which proves the RETRY BOUND deterministically), this one
    // drives REAL refusals, with no concurrency at all: a single writer, sequentially, against a
    // position that is ALREADY occupied before appendToChain ever runs. Every attempt collides for
    // the same reason, so it reaches exhaustion through three refusals the database issued.
    //
    // What this case was ORIGINALLY written to catch was deleting the savepoint: on PostgreSQL the
    // first 23505 aborted the outer transaction and the second attempt's first statement came back
    // 25P02, which isUniqueViolation does not recognise, so appendToChain rethrew a raw driver
    // error instead of chain.append_contention. That mechanism is gone — SQLite backs out the
    // refused statement and leaves the transaction open.
    //
    // THE CONTROL HAS NOW BEEN RUN, and it says this case does NOT discriminate the savepoint on
    // this engine: replacing `tx.transaction((nested) => attemptAppend(nested, …))` with a plain
    // `attemptAppend(tx, …)` leaves this case PASSING. The cases that stub `tx` go red under that
    // deletion and none of them is evidence either — each stub has a `transaction` method and
    // nothing else, so they fail because the stub has no other method, not because the savepoint
    // matters.
    //
    // So this is a case about exhaustion surfacing as a structured error, and the savepoint is
    // held by nothing here. Its remaining job (undoing what a losing attempt wrote before the
    // refused statement) is not reachable from this path either: the refused insert is the FIRST
    // write an attempt makes, and the only earlier write is `readChainHead` creating a missing
    // head row, which is idempotent. CLAUDE.md §4, "a proof-by-deletion belongs to the SHAPE of
    // the code it was taken against" — the shape changed and the proof did not survive it.
    // "lands the record on the retry after a refused first attempt" shows a rollback to the
    // attempt's savepoint removing a write, but its wrapper, like the stubs, has only a
    // `transaction` method, so deleting appendToChain's savepoint fails it for that reason alone
    // and the savepoint is still held by no case.
    const occupied = await seedSale(pg.db, till, 1);
    await pg.db.insert(registrosFacturacion).values({
      tillId: till.tillId,
      nodeId: till.nodeId,
      sifId: till.sifId,
      saleId: occupied,
      secuencia: 1,
      tipoRegistro: "alta",
      idEmisorFactura: "89890001K",
      numSerieFactura: "A/999",
      fechaExpedicionFactura: "2026-07-20",
      nombreRazonEmisor: "Waitron SL",
      primerRegistro: true,
      sistemaInformatico: {},
      fechaHoraHusoGenRegistro: new Date("2026-07-20T19:20:31+02:00"),
      offsetMinutos: 120,
      tipoHuella: "01",
      huella: "1".repeat(64),
    });

    const saleId = await seedSale(pg.db, till, 2);
    const error = await pg.db
      .transaction((tx) => appendToChain(tx, till.nodeId, altaFor(till.tillId, saleId, 2, 2)))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("chain.append_contention");
    expect((error as AppError).params).toEqual({
      nodeId: till.nodeId,
      attempts: 3,
    });
  });

  it("surfaces exhausted retries as a structured AppError, never a bare string", async () => {
    const saleId = await seedSale(pg.db, till, 1);
    // Every savepoint attempt loses its race. Stubbing tx.transaction is the only way to reach
    // exhaustion deterministically: contention cannot produce three collisions here, because one
    // write transaction runs on the venue file at a time (chain.concurrency.test.ts's `holds a
    // second appender on the same chain until the first commits` watches the second body fail to
    // START), and the case above reaches three real refusals only by occupying the position first,
    // with no concurrency at all. appendToChain touches only tx.transaction on this path, so the
    // stub is exactly that one method and nothing else — a wider fake would let the test keep
    // passing if the retry loop started doing something else.
    const alwaysCollides = {
      transaction: () =>
        Promise.reject(
          // The `errcode` + `message` pair this engine reports for a unique-index collision, not
          // the PostgreSQL SQLSTATE this used to carry. Copied from the real refusal
          // "rejects a second record claiming an occupied chain position" asserts on, so the stub
          // and the database agree.
          Object.assign(new Error("UNIQUE constraint failed: registros_facturacion.node_id"), {
            cause: {
              errcode: 2067,
              message:
                "UNIQUE constraint failed: registros_facturacion.node_id, registros_facturacion.secuencia",
            },
          }),
        ),
    } as never;

    const error = await appendToChain(
      alwaysCollides,
      till.nodeId,
      altaFor(till.tillId, saleId, 1, 1),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("chain.append_contention");
    expect((error as AppError).params).toEqual({
      nodeId: till.nodeId,
      attempts: 3,
    });
  });

  it("lands the record on the retry after a refused first attempt, and the refused attempt leaves nothing behind", async () => {
    // The middle of the loop, between the first-attempt cases at the top of this block and the
    // exhaustion cases above: one refusal the database really issued, then a clean second attempt.
    // The first attempt's savepoint plants a record at the position the attempt is about to compute
    // (the chain head still says 0), so the attempt's own insert is refused by the position's
    // unique index; rolling back to the savepoint takes the planted record with it, and the second
    // attempt passes straight through. The only thing wrapped is `transaction`, the one method
    // appendToChain calls on `tx`.
    // The controls that fail it are in the pull request that added it.
    const decoy = await seedSale(pg.db, till, 1);
    const saleId = await seedSale(pg.db, till, 2);
    let calls = 0;
    let firstRefusal: unknown;

    const result = await pg.db.transaction((tx) => {
      const refusedOnce = {
        transaction: <T>(body: (nested: typeof tx) => Promise<T>): Promise<T> => {
          calls += 1;
          if (calls > 1) return tx.transaction(body);
          return tx
            .transaction(async (nested) => {
              await nested.insert(registrosFacturacion).values({
                tillId: till.tillId,
                nodeId: till.nodeId,
                sifId: till.sifId,
                saleId: decoy,
                secuencia: 1,
                tipoRegistro: "alta",
                idEmisorFactura: "89890001K",
                numSerieFactura: "A/999",
                fechaExpedicionFactura: "2026-07-20",
                nombreRazonEmisor: "Waitron SL",
                primerRegistro: true,
                sistemaInformatico: {},
                fechaHoraHusoGenRegistro: new Date("2026-07-20T19:20:31+02:00"),
                offsetMinutos: 120,
                tipoHuella: "01",
                huella: "1".repeat(64),
              });
              return body(nested);
            })
            .catch((error: unknown) => {
              firstRefusal = error;
              throw error;
            });
        },
      } as never;
      return appendToChain(refusedOnce, till.nodeId, altaFor(till.tillId, saleId, 2, 2));
    });

    expect(calls).toBe(2);
    expect(constraintTarget(firstRefusal)).toEqual({
      table: "registros_facturacion",
      columns: ["node_id", "secuencia"],
    });
    const rows = await pg.db
      .select({
        id: registrosFacturacion.id,
        saleId: registrosFacturacion.saleId,
        secuencia: registrosFacturacion.secuencia,
        huella: registrosFacturacion.huella,
      })
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.nodeId, till.nodeId));
    expect(rows).toEqual([{ id: result.id, saleId, secuencia: 1, huella: result.huella }]);
    expect(result.secuencia).toBe(1);
    const { rows: head } = await pg.db.execute<{
      secuencia: number;
      ultimo_registro_id: string;
      ultima_huella: string;
    }>(sql`
      select secuencia, ultimo_registro_id, ultima_huella from cadenas where node_id = ${till.nodeId}
    `);
    expect(head).toEqual([
      { secuencia: 1, ultimo_registro_id: result.id, ultima_huella: result.huella },
    ]);
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
        const sif = await currentSif(tx, till.nodeId);
        // A sif whose nodeId does not match the node being appended to — a caller bug the
        // dedup must never silently mis-attribute. A fabricated UUID stands in for another node.
        const wrongSif = {
          ...sif,
          nodeId: "ffffffff-0000-4000-8000-000000000000" as typeof sif.nodeId,
        };
        return appendToChain(tx, till.nodeId, altaFor(till.tillId, saleId, 1, 1), wrongSif);
      }),
    ).rejects.toThrow(/SIF/i);
  });
});

describe("readChainHead", () => {
  it("creates the chain head row from scratch when a till has none yet", async () => {
    // Every other test in this file reaches readChainHead through appendToChain on a till that
    // seedTill already provisioned via registerSif — which itself always inserts (or resets) a
    // cadenas row as its own last step (./registro-sif.ts). That leaves readChainHead's OWN
    // create-the-head-if-missing branch — the one Task 14 exists to build, for "the residual
    // window where there is no head row yet to lock" — untouched by every test above. Deleting the
    // row this fixture's registerSif already created reproduces that cold-start state directly,
    // without inventing a second, non-SIF-registered kind of till fixture just to reach it.
    await pg.db.execute(sql`delete from cadenas where node_id = ${till.nodeId}`);

    const head = await pg.db.transaction((tx) => readChainHead(tx, till.nodeId));
    expect(head).toEqual({ secuencia: 0, ultimoRegistroId: null, ultimaHuella: null });

    const { rows } = await pg.db.execute<{ secuencia: number }>(
      sql`select secuencia from cadenas where node_id = ${till.nodeId}`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.secuencia).toBe(0);
  });

  it("locks the existing head row rather than creating a second one", async () => {
    // The common case, exercised directly rather than only through appendToChain: a till that
    // already sold once must have readChainHead read that same row, not silently create a rival.
    const saleId = await seedSale(pg.db, till, 1);
    await pg.db.transaction((tx) =>
      appendToChain(tx, till.nodeId, altaFor(till.tillId, saleId, 1, 1)),
    );

    const head = await pg.db.transaction((tx) => readChainHead(tx, till.nodeId));
    expect(head.secuencia).toBe(1);
    expect(head.ultimoRegistroId).not.toBeNull();
    expect(head.ultimaHuella).not.toBeNull();

    const { rows } = await pg.db.execute<{ count: number }>(
      sql`select count(*) as count from cadenas where node_id = ${till.nodeId}`,
    );
    expect(rows[0]?.count).toBe(1);
  });
});
