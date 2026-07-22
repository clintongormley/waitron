import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { captureError, pgErrorCode } from "@waitron/db";
import type { Database } from "@waitron/db";
import { appendToChain } from "./chain.js";
import { registerSif } from "./registro-sif.js";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import {
  altaFor,
  seedSale,
  seedTill,
  seedTillsForSifContention,
  TEST_SISTEMA,
  type SeededTill,
} from "./testing/seed.js";

const WRITERS = 20;

let pg: RealPostgres;
let admin: Database;
let till: SeededTill;
let other: SeededTill;

/**
 * Real PostgreSQL via Testcontainers — deliberately NOT `describe.skipIf(!dockerAvailable)`
 * anywhere in this file. `startRealPostgres` (./testing/postgres.ts) throws rather than degrading
 * to a skip when Docker is unavailable: a concurrency suite that silently vanishes reports a green
 * CI run that proves nothing about the one property this file exists to establish (spec's own
 * framing, restated in ./chain.pglite-cannot-test-contention.test.ts). If Docker genuinely is
 * unavailable in this environment, EVERY test below fails loudly with that thrown error, which is
 * the intended, load-bearing behaviour — not a defect in this file.
 */
beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();
});

afterAll(async () => {
  await admin.close();
  await pg.stop();
});

// No truncate-and-reseed here: registros_facturacion's append-only trigger
// (registros_facturacion_block_truncate) fires on a CASCADEd TRUNCATE from `tenants` too, and
// blocks it unconditionally — verified live, the immutable table cannot be wiped even by its own
// owner without first disabling that trigger. seedTill mints a FRESH tenant (and therefore a fresh
// nif) on every call instead, so each test's rows are simply new and independent of whatever a
// previous test already committed; nothing here ever needs the previous run's rows gone.
beforeEach(async () => {
  till = await seedTill(admin, "A");
  other = await seedTill(admin, "B");
});

describe("appendToChain under real contention", () => {
  it("runs its writers on distinct backend processes", async () => {
    // THE LOAD-BEARING ASSERTION. PGlite serialises every query onto one backend, so this returns
    // the same pid twice there and the rest of this suite would be theatre. If this ever fails,
    // nothing below it means anything, whatever colour it reports.
    const dbs = await Promise.all(Array.from({ length: WRITERS }, () => pg.connect()));
    try {
      const pids = await Promise.all(
        dbs.map(async (db) => {
          const { rows } = await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
          return rows[0]?.pid;
        }),
      );
      expect(new Set(pids).size).toBe(WRITERS);
    } finally {
      await Promise.all(dbs.map((db) => db.close()));
    }
  });

  it("commits all 20 concurrent appends to one chain", async () => {
    const dbs = await Promise.all(Array.from({ length: WRITERS }, () => pg.connect()));
    try {
      const sales = await Promise.all(dbs.map((_, i) => seedSale(admin, till, i + 1)));
      const results = await Promise.all(
        dbs.map((db, i) =>
          db.transaction((tx) =>
            appendToChain(tx, till.tenantId, till.tillId, altaFor(sales[i]!, i + 1, i)),
          ),
        ),
      );

      // Naive read-then-write committed 3 of 20 here (measured, see chain.ts's own doc comment).
      // Anything below 20 is that failure, not a flake.
      expect(results).toHaveLength(WRITERS);
      const { rows } = await admin.execute<{ count: number }>(sql`
        select count(*)::int as count from registros_facturacion where till_id = ${till.tillId}
      `);
      expect(rows[0]?.count).toBe(WRITERS);
    } finally {
      await Promise.all(dbs.map((db) => db.close()));
    }
  });

  it("assigns every concurrent append a distinct position with no gaps", async () => {
    const dbs = await Promise.all(Array.from({ length: WRITERS }, () => pg.connect()));
    try {
      const sales = await Promise.all(dbs.map((_, i) => seedSale(admin, till, i + 1)));
      await Promise.all(
        dbs.map((db, i) =>
          db.transaction((tx) =>
            appendToChain(tx, till.tenantId, till.tillId, altaFor(sales[i]!, i + 1, i)),
          ),
        ),
      );
      const { rows } = await admin.execute<{ secuencia: number }>(sql`
        select secuencia from registros_facturacion where till_id = ${till.tillId} order by secuencia
      `);
      expect(rows.map((r) => r.secuencia)).toEqual(
        Array.from({ length: WRITERS }, (_, i) => i + 1),
      );
    } finally {
      await Promise.all(dbs.map((db) => db.close()));
    }
  });

  it("leaves every record correctly chained to its predecessor", async () => {
    const dbs = await Promise.all(Array.from({ length: WRITERS }, () => pg.connect()));
    try {
      const sales = await Promise.all(dbs.map((_, i) => seedSale(admin, till, i + 1)));
      await Promise.all(
        dbs.map((db, i) =>
          db.transaction((tx) =>
            appendToChain(tx, till.tenantId, till.tillId, altaFor(sales[i]!, i + 1, i)),
          ),
        ),
      );
      const { rows } = await admin.execute<{
        secuencia: number;
        huella: string;
        anterior_huella: string | null;
        primer_registro: boolean;
      }>(sql`
        select secuencia, huella, anterior_huella, primer_registro
        from registros_facturacion where till_id = ${till.tillId} order by secuencia
      `);
      expect(rows[0]?.primer_registro).toBe(true);
      // Walking the WHOLE chain, not spot-checking the ends: a single crossed pair in the middle
      // is precisely what a lost race produces.
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i]?.anterior_huella).toBe(rows[i - 1]?.huella);
      }
    } finally {
      await Promise.all(dbs.map((db) => db.close()));
    }
  });

  it("blocks a second appender on the same chain", async () => {
    // Deterministic rather than timing-based: hold the head-row lock open, then prove a second
    // writer on that chain waits until lock_timeout.
    const holder = await pg.connect();
    const waiter = await pg.connect();
    let release: () => void = () => {};
    let holding: Promise<unknown> | undefined;
    try {
      const saleId = await seedSale(admin, till, 1);
      await admin.transaction((tx) =>
        appendToChain(tx, till.tenantId, till.tillId, altaFor(saleId, 1, 1)),
      );

      const held = new Promise<void>((resolve) => (release = resolve));
      // Wait until the holder has ACTUALLY taken the lock before racing the waiter. Without this the
      // waiter can win the race under load, acquire the still-free lock and SUCCEED — which fails the
      // assertion below AND leaves `holding` open forever (stuck on `await held`), so the finally's
      // holder.close() blocks on a transaction that never returns. That is the 120s hang this test
      // flaked with on CI (reproduced locally by delaying the holder's own lock acquisition).
      let acquire!: () => void;
      const acquired = new Promise<void>((resolve) => (acquire = resolve));
      holding = holder.transaction(async (tx) => {
        await tx.execute(sql`select 1 from cadenas where till_id = ${till.tillId} for update`);
        acquire();
        await held;
      });
      await acquired;

      const second = await seedSale(admin, till, 2);
      const error = await captureError(() =>
        waiter.transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout = '250ms'`);
          return appendToChain(tx, till.tenantId, till.tillId, altaFor(second, 2, 2));
        }),
      );
      // captureError + pgErrorCode, not `.rejects.toMatchObject({ code: "55P03" })` — the same
      // DrizzleQueryError-wrapping reason chain.test.ts's own bypass-insert test documents.
      expect(pgErrorCode(error)).toBe("55P03");
    } finally {
      // Always release the holder and settle its transaction BEFORE closing — an assertion failure
      // (or any throw) above must never leave the head-lock transaction open, or close() hangs.
      release();
      if (holding) await holding.catch(() => {});
      await holder.close();
      await waiter.close();
    }
  });

  it("does not block an appender on a different till", async () => {
    // Per-tenant and per-till parallelism is the reason the lock is on a row rather than an
    // advisory key: a busy till must never stall a quiet one.
    const holder = await pg.connect();
    const writer = await pg.connect();
    let release: () => void = () => {};
    let holding: Promise<unknown> | undefined;
    try {
      const first = await seedSale(admin, till, 1);
      await admin.transaction((tx) =>
        appendToChain(tx, till.tenantId, till.tillId, altaFor(first, 1, 1)),
      );

      const held = new Promise<void>((resolve) => (release = resolve));
      // Wait until the holder actually holds till A's lock before the writer touches till B —
      // otherwise this proves nothing (no lock was held), and a throw before release() would leave
      // `holding` open and hang the finally's close() (see the sibling test above).
      let acquire!: () => void;
      const acquired = new Promise<void>((resolve) => (acquire = resolve));
      holding = holder.transaction(async (tx) => {
        await tx.execute(sql`select 1 from cadenas where till_id = ${till.tillId} for update`);
        acquire();
        await held;
      });
      await acquired;

      const elsewhere = await seedSale(admin, other, 1);
      const result = await writer.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '250ms'`);
        return appendToChain(tx, other.tenantId, other.tillId, altaFor(elsewhere, 1, 1));
      });
      expect(result.secuencia).toBe(1);
    } finally {
      release();
      if (holding) await holding.catch(() => {});
      await holder.close();
      await writer.close();
    }
  });
});

describe("registerSif's installation-number counter under real contention", () => {
  // Deferred here from Task 13, which proved mintNumeroInstalacion correct BY CONSTRUCTION (one
  // statement — INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING — with no read-then-write
  // window for a second registration to slip into) but had no real-Postgres harness to prove it
  // under actual contention; this task built that harness for a different reason and this test
  // rides along, closing the tracked gap rather than leaving it deferred a second time.
  //
  // 20 DISTINCT tills of ONE obligado (one shared NIF), each registered exactly once, concurrently
  // — not fewer tills hit multiple times each. registerSif's revoke-then-insert is two statements,
  // and firing it twice concurrently against the SAME till races a DIFFERENT, out-of-scope hazard
  // (registro_sif_activo_uq, concurrent re-registration of one till — confirmed live: the first
  // version of this test tried 2 tills for 20 writers and failed there, not on the counter). This
  // fixture isolates the property Task 13 actually deferred: the (NIF, IdSistemaInformatico)
  // counter's own contention handling, exercised across many tills the way a chain's rollout to a
  // multi-till restaurant actually would.
  it("mints 20 distinct, strictly increasing installation numbers across many tills of one obligado", async () => {
    const fixture = await seedTillsForSifContention(admin, WRITERS);
    const dbs = await Promise.all(Array.from({ length: WRITERS }, () => pg.connect()));
    try {
      const results = await Promise.all(
        dbs.map((db, i) =>
          db.transaction((tx) =>
            registerSif(tx, {
              tenantId: fixture.tenantId,
              tillId: fixture.tillIds[i]!,
              nif: fixture.nif,
              idSistemaInformatico: TEST_SISTEMA.IdSistemaInformatico,
            }),
          ),
        ),
      );

      const numbers = results.map((r) => r.numeroInstalacion).sort((a, b) => a - b);
      expect(numbers).toEqual(Array.from({ length: WRITERS }, (_, i) => i + 1));
      expect(new Set(numbers).size).toBe(WRITERS);
    } finally {
      await Promise.all(dbs.map((db) => db.close()));
    }
  });
});
