import {
  CORE_MIGRATIONS,
  asAppUser,
  captureError,
  createPgliteDb,
  pgErrorCode,
  runMigrations,
  withTenant,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { FISCAL_MIGRATIONS } from "./migrations.js";
import { TENANT_A, seedTenantTillSif } from "../test/fixtures.js";

const pg = usePgliteDb({
  migrations: [CORE_MIGRATIONS, FISCAL_MIGRATIONS],
  setup: seedTenantTillSif,
});

/** Runs `fn` inside a tenant transaction, as the non-owner application role. */
async function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(pg.db, TENANT_A.id, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

async function insertRegistro(tx: Transaction, secuencia: number) {
  return tx.execute(sql`
    insert into registros_facturacion (
      tenant_id, till_id, sif_id, sale_id, secuencia, tipo_registro,
      id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
      tipo_factura, descripcion_operacion, desglose, cuota_total, importe_total,
      primer_registro, sistema_informatico,
      fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella
    ) values (
      ${TENANT_A.id}, ${TENANT_A.tillId}, ${TENANT_A.sifId}, ${TENANT_A.saleId},
      ${secuencia}, 'alta',
      '89890001K', ${"A/" + String(secuencia)}, '2026-07-20', 'Waitron SL',
      'F2', 'Venta en establecimiento', '[]'::jsonb, '12.35', '123.45',
      true, '{}'::jsonb,
      '2026-07-20T19:20:30+01:00', 60, '01', repeat('F', 64)
    ) returning id
  `);
}

class RollbackSignal extends Error {}

describe("registros_facturacion is immutable, as the app role", () => {
  it("is actually running as the non-owner application role", async () => {
    // Without this the whole file is theatre. Migrations run as owner; PGlite's default
    // connection is a SUPERUSER, and superusers bypass RLS and can DISABLE TRIGGER. A suite that
    // forgets `set local role` passes green while asserting nothing.
    const who = await asApp(async (tx) => {
      // pg_roles, NOT pg_user — verified live: pg_user is filtered to LOGIN-capable roles, and
      // app_user is created NOLOGIN (packages/db's 0001_tenancy_rls.sql: "a privilege bucket, not
      // a login"), so a `pg_user` lookup for it returns zero rows and the scalar subquery reads
      // back as NULL rather than `false` — passing `expect(who?.s).toBe(false)` for the wrong
      // reason if left uncaught (NULL and false both fail a truthiness check equally well; only
      // a strict `.toBe(false)` distinguishes "confirmed not super" from "role not found at
      // all"). pg_roles carries every role regardless of LOGIN.
      const result = await tx.execute<{ u: string; s: boolean }>(
        sql`select current_user as u, (select rolsuper from pg_roles where rolname = current_user) as s`,
      );
      return result.rows[0];
    });
    expect(who?.u).toBe("app_user");
    expect(who?.s).toBe(false);
  });

  it("permits INSERT", async () => {
    // The control. Without it, the three rejection tests below would all pass against a role that
    // simply has no access to the table at all — proving nothing about immutability.
    await expect(asApp((tx) => insertRegistro(tx, 1))).resolves.toBeDefined();
  });

  it("rejects UPDATE with insufficient_privilege", async () => {
    const error = await captureError(() =>
      asApp(async (tx) => {
        await insertRegistro(tx, 2);
        await tx.execute(sql`update registros_facturacion set huella = repeat('A', 64)`);
      }),
    );
    expect(pgErrorCode(error)).toBe("42501");
  });

  it("rejects DELETE with insufficient_privilege", async () => {
    const error = await captureError(() =>
      asApp(async (tx) => {
        await insertRegistro(tx, 3);
        await tx.execute(sql`delete from registros_facturacion`);
      }),
    );
    expect(pgErrorCode(error)).toBe("42501");
  });

  it("rejects UPDATE by trigger even when the privilege is granted", async () => {
    // The layered proof. Revocation fires first, so the two tests above never reach the trigger —
    // and a trigger nobody has ever seen fire is not a backstop, it is a comment. Grant the
    // privilege inside a transaction that rolls back, and watch the second layer catch it.
    await withTenant(pg.db, TENANT_A.id, async (tx) => {
      await tx.execute(sql`grant update, delete on registros_facturacion to app_user`);
      await tx.execute(sql`set local role app_user`);
      await insertRegistro(tx, 4);
      const error = await captureError(() =>
        tx.execute(sql`update registros_facturacion set huella = repeat('B', 64)`),
      );
      expect(pgErrorCode(error)).toBe("WT001");
      throw new RollbackSignal();
    }).catch((e: unknown) => {
      if (!(e instanceof RollbackSignal)) throw e;
    });
  });

  it("rejects TRUNCATE by statement trigger", async () => {
    // A row trigger does NOT fire on TRUNCATE. Without the separate BEFORE TRUNCATE … FOR EACH
    // STATEMENT trigger, TRUNCATE walks straight through every row-level protection above.
    //
    // CASCADE is required, not optional: THREE tables reference registros_facturacion.id —
    // `envios.registro_id` (the sidecar), `cadenas.ultimo_registro_id` (the chain-head pointer)
    // and `acks.registro_id` (the ack outbox, added in plan 3b) — and Postgres refuses a bare
    // TRUNCATE of a table other tables still reference. TRUNCATE also requires the privilege on
    // every table it cascades into, not only the one named in the statement. Verified live in the
    // red phase: granting TRUNCATE on registros_facturacion and envios alone still failed, with
    // 42501 for `cadenas` — the FK from its nullable `ultimo_registro_id` counts for cascade
    // purposes regardless of whether any row currently uses it; adding `acks` reproduced the same
    // 42501 until it too was granted. All three must be granted, or this test fails on a
    // permissions error and never reaches the statement trigger under test at all.
    await withTenant(pg.db, TENANT_A.id, async (tx) => {
      await tx.execute(
        sql`grant truncate on registros_facturacion, envios, cadenas, acks to app_user`,
      );
      await tx.execute(sql`set local role app_user`);
      const error = await captureError(() =>
        tx.execute(sql`truncate registros_facturacion cascade`),
      );
      expect(pgErrorCode(error)).toBe("WT001");
      throw new RollbackSignal();
    }).catch((e: unknown) => {
      if (!(e instanceof RollbackSignal)) throw e;
    });
  });
});

/**
 * The mechanical RLS guard, widened — this package's own copy of packages/db's
 * immutability.test.ts discovery block, keyed differently on purpose.
 *
 * Task 5's original guard (packages/db) discovered tables via `reject_mutation()` triggers, which
 * covers IMMUTABLE tables only. Every MUTABLE tenant-scoped table was silently unguarded by that
 * discovery query — a real gap, caught biting `invoice_series` and `working_order_lines` before
 * this package existed. `cadenas`, `registro_sif` and `envios` are exactly that shape here:
 * tenant-scoped and mutable, with no immutability trigger for a trigger-keyed discovery to find.
 *
 * So this copy keys discovery on "has a `tenant_id` column" instead — true of every tenant-scoped
 * table in this package regardless of mutability, and false of `contadores_instalacion`, which is
 * correctly excluded: it deliberately has no `tenant_id` and no RLS (findings §1 — a single
 * cross-tenant writer, where a tenant-scoping policy would itself be the bug).
 */
describe("row-level security on every tenant-scoped table in this package", () => {
  async function tenantScopedTables(
    target: Database,
  ): Promise<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]> {
    const result = await target.execute<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(sql`
      select distinct c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c
      join pg_attribute a
        on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
      where c.relkind = 'r'
        and c.relnamespace = 'public'::regnamespace
      order by c.relname
    `);
    return result.rows;
  }

  it("requires ENABLE and FORCE on every tenant_id-bearing table this package created", async () => {
    const tables = await tenantScopedTables(pg.db);
    const names = tables.map((t) => t.relname);

    // A guard that discovers nothing passes every assertion below it — the same shape of
    // vacuous test english-only.test.ts's "discovers source files" guards against. This package's
    // six tenant-scoped tables must all actually be found by this query, not merely assumed to
    // be, and contadores_instalacion — the one table in this package with NO tenant_id — must be
    // absent, proving the key is "has tenant_id", not "is in this package".
    expect(names).toContain("registros_facturacion");
    expect(names).toContain("cadenas");
    expect(names).toContain("registro_sif");
    expect(names).toContain("envios");
    expect(names).toContain("envio_flujo");
    expect(names).toContain("acks");
    expect(names).not.toContain("contadores_instalacion");

    // Reported as formatted lines rather than a bare boolean: a failure needs to say WHICH table
    // is missing WHICH flag, or the next person deletes the test instead of fixing the migration.
    const nonCompliant = tables
      .filter((t) => !t.relrowsecurity || !t.relforcerowsecurity)
      .map(
        (t) =>
          `${t.relname}: relrowsecurity=${String(t.relrowsecurity)} ` +
          `relforcerowsecurity=${String(t.relforcerowsecurity)}`,
      );
    expect(nonCompliant).toEqual([]);
  });

  it("the guard bites — a mutable table with FORCE but no ENABLE is flagged non-compliant", async () => {
    // Teeth check: immutability.sql.md's Part 4 warning made concrete. FORCE and CREATE POLICY
    // both succeed with no error when ENABLE was skipped — they are silently inert, not merely
    // unreliable — so a compliance check that only asked "did FORCE succeed" would stay green on
    // exactly the mistake this recipe warns about. A fresh database, not the suite's own `pg.db`:
    // this probe is scaffolding for the guard itself, not part of the product schema.
    const probeDb = await createPgliteDb();
    await runMigrations(probeDb, CORE_MIGRATIONS);
    await runMigrations(probeDb, FISCAL_MIGRATIONS);
    await probeDb.execute(sql`
      create table cadenas_rls_probe (
        tenant_id uuid not null,
        till_id uuid not null,
        secuencia integer not null default 0
      )
    `);
    // FORCE without ENABLE, deliberately — the exact bug this guard exists to catch.
    await probeDb.execute(sql`alter table cadenas_rls_probe force row level security`);

    const tables = await tenantScopedTables(probeDb);
    const probe = tables.find((t) => t.relname === "cadenas_rls_probe");
    expect(probe).toBeDefined();
    expect(probe?.relrowsecurity).toBe(false);
    // FORCE's own flag is set even though it does nothing without ENABLE — this is precisely why
    // relforcerowsecurity alone is not sufficient and the guard must check relrowsecurity too.
    expect(probe?.relforcerowsecurity).toBe(true);

    const nonCompliant = tables.filter((t) => !t.relrowsecurity || !t.relforcerowsecurity);
    expect(nonCompliant.map((t) => t.relname)).toContain("cadenas_rls_probe");

    await probeDb.close();
  });
});
