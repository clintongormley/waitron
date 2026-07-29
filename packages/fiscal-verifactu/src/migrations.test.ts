import {
  CORE_MIGRATIONS,
  captureError,
  createPgliteDb,
  pgErrorCode,
  pgErrorMessage,
  runMigrations,
} from "@waitron/db";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { RECUPERACION_ENVIANDO_MS } from "./drain.js";
import { FISCAL_MIGRATIONS } from "./migrations.js";

/** A fresh in-memory PGlite with nothing in it at all. */
async function emptyDb() {
  return createPgliteDb();
}

async function tableNames(db: Awaited<ReturnType<typeof emptyDb>>): Promise<string[]> {
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
async function journalCount(db: Awaited<ReturnType<typeof emptyDb>>, table: string) {
  const rows = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(table)}`,
  );
  return rows.rows[0]?.n ?? 0;
}

describe("migration composition across packages", () => {
  it("applies core then fiscal against an empty database", async () => {
    const db = await emptyDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);

    const names = await tableNames(db);
    // Core's tables and the module's tables coexist in one schema, created by two independent
    // migration sets that know nothing of each other.
    expect(names).toContain("sales");
    expect(names).toContain("tills");
    expect(names).toContain("registros_facturacion");
    expect(names).toContain("cadenas");
    expect(names).toContain("registro_sif");
    expect(names).toContain("envios");
    await db.close();
  });

  it("keeps the two journals separate", async () => {
    const db = await emptyDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);

    // Two tables, both non-empty. One shared journal would make each package's next `generate`
    // read the other's entries as unknown and re-apply its own set from zero.
    expect(await journalCount(db, CORE_MIGRATIONS.migrationsTable)).toBeGreaterThan(0);
    expect(await journalCount(db, FISCAL_MIGRATIONS.migrationsTable)).toBeGreaterThan(0);
    expect(CORE_MIGRATIONS.migrationsTable).not.toBe(FISCAL_MIGRATIONS.migrationsTable);
    expect(CORE_MIGRATIONS.migrationsFolder).not.toBe(FISCAL_MIGRATIONS.migrationsFolder);
    await db.close();
  });

  it("is idempotent — running both sets twice is a no-op", async () => {
    const db = await emptyDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);

    const before = [
      await journalCount(db, CORE_MIGRATIONS.migrationsTable),
      await journalCount(db, FISCAL_MIGRATIONS.migrationsTable),
      (await tableNames(db)).length,
    ];

    // No throw, and nothing applied a second time. The custom SQL in 0001 uses no IF NOT EXISTS
    // guards for the trigger/policy objects, so a re-application would raise 42710
    // (duplicate_object) rather than pass quietly — which is the reason this test asserts on a
    // fresh run rather than on the counts alone.
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);

    expect([
      await journalCount(db, CORE_MIGRATIONS.migrationsTable),
      await journalCount(db, FISCAL_MIGRATIONS.migrationsTable),
      (await tableNames(db)).length,
    ]).toEqual(before);
    await db.close();
  });

  it("fails when fiscal runs before core", async () => {
    // THIS is what makes the first test mean anything. Ordering is the runtime's responsibility —
    // Drizzle enforces nothing — so a smoke test that would also pass with the sets applied in
    // the wrong order tests nothing at all. The failure is real: `cadenas` (the first table in
    // fiscal's 0000 snapshot, alphabetically) declares a foreign key onto `tenants`, a table
    // `packages/db` creates — so applying the fiscal folder first fails on a missing relation
    // before a single fiscal table finishes being created.
    //
    // `.rejects.toThrow(...)` does NOT work here: drizzle wraps the driver error in
    // `DrizzleQueryError`, whose OWN `.message` is `Failed query: <sql>\nparams: ...` — not the
    // real Postgres text. Verified live: asserting on `.rejects.toThrow(/relation .* does not
    // exist/i)` failed with the wrapper's generic message, not the underlying one. `pgErrorCode`/
    // `pgErrorMessage` unwrap `.cause` to reach the real driver error, exactly the pattern
    // packages/db/src/immutability.test.ts already uses for the same reason.
    const db = await emptyDb();
    const error = await captureError(() => runMigrations(db, FISCAL_MIGRATIONS));
    expect(pgErrorCode(error)).toBe("42P01"); // undefined_table
    expect(pgErrorMessage(error)).toMatch(/relation .* does not exist/i);

    // And the database is not half-built afterwards.
    expect(await tableNames(db)).not.toContain("registros_facturacion");
    await db.close();
  });
});

describe("envio_flujo migration", () => {
  it("creates envio_flujo with a tenant PK and both value columns not-null", async () => {
    const db = await emptyDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);
    const cols = await db.execute<{ column_name: string; is_nullable: string }>(sql`
      select column_name, is_nullable from information_schema.columns where table_name = 'envio_flujo'
    `);
    const byName = Object.fromEntries(cols.rows.map((c) => [c.column_name, c.is_nullable]));
    expect(byName).toMatchObject({
      tenant_id: "NO",
      proximo_envio_en: "NO",
      tiempo_espera_seg: "NO",
    });
    await db.close();
  });

  it("scopes envio_flujo to the calling tenant the same way envios and cadenas are scoped", async () => {
    // Existence is not correctness (packages/db/src/schema/sales.test.ts's own note on this): a
    // policy named right, on the right table, still renders nothing visible if its predicate is
    // wrong. So this reads `qual`/`with_check` (the USING/WITH CHECK expressions, as Postgres
    // renders them) by value, the same way, rather than merely asserting a row exists — proving
    // envio_flujo's policy is the exact tenant_isolation shape the other mutable tables in this
    // package (cadenas, registro_sif, envios) already carry, not just present under some name.
    const db = await emptyDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);

    const [policy] = (
      await db.execute<{
        policyname: string;
        cmd: string;
        qual: string;
        with_check: string;
      }>(sql`
        select policyname, cmd, qual, with_check from pg_policies
        where tablename = 'envio_flujo'
      `)
    ).rows;
    expect(policy).toEqual({
      policyname: "envio_flujo_tenant_isolation",
      cmd: "ALL",
      qual: "(tenant_id = current_tenant_id())",
      with_check: "(tenant_id = current_tenant_id())",
    });

    // FORCE, not just ENABLE: `.enableRLS()` in the Drizzle schema only emits ENABLE ROW LEVEL
    // SECURITY, which the table OWNER (who runs migrations) always bypasses regardless. FORCE is
    // what makes the policy above apply to the owner too, matching envios/cadenas/registro_sif —
    // see 0001_registros_inmutables.sql's identical FORCE statements for those three tables.
    const [relRow] = (
      await db.execute<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(sql`
        select relrowsecurity, relforcerowsecurity from pg_class where relname = 'envio_flujo'
      `)
    ).rows;
    expect(relRow).toEqual({ relrowsecurity: true, relforcerowsecurity: true });

    await db.close();
  });
});

describe("acks migration", () => {
  it("creates acks with tenant PK-less state CHECK and RLS", async () => {
    const db = await emptyDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);
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
    await db.close();
  });

  it("scopes acks to the calling tenant the same way envio_flujo is scoped", async () => {
    // Same by-value note as envio_flujo's policy test above: existence is not correctness, so
    // this reads qual/with_check from the catalog rather than merely asserting a row exists.
    const db = await emptyDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);

    const [policy] = (
      await db.execute<{
        policyname: string;
        cmd: string;
        qual: string;
        with_check: string;
      }>(sql`
        select policyname, cmd, qual, with_check from pg_policies
        where tablename = 'acks'
      `)
    ).rows;
    expect(policy).toEqual({
      policyname: "acks_tenant_isolation",
      cmd: "ALL",
      qual: "(tenant_id = current_tenant_id())",
      with_check: "(tenant_id = current_tenant_id())",
    });

    // FORCE, not just ENABLE — same rationale as envio_flujo's identical assertion above.
    const [relRow] = (
      await db.execute<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(sql`
        select relrowsecurity, relforcerowsecurity from pg_class where relname = 'acks'
      `)
    ).rows;
    expect(relRow).toEqual({ relrowsecurity: true, relforcerowsecurity: true });

    await db.close();
  });
});

describe("envios.reconciled_resubmit_at migration", () => {
  it("adds envios.reconciled_resubmit_at (nullable)", async () => {
    const db = await emptyDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);
    const cols = await db.execute<{ column_name: string; is_nullable: string }>(sql`
      select column_name, is_nullable from information_schema.columns
      where table_name = 'envios' and column_name = 'reconciled_resubmit_at'`);
    expect(cols.rows).toEqual([{ column_name: "reconciled_resubmit_at", is_nullable: "YES" }]);
    await db.close();
  });
});

describe("registros_facturacion.entorno migration", () => {
  it("adds registros_facturacion.entorno (nullable)", async () => {
    const db = await emptyDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);
    const cols = await db.execute<{ column_name: string; is_nullable: string }>(sql`
      select column_name, is_nullable from information_schema.columns
      where table_name = 'registros_facturacion' and column_name = 'entorno'`);
    expect(cols.rows).toEqual([{ column_name: "entorno", is_nullable: "YES" }]);
    await db.close();
  });

  it("rejects any value outside 'production'/'preproduction'", async () => {
    const db = await emptyDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);
    const error = await captureError(() =>
      db.execute(sql`
        insert into registros_facturacion (tenant_id, till_id, sif_id, sale_id, secuencia, tipo_registro,
          id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
          primer_registro, sistema_informatico,
          fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella, entorno)
        values (${"00000000-0000-4000-8000-000000000000"}, ${"00000000-0000-4000-8000-000000000000"},
          ${"00000000-0000-4000-8000-000000000000"}, ${"00000000-0000-4000-8000-000000000000"}, 1,
          'alta', '89890001K', 'A/1', '2026-07-20', 'Waitron SL', true, '{}'::jsonb,
          '2026-07-20T19:20:31+02:00', 120, '01', ${"0".repeat(64)}, ${"staging"})
      `),
    );
    expect(pgErrorCode(error)).toBe("23514"); // check_violation
    await db.close();
  });
});

describe("envios drainer enumeration seam (migration 0004)", () => {
  it("owns the cross-tenant enumeration with a SECURITY DEFINER function on a non-superuser, non-BYPASSRLS role", async () => {
    const db = await emptyDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);

    // The whole guarantee (0004's own comment, mirroring sales_assert_tenders_cover): SECURITY
    // DEFINER alone would go fail-CLOSED here — FORCE ROW LEVEL SECURITY subjects even the owner to
    // envios_tenant_isolation, which matches zero rows with no app.tenant_id — UNLESS the owner is a
    // role carrying a permissive policy. So the function must be SECURITY DEFINER, and owned by
    // envios_drainer, itself neither superuser nor BYPASSRLS (both are the heavier-hammer fix
    // 0005_sales.sql rejects because BYPASSRLS cannot be granted under the hardened migration role).
    const [fn] = (
      await db.execute<{
        prosecdef: boolean;
        rolname: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(sql`
        select p.prosecdef, r.rolname, r.rolsuper, r.rolbypassrls
        from pg_proc p join pg_roles r on r.oid = p.proowner
        where p.proname = 'envios_tenants_with_work'
      `)
    ).rows;
    expect(fn).toEqual({
      prosecdef: true,
      rolname: "envios_drainer",
      rolsuper: false,
      rolbypassrls: false,
    });

    // app_user (the one intended caller) can execute it; PUBLIC's default EXECUTE was revoked, so no
    // other role can invoke the cross-tenant enumeration. aclexplode grantee 0 is PUBLIC.
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

    await db.close();
  });

  it("scopes the permissive enumeration policy to the drainer role, SELECT-only, USING(true)", async () => {
    const db = await emptyDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);

    // Existence is not correctness (same note as envio_flujo's policy test above): read cmd/roles/
    // qual BY VALUE. This is the additive permissive policy the SECURITY DEFINER function sees rows
    // through — SELECT-only, scoped to envios_drainer, USING(true) — ORed with envios_tenant_isolation
    // for every other role. Flipping USING(true) to USING(false) here would silently turn the whole
    // seam back into the zero-row no-op it exists to fix. roles::text[] for the same driver reason
    // sales.test.ts documents (name[] oid 1003 is unparsed by node-postgres; 1009 is parsed).
    const policies = (
      await db.execute<{ policyname: string; cmd: string; roles: string[]; qual: string }>(sql`
        select policyname, cmd, roles::text[] as roles, qual from pg_policies
        where tablename = 'envios' and policyname = 'envios_drainer_enumeration'
      `)
    ).rows;
    expect(policies).toEqual([
      {
        policyname: "envios_drainer_enumeration",
        cmd: "SELECT",
        roles: ["envios_drainer"],
        qual: "true",
      },
    ]);

    await db.close();
  });

  it("enumerates only tenants with DUE work, matching drain.ts's predicate", async () => {
    // Functional guard on PGlite (superuser, so RLS is bypassed — this proves the PREDICATE, not the
    // RLS crossing; the crossing is proven under real app_user in drain.concurrency.test.ts). A
    // pendiente row due at p_now is enumerated; the same query one second BEFORE it comes due is not
    // — pinning the estado/proximo_intento_en predicate the function shares with tenantsWithWork.
    const db = await emptyDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);
    const seeded = await seedPendingEnvios(db, { count: 1 });

    const due = await db.execute<{ tenant_id: string }>(
      sql`select tenant_id from envios_tenants_with_work('2026-07-21T00:00:00Z'::timestamptz) as t(tenant_id)`,
    );
    expect(due.rows.map((r) => r.tenant_id)).toEqual([seeded.tenantId]);

    const notYet = await db.execute<{ tenant_id: string }>(
      sql`select tenant_id from envios_tenants_with_work('2026-07-20T23:59:59Z'::timestamptz) as t(tenant_id)`,
    );
    expect(notYet.rows).toHaveLength(0);

    await db.close();
  });

  it("enumerates a lone stale enviando row (no pendiente row) exactly at RECUPERACION_ENVIANDO_MS, pinning the SQL interval to the TS constant", async () => {
    // 0004's own comment: `interval '300000 milliseconds'` and drain.ts's RECUPERACION_ENVIANDO_MS
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
    const db = await emptyDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);

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

    await db.close();
  });
});
