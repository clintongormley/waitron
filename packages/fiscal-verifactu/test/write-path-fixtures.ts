import { eq, sql } from "drizzle-orm";
import type { RecordSaleInput } from "@waitron/core";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { jobOrigin, saleId as brandSaleId } from "@waitron/shared";
import type { NodeId, SeriesId } from "@waitron/shared";
import type { RegistroAlta, VerifactuClient } from "@waitron/verifactu";
import { appendToChain } from "../src/chain.js";
import { decodeRegistroRow, fromRegistroRow } from "../src/registro-row.js";
import { verifactuRecords } from "../src/schema/verifactu-records.js";
import { verifactuSubmissions } from "../src/schema/verifactu-submissions.js";

const BASE = new Date("2026-03-01T13:05:00+01:00");

/**
 * A `resolveClient` for `drain` or `reconcile` that always returns `client`. Do NOT reach for this
 * in a test that cares WHEN the transport is resolved, or that needs a throwing one — write a
 * bespoke resolver instead.
 */
export function staticResolver(client: VerifactuClient): () => Promise<VerifactuClient> {
  return () => Promise.resolve(client);
}

/** Confident, fixed, +01:00. `anchor`/`currentAnchor` are stubs: `recordSale` never calls either. */
export const steadyClock: TrustedClock = {
  now: () => ({
    instant: BASE,
    offsetMinutes: 60,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("steadyClock: anchor() is not used by recordSale");
  },
  currentAnchor: () => null,
};

/**
 * Builds a `RecordSaleInput` from `@waitron/core`: 10.00 base + 2.10 tax at 21%, 2.10 base + 0.21
 * tax at 10%, taxable total 14.41. Its origin defaults to the readiness test's, which needs no
 * device row.
 */
export function saleInput(
  params: {
    nodeId: NodeId;
    seriesId: SeriesId;
  } & Partial<RecordSaleInput>,
): RecordSaleInput {
  const { nodeId, seriesId, ...overrides } = params;
  return {
    operationDescription: "Venta en establecimiento",
    origin: jobOrigin("readiness_test"),
    nodeId,
    seriesId,
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    total: "14.41",
    lines: [
      {
        lineNo: 1,
        name: "Café solo",
        descriptions: { "es-ES": "Café solo" },
        quantity: "2",
        unitPrice: "5.00",
        vatRate: "21.00",
        lineTotal: "10.00",
      },
      {
        lineNo: 2,
        name: "Agua",
        descriptions: { "es-ES": "Agua" },
        quantity: "1",
        unitPrice: "2.10",
        vatRate: "10.00",
        lineTotal: "2.10",
      },
    ],
    // Immediate settlement with the tip on the tender: sum(amount) 16.31 = total 14.41 + tip 1.90.
    settlement: {
      kind: "immediate",
      tenders: [{ method: "card", amount: "16.31", tipAmount: "1.90", settledAt: BASE }],
    },
    clock: steadyClock,
    ...overrides,
  };
}

/** The stored invoice number and generation time of the record `recordId` names, for suites
 * outside this package that may not name its Spanish columns. */
export async function storedRecord(
  db: Database,
  recordId: string,
): Promise<{ invoiceNumber: string; generatedAt: Date } | undefined> {
  const [row] = await db
    .select({
      invoiceNumber: verifactuRecords.numSerieFactura,
      generatedAt: verifactuRecords.fechaHoraHusoGenRegistro,
    })
    .from(verifactuRecords)
    .where(eq(verifactuRecords.id, recordId));
  return row;
}

/** Leaves every record of `saleId` refused by AEAT for a future date (`1112`), as a drain pass
 * does on its refusal. */
export async function refusedByAeat(db: Database | Transaction, saleId: string): Promise<void> {
  await db.execute(sql`
    update verifactu_submissions set estado = 'rechazado', codigo_error = '1112'
    where registro_id in (select id from verifactu_records where sale_id = ${saleId})
  `);
}

/** Leaves every record of `saleId` held from sending (`detenido`), as a drain pass holds a chain
 * behind a record AEAT refused. */
export async function heldFromSending(db: Database | Transaction, saleId: string): Promise<void> {
  await db.execute(sql`
    update verifactu_submissions set estado = 'detenido'
    where registro_id in (select id from verifactu_records where sale_id = ${saleId})
  `);
}

/** Leaves every record of `saleId` accepted by AEAT. */
export async function acceptedByAeat(db: Database | Transaction, saleId: string): Promise<void> {
  await db.execute(sql`
    update verifactu_submissions set estado = 'aceptado'
    where registro_id in (select id from verifactu_records where sale_id = ${saleId})
  `);
}

/** A correction record of the sale's latest alta, as the record-correction remedy files one,
 * left in the delivery state given, or with no submission for `null`. */
export async function fixedVersionOf(
  db: Database,
  nodeId: NodeId,
  saleId: string,
  estado: string | null,
  codigoError: string | null,
) {
  await withTransaction(db, async (tx) => {
    const { rows } = await tx.execute<Record<string, unknown>>(sql`
      select * from verifactu_records r
      where sale_id = ${saleId} and tipo_registro = 'alta'
        and not exists (select 1 from verifactu_records n where n.corrects_registro_id = r.id)
    `);
    const stored = decodeRegistroRow(rows[0]!);
    const previous = fromRegistroRow(stored) as RegistroAlta;
    const appended = await appendToChain(tx, nodeId, {
      tipo: "alta",
      saleId: brandSaleId(saleId),
      origin: jobOrigin("operator_script"),
      entorno: "production",
      correctsRegistroId: stored.id,
      input: {
        IDEmisorFactura: previous.IDFactura.IDEmisorFactura,
        NumSerieFactura: previous.IDFactura.NumSerieFactura,
        FechaExpedicionFactura: new Date(
          Date.parse(`${stored.fecha_expedicion_factura}T00:00:00Z`) - 60 * 60_000,
        ),
        NombreRazonEmisor: previous.NombreRazonEmisor,
        TipoFactura: "F2",
        DescripcionOperacion: previous.DescripcionOperacion,
        Desglose: previous.Desglose,
        CuotaTotal: previous.CuotaTotal,
        ImporteTotal: previous.ImporteTotal,
        Subsanacion: "S",
        RechazoPrevio: estado === "rechazado" ? "X" : "N",
        SistemaInformatico: previous.SistemaInformatico,
        generadoEn: new Date("2026-03-02T10:00:00+01:00"),
        offsetMinutes: 60,
      },
    });
    if (estado !== null)
      await tx
        .insert(verifactuSubmissions)
        .values({ registroId: appended.id, estado, codigoError });
  });
}
