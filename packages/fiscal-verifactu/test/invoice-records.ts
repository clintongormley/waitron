import { eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@waitron/db";
import { validate, type ValidationIssue } from "@waitron/verifactu";
import type { IdentityChangeView, InvoiceIdView } from "../src/filing-overview-types.js";
import { decodeRegistroRow, fromRegistroRow, type RegistroRow } from "../src/registro-row.js";
import { envios } from "../src/schema/envios.js";
import { registrosFacturacion } from "../src/schema/registros.js";
import type { registroSif } from "../src/schema/sif.js";
import { seedPendingEnvios } from "./drain-fixtures.js";

/** English names for fiscal tables and AEAT's invoice fields, for suites outside this package. */
export const invoiceRecords = registrosFacturacion;

export function recordInvoiceNumber(row: typeof registrosFacturacion.$inferSelect): string {
  return row.numSerieFactura;
}

/** Every stored invoice number, sorted as text. */
export function storedInvoiceNumbers(db: Database): string[] {
  return db
    .all<{
      n: string;
    }>(sql`select num_serie_factura as n from registros_facturacion order by num_serie_factura`)
    .map((row) => row.n);
}

export function heldInvoice(
  number: string,
  issuedOn: string,
): NonNullable<IdentityChangeView["lastHeldInvoice"]> {
  return { numSerieFactura: number, fechaExpedicionFactura: issuedOn };
}

export function aeatInvoiceNumber(invoice: Pick<InvoiceIdView, "NumSerieFactura">): string {
  return invoice.NumSerieFactura;
}

export function registrationInstallationName(row: typeof registroSif.$inferSelect): string {
  return row.numeroInstalacion;
}

/** The invoice kind (F1, F2, F3, R4, R5) each listed sale was filed as; a cancellation record
 * carries no kind and is left out. */
export async function filedKindsBySale(
  db: Database,
  saleIds: readonly string[],
): Promise<Map<string, string>> {
  const rows = await db
    .select({ saleId: registrosFacturacion.saleId, kind: registrosFacturacion.tipoFactura })
    .from(registrosFacturacion)
    .where(inArray(registrosFacturacion.saleId, [...saleIds]));
  return new Map(
    rows.flatMap(({ saleId, kind }) => (saleId === null || kind === null ? [] : [[saleId, kind]])),
  );
}

/** The kind and total each listed sale was filed with, as stored; a cancellation record is left out. */
export async function filedSales(
  db: Database,
  saleIds: readonly string[],
): Promise<Map<string, { kind: string; total: string | null }>> {
  const rows = await db
    .select({
      saleId: registrosFacturacion.saleId,
      kind: registrosFacturacion.tipoFactura,
      total: registrosFacturacion.importeTotal,
    })
    .from(registrosFacturacion)
    .where(inArray(registrosFacturacion.saleId, [...saleIds]));
  return new Map(
    rows.flatMap(({ saleId, kind, total }) =>
      saleId === null || kind === null ? [] : [[saleId, { kind, total }]],
    ),
  );
}

/** An invoice as a record names it: its issuer's tax number and its number. */
export interface RecordedInvoiceId {
  issuer: string;
  number: string;
}

/** A sale's filed invoice record, as AEAT receives it, under English names. */
export interface FiledInvoice {
  /** `IDFactura`: the invoice this record is. */
  invoice: RecordedInvoiceId;
  /** `FacturasRectificadas`: the invoices this record says it corrects. */
  corrects: RecordedInvoiceId[];
  /** `TipoFactura`: F1, F2, F3, R4 or R5. */
  kind: string;
  /** `ImporteTotal`. */
  total: string;
  /** `CuotaTotal`. */
  vatTotal: string;
  /** `DescripcionOperacion`. */
  description: string;
  /** `Desglose`, each line as `[rate, base, tax]`. */
  breakdown: [string, string, string][];
  /** The errors AEAT's own checks (`validate`, as of `now`) find in the record. */
  errors: ValidationIssue[];
}

/** Every invoice record filed for the sale; a cancellation record throws. */
export function filedInvoicesOf(db: Database, saleId: string, now: Date): FiledInvoice[] {
  return db
    .all<RegistroRow>(sql`select * from registros_facturacion where sale_id = ${saleId}`)
    .map((row) => {
      const record = fromRegistroRow(decodeRegistroRow(row));
      if (!("TipoFactura" in record)) throw new Error(`sale ${saleId} has a cancellation record`);
      return {
        invoice: {
          issuer: record.IDFactura.IDEmisorFactura,
          number: record.IDFactura.NumSerieFactura,
        },
        corrects: (record.FacturasRectificadas?.IDFacturaRectificada ?? []).map((corrected) => ({
          issuer: corrected.IDEmisorFactura,
          number: corrected.NumSerieFactura,
        })),
        kind: record.TipoFactura,
        total: record.ImporteTotal,
        vatTotal: record.CuotaTotal,
        description: record.DescripcionOperacion,
        breakdown: record.Desglose.map((line) => [
          String(line.TipoImpositivo),
          String(line.BaseImponibleOimporteNoSujeto),
          String(line.CuotaRepercutida),
        ]),
        errors: validate(record, { now }).filter((issue) => issue.severity === "error"),
      };
    });
}

/** Stores AEAT's refusal, with `code`, as the filing reply to one record. */
export async function refuseRecord(db: Database, recordId: string, code: string): Promise<void> {
  await db
    .update(envios)
    .set({ estado: "rechazado", codigoError: code })
    .where(eq(envios.registroId, recordId));
}

/** `count` records waiting to be sent, generated on 2026-07-20 (`seedPendingEnvios`), under a new
 * venue's identity or the named one. */
export async function seedWaitingRecords(
  db: Database,
  options: {
    count: number;
    identity?: { nodeId: string; taxId: string };
    environment?: "production" | "preproduction";
  },
): Promise<{ recordIds: string[] }> {
  const seeded = await seedPendingEnvios(db, {
    count: options.count,
    ...(options.identity && {
      identity: { nodeId: options.identity.nodeId, nif: options.identity.taxId },
    }),
    ...(options.environment && { entorno: options.environment }),
  });
  return { recordIds: seeded.registroIds };
}

/** Marks one record's sending as stopped. */
export async function stopRecord(db: Database, recordId: string): Promise<void> {
  await db.update(envios).set({ estado: "detenido" }).where(eq(envios.registroId, recordId));
}
