import { asAppUser, captureError, pgErrorCode, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { TENANT_A, seedTenantTillSif } from "../test/fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";

// Apply the whole manifest so the guard sees every module's append-only triggers.
// PGlite provides the trigger catalog and rejection paths without concurrent writers.
const pg = usePgliteDb({
  migrations: TEST_MIGRATIONS,
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
      tenant_id, till_id, node_id, sif_id, sale_id, secuencia, tipo_registro,
      id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
      tipo_factura, descripcion_operacion, desglose, cuota_total, importe_total,
      primer_registro, sistema_informatico,
      fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella
    ) values (
      ${TENANT_A.id}, ${TENANT_A.tillId}, ${TENANT_A.nodeId}, ${TENANT_A.sifId}, ${TENANT_A.saleId},
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
    // Require the application role before testing its grants; the default connection owns the tables.
    const who = await asApp(async (tx) => {
      // app_user is NOLOGIN, so look it up in pg_roles, which includes non-login roles.
      const result = await tx.execute<{ u: string; s: boolean }>(
        sql`select current_user as u, (select rolsuper from pg_roles where rolname = current_user) as s`,
      );
      return result.rows[0];
    });
    expect(who?.u).toBe("app_user");
    expect(who?.s).toBe(false);
  });

  it("permits INSERT", async () => {
    // Successful insertion is the control for the rejection cases.
    await expect(asApp((tx) => insertRegistro(tx, 1))).resolves.toBeDefined();
  });

  it("rejects UPDATE by trigger even when the privilege is granted", async () => {
    // Grant within a rolled-back transaction so the UPDATE reaches the rejection trigger.
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
    // TRUNCATE needs its own statement trigger. Grant access to every cascading table
    // inside the rolled-back transaction so privilege checks do not hide trigger execution.
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

/** Every append-only table keeps both rejection triggers active during replication. */
describe("every append-only trigger exists and fires for replication too (spec §1)", () => {
  const EXPECTED: Record<string, string[]> = {
    registros_facturacion: [
      "registros_facturacion_enforce_immutability",
      "registros_facturacion_block_truncate",
    ],
    sales: ["sales_enforce_immutability", "sales_block_truncate"],
    sale_lines: ["sale_lines_enforce_immutability", "sale_lines_block_truncate"],
    tenders: ["tenders_enforce_immutability", "tenders_block_truncate"],
    sale_voids: ["sale_voids_enforce_immutability", "sale_voids_block_truncate"],
    sale_settlements: ["sale_settlements_enforce_immutability", "sale_settlements_block_truncate"],
    sale_substitutions: [
      "sale_substitutions_enforce_immutability",
      "sale_substitutions_block_truncate",
    ],
    time_entries: ["time_entries_enforce_immutability", "time_entries_block_truncate"],
    daily_closes: ["daily_closes_immutable", "daily_closes_no_truncate"],
    order_amendments: ["order_amendments_enforce_immutability", "order_amendments_block_truncate"],
  };
  it("lists exactly the reject_mutation triggers, each ENABLE ALWAYS (tgenabled = 'A')", async () => {
    const { rows } = await pg.db.execute<{ table: string; name: string; enabled: string }>(sql`
      select c.relname as "table", t.tgname as name, t.tgenabled::text as enabled
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
      where not t.tgisinternal and p.proname = 'reject_mutation' order by 1, 2`);
    const byTable: Record<string, string[]> = {};
    for (const r of rows) (byTable[r.table] ??= []).push(r.name);
    expect(byTable).toEqual(
      Object.fromEntries(Object.entries(EXPECTED).map(([t, n]) => [t, [...n].sort()])),
    );
    expect(rows.filter((r) => r.enabled !== "A").map((r) => `${r.table}.${r.name}`)).toEqual([]);
  });
  it("the guard bites: a trigger left at the default fires only at origin", async () => {
    await pg.db.execute(
      sql`alter table registros_facturacion enable trigger registros_facturacion_block_truncate`,
    );
    try {
      const { rows } = await pg.db.execute<{ e: string }>(
        sql`select tgenabled::text as e from pg_trigger where tgname = 'registros_facturacion_block_truncate'`,
      );
      expect(rows[0]?.e).toBe("O");
    } finally {
      await pg.db.execute(
        sql`alter table registros_facturacion enable always trigger registros_facturacion_block_truncate`,
      );
    }
  });
});
