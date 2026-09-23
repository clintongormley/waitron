import { asAppUser, withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { seedFiscalRegistro, insertFiscalRegistro } from "./testing/fiscal-fixtures.js";
import { ensureMirrorViewer, MIRROR_VIEWER_SESSION_ID } from "./mirror-session.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";

/**
 * This package's two shared fixtures, RUN against a real migrated venue database.
 *
 * They earn a suite of their own because a broken fixture does not fail where it is written: every
 * case in every file that calls one dies inside it, in `beforeAll`, before reaching the code under
 * test — which is what `seed-units.ts` did on this branch, in 101 stack frames across the package,
 * while nothing named it. Both carried SQL this engine refuses at PREPARE (`unrecognized token:
 * ":"`, from `::jsonb` and `array[...]`) and both relied on PostgreSQL column DEFAULTS that are
 * JavaScript generators now, which a raw insert never reaches (`NOT NULL constraint failed:
 * tenants.created_at`).
 */

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

describe("the shared fixtures seed a real migrated venue", () => {
  it("seeds the two legacy selling units with their names and precisions", async () => {
    await seedLegacySellingUnits(db);
    const { rows } = await withTransaction(db, async (tx) => {
      await asAppUser(tx);
      return tx.execute<{ seed_key: string; precision: number; hardware_unit: string | null }>(
        sql`select seed_key, precision, hardware_unit from units order by seed_key`,
      );
    });
    expect(rows).toEqual([
      { seed_key: "each", precision: 0, hardware_unit: null },
      { seed_key: "kg", precision: 3, hardware_unit: "kg" },
    ]);
  });

  it("seeds a fiscal registro with its whole FK closure, chain head and envío", async () => {
    const seeded = await seedFiscalRegistro(db, { cadena: true, envio: true });
    const { rows } = await db.execute<{
      huella: string;
      entorno: string;
      fecha: string;
      creado: string;
      chain: string;
      envio: string;
    }>(sql`
      select r.huella, r.entorno,
             r.fecha_hora_huso_gen_registro as fecha, r.creado_en as creado,
             c.ultima_huella as chain, e.estado as envio
      from registros_facturacion r
      join cadenas c on c.node_id = r.node_id
      join envios e on e.registro_id = r.id
      where r.id = ${seeded.registroId}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      huella: seeded.huella,
      entorno: "production",
      chain: seeded.huella,
      envio: "pendiente",
      // The `+01:00` literal the fixture states reaches the column as the UTC instant it names —
      // what PostgreSQL's `timestamptz` already did to it, and the one spelling that sorts
      // correctly here (`packages/printing/src/runtime.ts` has the measurement).
      fecha: "2026-07-20T18:20:30.000Z",
    });
    // `creado_en` has no SQL default any more: it comes from the column's own generator, which only
    // the insert BUILDER runs. A raw insert would have left it null and been refused.
    expect(Number.isNaN(Date.parse(rows[0]!.creado))).toBe(false);
  });

  it("plants a second registro on the same chain", async () => {
    // The two-step composition (`seedFiscalParents` + `insertFiscalRegistro`) other suites use to
    // put a registro on a database whose parents already exist.
    const first = await seedFiscalRegistro(db);
    const second = await insertFiscalRegistro(db, first, { secuencia: 2, numSerie: "A/2" });
    expect(second.secuencia).toBe(2);
    const { rows } = await db.execute<{ n: number }>(
      sql`select cast(count(*) as int) as n from registros_facturacion where node_id = ${first.nodeId}`,
    );
    expect(rows[0]!.n).toBe(2);
  });
});

describe("the mirror's ambient viewer is seeded on a real migrated venue", () => {
  // The two inserts the storage swap rewrote: both relied on PostgreSQL column defaults
  // (`persons.created_at`, `management_sessions.created_at` / `last_seen_at`) and the upsert
  // stamped `now()`. `mirror-session.test.ts` covers `ensureMirrorViewer` too and now runs
  // (9 passed, 2026-09-22); this case is kept because it drives it against the fixture module's
  // own migrated venue rather than that suite's.
  it("creates the viewer and its live session, and a second call revives rather than duplicates", async () => {
    await ensureMirrorViewer(db);
    await ensureMirrorViewer(db);
    const { rows } = await db.execute<{
      n: number;
      last_seen_at: string;
      ended_at: string | null;
    }>(sql`
      select cast(count(*) as int) as n, max(s.last_seen_at) as last_seen_at,
             max(s.ended_at) as ended_at
      from management_sessions s
      join persons p on p.id = s.person_id
      where s.id = ${MIRROR_VIEWER_SESSION_ID} and p.role = 'admin'`);
    expect(rows[0]!.n).toBe(1);
    expect(rows[0]!.ended_at).toBeNull();
    expect(Number.isNaN(Date.parse(rows[0]!.last_seen_at))).toBe(false);
  });
});
