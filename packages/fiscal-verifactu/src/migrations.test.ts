import {
  CORE_MIGRATIONS,
  captureError,
  pgErrorCode,
  pgErrorMessage,
  runMigrations,
} from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import type { Database } from "@waitron/db";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { RECUPERACION_ENVIANDO_MS } from "./drain.js";
import { FISCAL_MIGRATIONS } from "./migrations.js";

// PGlite exercises migration composition and predicates without concurrent writers.
let orderingError: unknown;
let namesAfterOrderingFailure: string[];
const pg = usePgliteDb({
  migrations: [],
  setup: async (db) => {
    orderingError = await captureError(() => runMigrations(db, FISCAL_MIGRATIONS));
    namesAfterOrderingFailure = await tableNames(db);
    for (const migrations of TEST_MIGRATIONS) await runMigrations(db, migrations);
  },
});
afterEach(async () => {
  await pg.db.execute(sql`delete from envios`);
});

async function tableNames(db: Database): Promise<string[]> {
  const rows = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
  );
  return rows.rows.map((r) => r.table_name);
}

/**
 * Unqualified, not `"drizzle".<table>` — `runMigrations` (packages/db/src/migrate.ts) hardcodes
 * `migrationsSchema: "public"` rather than accepting drizzle's own default of the `drizzle`
 * schema, matching what `drizzle.config.ts` fixes for this project's generated migrations. Both
 * journal tables therefore live in `public`, on the default search_path, exactly like
 * `packages/db/src/migrate.test.ts`'s own `countIn` helper reads them.
 */
async function journalCount(db: Database, table: string) {
  const rows = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(table)}`,
  );
  return rows.rows[0]?.n ?? 0;
}

describe("migration composition across packages", () => {
  it("applies the full manifest (core → … → sync → fiscal) against an empty database", async () => {
    const db = pg.db;

    const names = await tableNames(db);
    // Core's tables and the module's tables coexist in one schema, created by independent migration
    // sets. Fiscal is no longer applied on top of core alone: the capture triggers call
    // sync's `sync_capture()`, so the whole manifest is migrated (sync before fiscal) — the
    // production order (see ../test/migrations.ts).
    expect(names).toContain("sales");
    expect(names).toContain("tills");
    expect(names).toContain("registros_facturacion");
    expect(names).toContain("cadenas");
    expect(names).toContain("registro_sif");
    expect(names).toContain("envios");
  });

  it("keeps the two journals separate", async () => {
    const db = pg.db;

    // Two tables, both non-empty. One shared journal would make each package's next `generate`
    // read the other's entries as unknown and re-apply its own set from zero.
    expect(await journalCount(db, CORE_MIGRATIONS.migrationsTable)).toBeGreaterThan(0);
    expect(await journalCount(db, FISCAL_MIGRATIONS.migrationsTable)).toBeGreaterThan(0);
    expect(CORE_MIGRATIONS.migrationsTable).not.toBe(FISCAL_MIGRATIONS.migrationsTable);
    expect(CORE_MIGRATIONS.migrationsFolder).not.toBe(FISCAL_MIGRATIONS.migrationsFolder);
  });

  it("is idempotent — running both sets twice is a no-op", async () => {
    const db = pg.db;

    const before = [
      await journalCount(db, CORE_MIGRATIONS.migrationsTable),
      await journalCount(db, FISCAL_MIGRATIONS.migrationsTable),
      (await tableNames(db)).length,
    ];

    // No throw, and nothing applied a second time. The custom SQL in 0001 uses no IF NOT EXISTS
    // guards for the triggers, so a re-application would raise 42710
    // (duplicate_object) rather than pass quietly — which is the reason this test asserts on a
    // fresh run rather than on the counts alone.
    for (const migrations of TEST_MIGRATIONS) await runMigrations(db, migrations);

    expect([
      await journalCount(db, CORE_MIGRATIONS.migrationsTable),
      await journalCount(db, FISCAL_MIGRATIONS.migrationsTable),
      (await tableNames(db)).length,
    ]).toEqual(before);
  });

  it("fails when fiscal runs before core", async () => {
    // The failed first application leaves no fiscal tables before the ordered manifest runs.
    expect(pgErrorCode(orderingError)).toBe("42P01");
    expect(pgErrorMessage(orderingError)).toMatch(/relation .* does not exist/i);
    expect(namesAfterOrderingFailure).not.toContain("registros_facturacion");
  });
});

describe("envio_flujo migration", () => {
  it("creates envio_flujo with a tenant PK and both value columns not-null", async () => {
    const db = pg.db;
    const cols = await db.execute<{ column_name: string; is_nullable: string }>(sql`
      select column_name, is_nullable from information_schema.columns where table_name = 'envio_flujo'
    `);
    const byName = Object.fromEntries(cols.rows.map((c) => [c.column_name, c.is_nullable]));
    expect(byName).toMatchObject({
      tenant_id: "NO",
      proximo_envio_en: "NO",
      tiempo_espera_seg: "NO",
    });
  });
});

describe("acks migration", () => {
  it("creates acks with the required state and delivery columns", async () => {
    const db = pg.db;
    const cols = await db.execute<{ column_name: string; is_nullable: string }>(sql`
      select column_name, is_nullable from information_schema.columns where table_name = 'acks'
    `);
    const by = Object.fromEntries(cols.rows.map((c) => [c.column_name, c.is_nullable]));
    expect(by).toMatchObject({
      registro_id: "NO",
      tenant_id: "NO",
      submitted_at: "NO",
      state: "NO",
      delivered_at: "YES",
      csv: "YES",
    });
  });
});

describe("envios.reconciled_resubmit_at migration", () => {
  it("adds envios.reconciled_resubmit_at (nullable)", async () => {
    const db = pg.db;
    const cols = await db.execute<{ column_name: string; is_nullable: string }>(sql`
      select column_name, is_nullable from information_schema.columns
      where table_name = 'envios' and column_name = 'reconciled_resubmit_at'`);
    expect(cols.rows).toEqual([{ column_name: "reconciled_resubmit_at", is_nullable: "YES" }]);
  });
});

describe("registros_facturacion.entorno migration", () => {
  it("adds registros_facturacion.entorno (nullable)", async () => {
    const db = pg.db;
    const cols = await db.execute<{ column_name: string; is_nullable: string }>(sql`
      select column_name, is_nullable from information_schema.columns
      where table_name = 'registros_facturacion' and column_name = 'entorno'`);
    expect(cols.rows).toEqual([{ column_name: "entorno", is_nullable: "YES" }]);
  });

  it("rejects any value outside 'production'/'preproduction'", async () => {
    const db = pg.db;
    const error = await captureError(() =>
      db.execute(sql`
        insert into registros_facturacion (tenant_id, till_id, node_id, sif_id, sale_id, secuencia, tipo_registro,
          id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
          primer_registro, sistema_informatico,
          fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella, entorno)
        values (${"00000000-0000-4000-8000-000000000000"}, ${"00000000-0000-4000-8000-000000000000"},
          ${"00000000-0000-4000-8000-000000000000"}, ${"00000000-0000-4000-8000-000000000000"},
          ${"00000000-0000-4000-8000-000000000000"}, 1,
          'alta', '89890001K', 'A/1', '2026-07-20', 'Waitron SL', true, '{}'::jsonb,
          '2026-07-20T19:20:31+02:00', 120, '01', ${"0".repeat(64)}, ${"staging"})
      `),
    );
    expect(pgErrorCode(error)).toBe("23514"); // check_violation
  });
});

describe("envios drainer enumeration", () => {
  it("grants app_user EXECUTE on the enumeration and withholds PUBLIC EXECUTE", async () => {
    const db = pg.db;

    // app_user has EXECUTE; PUBLIC has no EXECUTE entry. aclexplode grantee 0 is PUBLIC.
    const [exec] = (
      await db.execute<{ app_user_exec: boolean; public_exec: boolean }>(sql`
        select
          has_function_privilege('app_user', 'envios_tenants_with_work(timestamptz)', 'EXECUTE') as app_user_exec,
          exists (
            select 1 from pg_proc p, aclexplode(p.proacl) acl
            where p.proname = 'envios_tenants_with_work'
              and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
          ) as public_exec
      `)
    ).rows;
    expect(exec).toEqual({ app_user_exec: true, public_exec: false });
  });

  it("enumerates only tenants with DUE work, matching drain.ts's predicate", async () => {
    // The same row is excluded before its due time and included at that time.
    const db = pg.db;
    const seeded = await seedPendingEnvios(db, { count: 1 });

    const due = await db.execute<{ tenant_id: string }>(
      sql`select tenant_id from envios_tenants_with_work('2026-07-21T00:00:00Z'::timestamptz) as t(tenant_id)`,
    );
    expect(due.rows.map((r) => r.tenant_id)).toEqual([seeded.tenantId]);

    const notYet = await db.execute<{ tenant_id: string }>(
      sql`select tenant_id from envios_tenants_with_work('2026-07-20T23:59:59Z'::timestamptz) as t(tenant_id)`,
    );
    expect(notYet.rows).toHaveLength(0);
  });

  it("enumerates a lone stale enviando row (no pendiente row) exactly at RECUPERACION_ENVIANDO_MS, pinning the SQL interval to the TS constant", async () => {
    // The enumeration function's `interval '300000 milliseconds'` and drain.ts's RECUPERACION_ENVIANDO_MS
    // (5 * 60_000 ms) are two separate literals across the TS/SQL boundary that "MUST stay in
    // sync" but cannot be derived from one source. Nothing before this test called that out — a
    // one-sided edit to either literal would drift silently, and if the SQL interval grew, a
    // stale `enviando` tenant would stop being enumerated and never reach `recoverStaleClaims`
    // (drain.ts's own doc comment on `tenantsWithWork` explains why that path must not be
    // skipped: a lone stuck `enviando` row has zero `pendiente` rows by definition).
    //
    // Two distinct tenants (seedPendingEnvios mints a fresh one per call), each flipped from its
    // seeded `pendiente` row to a lone `enviando` row so NEITHER has a `pendiente` row alongside —
    // one stamped just PAST the threshold, one just WITHIN it. If either literal drifts from the
    // other, one of the two assertions below fails.
    const db = pg.db;

    const now = new Date("2026-07-21T00:00:00Z");

    const stale = await seedPendingEnvios(db, { count: 1 });
    await db.execute(sql`
      update envios set estado = 'enviando',
        enviado_en = ${new Date(now.getTime() - (RECUPERACION_ENVIANDO_MS + 1000)).toISOString()}
      where tenant_id = ${stale.tenantId}
    `);

    const fresh = await seedPendingEnvios(db, { count: 1 });
    await db.execute(sql`
      update envios set estado = 'enviando',
        enviado_en = ${new Date(now.getTime() - (RECUPERACION_ENVIANDO_MS - 1000)).toISOString()}
      where tenant_id = ${fresh.tenantId}
    `);

    const due = await db.execute<{ tenant_id: string }>(
      sql`select tenant_id from envios_tenants_with_work(${now.toISOString()}::timestamptz) as t(tenant_id)`,
    );
    const tenantIds = due.rows.map((r) => r.tenant_id);
    expect(tenantIds).toContain(stale.tenantId);
    expect(tenantIds).not.toContain(fresh.tenantId);
  });
});
