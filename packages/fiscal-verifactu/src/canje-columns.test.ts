import {
  CORE_MIGRATIONS,
  asAppUser,
  captureError,
  pgErrorCode,
  pgErrorMessage,
  withTenant,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { FISCAL_MIGRATIONS } from "./migrations.js";
import { TENANT_A, seedTenantTillSif } from "../test/fixtures.js";

/**
 * The `destinatarios` column on `registros_facturacion` (migration 0011) and the defense-in-depth
 * CHECK that a `facturas_sustituidas` block may only sit on an F3.
 * docs/superpowers/plans/2026-08-02-f3-canje.md §2.2.
 *
 * PGlite (via usePgliteDb), matching this package's `rectificativa-columns.test.ts`: these are
 * jsonb round-trip, CHECK and trigger-backstop assertions, none of which needs the non-superuser
 * deployment role or lock contention that would require real Postgres (CLAUDE.md §4). The one
 * assertion that DOES — RLS still scopes the table after the column add — lives in
 * `canje-columns.rls.test.ts` against a real container.
 */
const pg = usePgliteDb({
  migrations: [CORE_MIGRATIONS, FISCAL_MIGRATIONS],
  setup: seedTenantTillSif,
});

// One shared PGlite database backs the whole file, so every insert must claim a fresh secuencia
// (registros_tenant_node_secuencia_uq) and a fresh num_serie (registros_identidad_uq).
let secuenciaSeq = 0;
function nextSecuencia(): number {
  secuenciaSeq += 1;
  return secuenciaSeq;
}

/** A jsonb bind fragment: the stringified value cast to jsonb, or a typed NULL. */
function jsonbParam(value: unknown) {
  return value === undefined || value === null
    ? sql`null::jsonb`
    : sql`${JSON.stringify(value)}::jsonb`;
}

interface RegistroFields {
  tipoFactura?: string | null;
  facturasSustituidas?: unknown;
  destinatarios?: unknown;
}

const A_DESTINATARIO = { IDDestinatario: [{ NombreRazon: "Cliente SL", NIF: "B99999999" }] };
const A_FACTURA_SUSTITUIDA = {
  IDFacturaSustituida: [
    { IDEmisorFactura: "89890001K", NumSerieFactura: "A/1", FechaExpedicionFactura: "20-07-2026" },
  ],
};

/**
 * Inserts one alta registro carrying the canje columns. Runs on the given executor — `pg.db`
 * (superuser, RLS bypassed) for the CHECK/jsonb tests, or an app-role transaction for the trigger
 * test. Positive totals throughout, as an F3 carries. `tipoFactura` defaults to 'F3'.
 */
async function insertRegistro(
  exec: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> },
  fields: RegistroFields = {},
): Promise<void> {
  const secuencia = nextSecuencia();
  await exec.execute(sql`
    insert into registros_facturacion (
      tenant_id, till_id, node_id, sif_id, sale_id, secuencia, tipo_registro,
      id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
      tipo_factura, facturas_sustituidas, destinatarios,
      descripcion_operacion, desglose, cuota_total, importe_total,
      primer_registro, sistema_informatico,
      fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella
    ) values (
      ${TENANT_A.id}, ${TENANT_A.tillId}, ${TENANT_A.nodeId}, ${TENANT_A.sifId}, ${TENANT_A.saleId},
      ${secuencia}, 'alta',
      '89890001K', ${"F/" + String(secuencia)}, '2026-07-20', 'Waitron SL',
      ${fields.tipoFactura === undefined ? "F3" : fields.tipoFactura},
      ${jsonbParam(fields.facturasSustituidas)},
      ${jsonbParam(fields.destinatarios)},
      'Canje de tiques simplificados', '[]'::jsonb, '21.43', '123.45',
      true, '{}'::jsonb,
      '2026-07-20T19:20:30+01:00', 60, '01', repeat('F', 64)
    )
  `);
}

describe("the destinatarios column is jsonb and round-trips", () => {
  it("stores and returns destinatarios verbatim", async () => {
    await insertRegistro(pg.db, { tipoFactura: "F3", destinatarios: A_DESTINATARIO });
    const { rows } = await pg.db.execute<{ destinatarios: unknown }>(
      sql`select destinatarios from registros_facturacion
           where destinatarios is not null order by secuencia desc limit 1`,
    );
    expect(rows[0]?.destinatarios).toEqual(A_DESTINATARIO);
  });

  it("accepts a null destinatarios on an ordinary alta", async () => {
    await expect(
      insertRegistro(pg.db, { tipoFactura: "F2", destinatarios: null }),
    ).resolves.toBeUndefined();
  });
});

describe("registros_facturas_sustituidas_f3_ck — a substitution block only on an F3", () => {
  it("accepts facturas_sustituidas on an F3", async () => {
    await expect(
      insertRegistro(pg.db, {
        tipoFactura: "F3",
        facturasSustituidas: A_FACTURA_SUSTITUIDA,
        destinatarios: A_DESTINATARIO,
      }),
    ).resolves.toBeUndefined();
  });

  it("accepts a null facturas_sustituidas on a non-F3 (the ordinary case)", async () => {
    await expect(
      insertRegistro(pg.db, { tipoFactura: "F2", facturasSustituidas: null }),
    ).resolves.toBeUndefined();
  });

  it("rejects a facturas_sustituidas sitting on a non-F3 tipo_factura", async () => {
    // Defense-in-depth (§2.2): FacturasSustituidas is the F3 canje block; it must never sit on an
    // F2 (or an R-type). PROVEN BY DELETION (manual, recorded in this task's report): with
    // registros_facturas_sustituidas_f3_ck removed from migration 0011, this exact insert succeeds.
    const error = await captureError(() =>
      insertRegistro(pg.db, { tipoFactura: "F2", facturasSustituidas: A_FACTURA_SUSTITUIDA }),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/registros_facturas_sustituidas_f3_ck/);
  });

  it("rejects a facturas_sustituidas sitting on a NULL tipo_factura", async () => {
    // The three-valued-logic hole, closed the same way registros_tipo_factura_rectificativa_ck
    // closes it (Copilot's finding on #46): written `facturas_sustituidas is null or tipo_factura =
    // 'F3'`, a NULL tipo_factura makes `NULL = 'F3'` evaluate to NULL, which a CHECK treats as
    // PASSING — so a substitution block on an anulación-shaped row (no TipoFactura) would slip past.
    // The `tipo_factura is not null and` arm is what rejects it. PROVEN BY DELETION IN REVERSE:
    // against a constraint lacking that arm, this exact insert SUCCEEDS.
    const error = await captureError(() =>
      insertRegistro(pg.db, { tipoFactura: null, facturasSustituidas: A_FACTURA_SUSTITUIDA }),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/registros_facturas_sustituidas_f3_ck/);
  });
});

describe("the destinatarios column inherits the table's immutability", () => {
  async function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(pg.db, TENANT_A.id, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  class RollbackSignal extends Error {}

  it("refuses an UPDATE of destinatarios by the trigger backstop", async () => {
    // The table-wide reject_mutation() trigger (0001_registros_inmutables.sql) covers the new
    // column with NO new DDL. Revocation fires first for the app role, so — exactly as
    // rectificativa-columns.test.ts does — grant UPDATE inside a rolled-back transaction and watch
    // the SECOND layer (the trigger) catch it. WT001 is the trigger's SQLSTATE.
    await withTenant(pg.db, TENANT_A.id, async (tx) => {
      await tx.execute(sql`grant update on registros_facturacion to app_user`);
      await tx.execute(sql`set local role app_user`);
      await insertRegistro(tx, { tipoFactura: "F3", destinatarios: A_DESTINATARIO });
      const error = await captureError(() =>
        tx.execute(sql`update registros_facturacion set destinatarios = '{}'::jsonb`),
      );
      expect(pgErrorCode(error)).toBe("WT001");
      throw new RollbackSignal();
    }).catch((e: unknown) => {
      if (!(e instanceof RollbackSignal)) throw e;
    });
  });

  it("refuses an UPDATE of destinatarios as the app role, on privilege grounds", async () => {
    // The revocation layer that fires before the trigger is ever reached: app_user holds no UPDATE
    // on this table at all, so the column add did not quietly grant one.
    const error = await captureError(() =>
      asApp(async (tx) => {
        await insertRegistro(tx, { tipoFactura: "F3", destinatarios: A_DESTINATARIO });
        await tx.execute(sql`update registros_facturacion set destinatarios = '{}'::jsonb`);
      }),
    );
    expect(pgErrorCode(error)).toBe("42501");
  });
});
