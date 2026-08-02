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
 * The four AEAT rectificativa columns on `registros_facturacion` (migration 0010) and their two
 * CHECK constraints. docs/superpowers/plans/2026-08-02-rectificativas.md §2.2.
 *
 * PGlite (via usePgliteDb), matching this package's own `inmutabilidad.test.ts`: these are CHECK,
 * jsonb round-trip and trigger-backstop assertions, none of which needs the non-superuser
 * deployment role or lock contention that would require real Postgres (CLAUDE.md §4). The one
 * assertion that DOES — RLS still scopes the table as a non-superuser after the column add — lives
 * in `rectificativa-columns.rls.test.ts` against a real container, mirroring this package's other
 * `*.rls.test.ts` files.
 */
const pg = usePgliteDb({
  migrations: [CORE_MIGRATIONS, FISCAL_MIGRATIONS],
  setup: seedTenantTillSif,
});

// One shared PGlite database backs the whole file, so every insert must claim a fresh secuencia
// (registros_tenant_till_secuencia_uq) and, since id_emisor/fecha/tipo_registro are constant, a
// fresh num_serie (registros_identidad_uq). A module counter gives both.
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
  tipoRectificativa?: string | null;
  facturasRectificadas?: unknown;
  facturasSustituidas?: unknown;
  importeRectificacion?: unknown;
}

/**
 * Inserts one alta registro carrying the rectificativa columns. Runs on the given executor —
 * `pg.db` (superuser, RLS bypassed) for the CHECK/jsonb tests, or an app-role transaction for the
 * trigger test. Negative totals throughout, as a rectificativa carries.
 */
async function insertRegistro(
  exec: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> },
  fields: RegistroFields = {},
): Promise<void> {
  const secuencia = nextSecuencia();
  await exec.execute(sql`
    insert into registros_facturacion (
      tenant_id, till_id, sif_id, sale_id, secuencia, tipo_registro,
      id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
      tipo_factura, tipo_rectificativa, facturas_rectificadas, facturas_sustituidas,
      importe_rectificacion, descripcion_operacion, desglose, cuota_total, importe_total,
      primer_registro, sistema_informatico,
      fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella
    ) values (
      ${TENANT_A.id}, ${TENANT_A.tillId}, ${TENANT_A.sifId}, ${TENANT_A.saleId},
      ${secuencia}, 'alta',
      '89890001K', ${"R/" + String(secuencia)}, '2026-07-20', 'Waitron SL',
      ${fields.tipoFactura === undefined ? "R5" : fields.tipoFactura},
      ${fields.tipoRectificativa ?? null},
      ${jsonbParam(fields.facturasRectificadas)},
      ${jsonbParam(fields.facturasSustituidas)},
      ${jsonbParam(fields.importeRectificacion)},
      'Rectificación de la venta', '[]'::jsonb, '-12.35', '-123.45',
      true, '{}'::jsonb,
      '2026-07-20T19:20:30+01:00', 60, '01', repeat('F', 64)
    )
  `);
}

describe("registros_tipo_rectificativa_ck — the value domain", () => {
  it("accepts tipo_rectificativa 'I' on a rectificativa", async () => {
    // The reachable v1 case: R5 + I (por diferencias), findings §10.2.
    await expect(
      insertRegistro(pg.db, { tipoFactura: "R5", tipoRectificativa: "I" }),
    ).resolves.toBeUndefined();
  });

  it("accepts tipo_rectificativa 'S' on a rectificativa", async () => {
    // 'S' (sustitución) is deferred at the app layer but permitted at the DB — the column's domain
    // is {S, I}, matching RegistroAlta["TipoRectificativa"].
    await expect(
      insertRegistro(pg.db, { tipoFactura: "R5", tipoRectificativa: "S" }),
    ).resolves.toBeUndefined();
  });

  it("accepts a null tipo_rectificativa on an ordinary alta", async () => {
    // The control: an ordinary F2 sale leaves all four columns NULL.
    await expect(
      insertRegistro(pg.db, { tipoFactura: "F2", tipoRectificativa: null }),
    ).resolves.toBeUndefined();
  });

  it("rejects an unknown tipo_rectificativa", async () => {
    // PROVEN BY DELETION (manual, recorded in this task's report): with
    // registros_tipo_rectificativa_ck removed from migration 0010, this exact insert succeeds.
    // The check is what rejects a value outside {S, I}.
    const error = await captureError(() =>
      insertRegistro(pg.db, { tipoFactura: "R5", tipoRectificativa: "X" }),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/registros_tipo_rectificativa_ck/);
  });
});

describe("registros_tipo_factura_rectificativa_ck — rule 1115 at the DB", () => {
  it("rejects a tipo_rectificativa sitting on a non-rectificativa tipo_factura", async () => {
    // Defense-in-depth (§2.2): a tipo_rectificativa may only appear on an R1–R5 invoice. An 'I'
    // on an F2 is the shape this check forbids.
    const error = await captureError(() =>
      insertRegistro(pg.db, { tipoFactura: "F2", tipoRectificativa: "I" }),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/registros_tipo_factura_rectificativa_ck/);
  });

  it("accepts a tipo_rectificativa on an R1 invoice too", async () => {
    // The pattern is `^R[1-5]$`, not R5 alone — R1 (deferred, but a valid rectificativa
    // TipoFactura) must satisfy it, or the check would over-constrain future work.
    await expect(
      insertRegistro(pg.db, { tipoFactura: "R1", tipoRectificativa: "I" }),
    ).resolves.toBeUndefined();
  });

  it("rejects a tipo_rectificativa sitting on a NULL tipo_factura", async () => {
    // The three-valued-logic hole (Copilot): with the constraint written
    // `tipo_rectificativa is null or tipo_factura ~ '^R[1-5]$'`, a NULL tipo_factura makes the
    // regex arm evaluate to NULL, and a CHECK treats NULL as PASSING — so a rectificativa field on
    // an anulación-shaped row (no TipoFactura) slipped past the rule-1115 backstop. PROVEN BY
    // DELETION IN REVERSE (recorded in this task's report): against the pre-fix constraint this
    // exact insert SUCCEEDS. The tightened `tipo_factura is not null and tipo_factura ~ '^R[1-5]$'`
    // is what rejects it.
    const error = await captureError(() =>
      insertRegistro(pg.db, { tipoFactura: null, tipoRectificativa: "I" }),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/registros_tipo_factura_rectificativa_ck/);
  });
});

describe("the rectificativa columns are jsonb and round-trip", () => {
  it("stores and returns facturas_rectificadas verbatim", async () => {
    const facturasRectificadas = {
      IDFacturaRectificada: [
        {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "A/1",
          FechaExpedicionFactura: "20-07-2026",
        },
      ],
    };
    await insertRegistro(pg.db, {
      tipoFactura: "R5",
      tipoRectificativa: "I",
      facturasRectificadas,
    });
    const { rows } = await pg.db.execute<{ facturas_rectificadas: unknown }>(
      sql`select facturas_rectificadas from registros_facturacion
           where facturas_rectificadas is not null order by secuencia desc limit 1`,
    );
    expect(rows[0]?.facturas_rectificadas).toEqual(facturasRectificadas);
  });

  it("stores and returns importe_rectificacion verbatim", async () => {
    const importeRectificacion = { BaseRectificada: "-100.00", CuotaRectificada: "-21.00" };
    await insertRegistro(pg.db, {
      tipoFactura: "R5",
      tipoRectificativa: "S",
      importeRectificacion,
    });
    const { rows } = await pg.db.execute<{ importe_rectificacion: unknown }>(
      sql`select importe_rectificacion from registros_facturacion
           where importe_rectificacion is not null order by secuencia desc limit 1`,
    );
    expect(rows[0]?.importe_rectificacion).toEqual(importeRectificacion);
  });
});

describe("the new columns inherit the table's immutability", () => {
  async function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(pg.db, TENANT_A.id, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  class RollbackSignal extends Error {}

  it("refuses an UPDATE of tipo_rectificativa by the trigger backstop", async () => {
    // Confirms the table-wide reject_mutation() trigger (0001_registros_inmutables.sql) covers the
    // new column with NO new DDL. Revocation fires first for the app role, so — exactly as
    // inmutabilidad.test.ts does for `huella` — grant UPDATE inside a rolled-back transaction and
    // watch the SECOND layer (the trigger) catch it. WT001 is the trigger's SQLSTATE.
    await withTenant(pg.db, TENANT_A.id, async (tx) => {
      await tx.execute(sql`grant update on registros_facturacion to app_user`);
      await tx.execute(sql`set local role app_user`);
      await insertRegistro(tx, { tipoFactura: "R5", tipoRectificativa: "I" });
      const error = await captureError(() =>
        tx.execute(sql`update registros_facturacion set tipo_rectificativa = 'S'`),
      );
      expect(pgErrorCode(error)).toBe("WT001");
      throw new RollbackSignal();
    }).catch((e: unknown) => {
      if (!(e instanceof RollbackSignal)) throw e;
    });
  });

  it("refuses an UPDATE of tipo_rectificativa as the app role, on privilege grounds", async () => {
    // The revocation layer that fires before the trigger is ever reached: app_user holds no UPDATE
    // on this table at all, so the column add did not quietly grant one.
    const error = await captureError(() =>
      asApp(async (tx) => {
        await insertRegistro(tx, { tipoFactura: "R5", tipoRectificativa: "I" });
        await tx.execute(sql`update registros_facturacion set tipo_rectificativa = 'S'`);
      }),
    );
    expect(pgErrorCode(error)).toBe("42501");
  });
});
