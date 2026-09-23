import {
  CHECK_VIOLATION,
  captureError,
  isRefusal,
  newId,
  engineErrorMessage,
  triggerRaised,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { TENANT_A, seedTenantTillSif } from "../test/fixtures.js";

/**
 * The four AEAT rectificativa columns on `registros_facturacion` (the baseline) and their two
 * CHECK constraints. docs/superpowers/plans/2026-08-02-rectificativas.md §2.2.
 *
 * These are CHECK, JSON round-trip and trigger-backstop assertions, none of which needs contention
 * or a second connection, so they run on the venue database `useVenueDb` opens (CLAUDE.md §4).
 *
 * The trigger case below is the only thing refusing an UPDATE of `tipo_rectificativa`.
 */
const pg = useVenueDb({
  migrations: TEST_MIGRATIONS,
  setup: seedTenantTillSif,
  resetPerTest: false,
});

// One shared database backs the whole file, so every insert must claim a fresh secuencia
// (registros_tenant_node_secuencia_uq) and, since id_emisor/fecha/tipo_registro are constant, a
// fresh num_serie (registros_identidad_uq). A module counter gives both.
let secuenciaSeq = 0;
function nextSecuencia(): number {
  secuenciaSeq += 1;
  return secuenciaSeq;
}

/**
 * A JSON bind fragment: the stringified value, or a NULL.
 *
 * The `::jsonb` casts these two fragments carried are PostgreSQL's. The columns are TEXT holding
 * JSON here (`packages/db/src/schema/columns.ts`'s `json` helper), and a `::` reaches SQLite's
 * parser as `unrecognized token: ":"` — the colon opens a bind parameter — which is the failure
 * every case in this file opened with.
 */
function jsonParam(value: unknown) {
  return value === undefined || value === null ? sql`null` : sql`${JSON.stringify(value)}`;
}

interface RegistroFields {
  tipoFactura?: string | null;
  tipoRectificativa?: string | null;
  facturasRectificadas?: unknown;
  facturasSustituidas?: unknown;
  importeRectificacion?: unknown;
}

/**
 * Insert a rectificativa alta.
 *
 * `id` and `creado_en` are stated rather than omitted: both are `$defaultFn` columns only the
 * insert BUILDER fills, so a raw statement omitting them is refused `NOT NULL constraint failed:
 * registros_facturacion.id` — which would let a CHECK case below pass for the wrong reason.
 * `repeat('F', 64)` is `no such function: repeat` on this engine, so the huella is built in
 * JavaScript and bound.
 */
async function insertRegistro(exec: Database, fields: RegistroFields = {}): Promise<void> {
  const secuencia = nextSecuencia();
  await exec.execute(sql`
    insert into registros_facturacion (
      id, till_id, node_id, sif_id, sale_id, secuencia, tipo_registro,
      id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
      tipo_factura, tipo_rectificativa, facturas_rectificadas, facturas_sustituidas,
      importe_rectificacion, descripcion_operacion, desglose, cuota_total, importe_total,
      primer_registro, sistema_informatico,
      fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella, creado_en
    ) values (${newId()}, ${TENANT_A.tillId}, ${TENANT_A.nodeId}, ${TENANT_A.sifId}, ${TENANT_A.saleId},
      ${secuencia}, 'alta',
      '89890001K', ${"R/" + String(secuencia)}, '2026-07-20', 'Waitron SL',
      ${fields.tipoFactura === undefined ? "R5" : fields.tipoFactura},
      ${fields.tipoRectificativa ?? null},
      ${jsonParam(fields.facturasRectificadas)},
      ${jsonParam(fields.facturasSustituidas)},
      ${jsonParam(fields.importeRectificacion)},
      'Rectificación de la venta', '[]', '-12.35', '-123.45',
      true, '{}',
      '2026-07-20T19:20:30+01:00', 60, '01', ${"F".repeat(64)}, '2026-07-20T18:20:30.000Z'
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
    // registros_tipo_rectificativa_ck rejects values outside {S, I}.
    const error = await captureError(() =>
      insertRegistro(pg.db, { tipoFactura: "R5", tipoRectificativa: "X" }),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/registros_tipo_rectificativa_ck/);
  });
});

describe("registros_tipo_factura_rectificativa_ck — rule 1115 at the DB", () => {
  it("rejects a tipo_rectificativa sitting on a non-rectificativa tipo_factura", async () => {
    // tipo_rectificativa may appear only on an R1–R5 invoice.
    const error = await captureError(() =>
      insertRegistro(pg.db, { tipoFactura: "F2", tipoRectificativa: "I" }),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/registros_tipo_factura_rectificativa_ck/);
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
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/registros_tipo_factura_rectificativa_ck/);
  });
});

describe("the rectificativa columns are JSON and round-trip", () => {
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
    const { rows } = await pg.db.execute<{ facturas_rectificadas: string }>(
      sql`select facturas_rectificadas from registros_facturacion
           where facturas_rectificadas is not null order by secuencia desc limit 1`,
    );
    // A raw read returns the column's TEXT: drizzle's `json` read mapping runs only for a select
    // through the table definition, not for a hand-written statement. Parsing is what makes this
    // the same document comparison the PostgreSQL `jsonb` read did.
    expect(JSON.parse(rows[0]!.facturas_rectificadas)).toEqual(facturasRectificadas);
  });

  it("stores and returns importe_rectificacion verbatim", async () => {
    const importeRectificacion = { BaseRectificada: "-100.00", CuotaRectificada: "-21.00" };
    await insertRegistro(pg.db, {
      tipoFactura: "R5",
      tipoRectificativa: "S",
      importeRectificacion,
    });
    const { rows } = await pg.db.execute<{ importe_rectificacion: string }>(
      sql`select importe_rectificacion from registros_facturacion
           where importe_rectificacion is not null order by secuencia desc limit 1`,
    );
    expect(JSON.parse(rows[0]!.importe_rectificacion)).toEqual(importeRectificacion);
  });
});

describe("the new columns inherit the table's immutability", () => {
  it("refuses an UPDATE of tipo_rectificativa by the append-only trigger", async () => {
    // Confirms the table-wide append-only trigger covers the new column with NO new DDL, and that
    // it is what the UPDATE meets directly.
    await insertRegistro(pg.db, { tipoFactura: "R5", tipoRectificativa: "I" });
    const error = await captureError(async () =>
      pg.db.execute(sql`update registros_facturacion set tipo_rectificativa = 'S'`),
    );
    // The trigger's own `RAISE(ABORT, …)` text, chosen by `packages/store/src/append-only.ts`.
    // `triggerRaised` matches the class AND the words, so an `ON DELETE RESTRICT` refusal — which
    // arrives under the same result code — cannot satisfy it.
    expect(triggerRaised(error, "registros_facturacion is append-only")).toBe(true);
  });
});
