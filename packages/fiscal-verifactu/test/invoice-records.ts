import { eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@waitron/db";
import { validate, type ValidationIssue } from "@waitron/verifactu";
import type { IdentityChangeView, InvoiceIdView } from "../src/filing-overview-types.js";
import { decodeRegistroRow, fromRegistroRow, type RegistroRow } from "../src/registro-row.js";
import { verifactuSubmissions } from "../src/schema/verifactu-submissions.js";
import { verifactuRecords } from "../src/schema/verifactu-records.js";
import type { verifactuIdentities } from "../src/schema/verifactu-identities.js";
import { seedPendingEnvios } from "./drain-fixtures.js";

/** English names for fiscal tables and AEAT's invoice fields, for suites outside this package. */
export const invoiceRecords = verifactuRecords;

export function recordInvoiceNumber(row: typeof verifactuRecords.$inferSelect): string {
  return row.numSerieFactura;
}

/** Every stored invoice number, sorted as text. */
export function storedInvoiceNumbers(db: Database): string[] {
  return db
    .all<{
      n: string;
    }>(sql`select num_serie_factura as n from verifactu_records order by num_serie_factura`)
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

export function registrationInstallationName(row: typeof verifactuIdentities.$inferSelect): string {
  return row.numeroInstalacion;
}

/** The invoice kind (F1, F2, F3, R4, R5) each listed sale was filed as; a cancellation record
 * carries no kind and is left out. */
export async function filedKindsBySale(
  db: Database,
  saleIds: readonly string[],
): Promise<Map<string, string>> {
  const rows = await db
    .select({ saleId: verifactuRecords.saleId, kind: verifactuRecords.tipoFactura })
    .from(verifactuRecords)
    .where(inArray(verifactuRecords.saleId, [...saleIds]));
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
      saleId: verifactuRecords.saleId,
      kind: verifactuRecords.tipoFactura,
      total: verifactuRecords.importeTotal,
    })
    .from(verifactuRecords)
    .where(inArray(verifactuRecords.saleId, [...saleIds]));
  return new Map(
    rows.flatMap(({ saleId, kind, total }) =>
      saleId === null || kind === null ? [] : [[saleId, { kind, total }]],
    ),
  );
}

/** A sale's filed invoice record, as AEAT receives it, under English names. */
export interface FiledInvoice {
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
    .all<RegistroRow>(sql`select * from verifactu_records where sale_id = ${saleId}`)
    .map((row) => {
      const record = fromRegistroRow(decodeRegistroRow(row));
      if (!("TipoFactura" in record)) throw new Error(`sale ${saleId} has a cancellation record`);
      return {
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

/** One `Desglose` line, under English names. */
export interface FiledBreakdownLine {
  /** `Impuesto`. */
  taxKind?: string;
  /** `ClaveRegimen`. */
  regime?: string;
  /** `CalificacionOperacion`, or `OperacionExenta` on an exempt line. */
  treatment: string;
  /** `TipoImpositivo`. */
  rate?: string;
  /** `BaseImponibleOimporteNoSujeto`. */
  base: string;
  /** `CuotaRepercutida`. */
  vat?: string;
}

/** A sale's one filed invoice record, under English names, with the invoices it corrects. */
export interface FiledInvoiceRecord {
  /** `IDEmisorFactura`. */
  issuerTaxId: string;
  /** `NumSerieFactura`. */
  number: string;
  /** `TipoFactura`: F1, F2, F3, R4 or R5. */
  kind: string;
  /** `TipoRectificativa`, or null on an invoice that corrects nothing. */
  correctionKind: string | null;
  /** `ImporteTotal`. */
  total: string;
  /** `CuotaTotal`. */
  vatTotal: string;
  breakdown: FiledBreakdownLine[];
  /** `FacturasRectificadas`: each corrected invoice's issuer, number and issue day. */
  corrects: { issuerTaxId: string; number: string; issuedOn: string }[];
}

/** The sale's filed invoice record; throws unless the sale has exactly one record, an invoice. */
export function filedInvoiceOf(db: Database, saleId: string): FiledInvoiceRecord {
  const rows = db.all<RegistroRow>(sql`select * from verifactu_records where sale_id = ${saleId}`);
  if (rows.length !== 1) throw new Error(`sale ${saleId} has ${rows.length} records`);
  const record = fromRegistroRow(decodeRegistroRow(rows[0]!));
  if (!("TipoFactura" in record)) throw new Error(`sale ${saleId} has a cancellation record`);
  return {
    issuerTaxId: record.IDFactura.IDEmisorFactura,
    number: record.IDFactura.NumSerieFactura,
    kind: record.TipoFactura,
    correctionKind: record.TipoRectificativa ?? null,
    total: record.ImporteTotal,
    vatTotal: record.CuotaTotal,
    breakdown: record.Desglose.map((line) => ({
      taxKind: line.Impuesto,
      regime: line.ClaveRegimen,
      treatment: line.CalificacionOperacion ?? line.OperacionExenta!,
      rate: line.TipoImpositivo,
      base: line.BaseImponibleOimporteNoSujeto,
      vat: line.CuotaRepercutida,
    })),
    corrects: (record.FacturasRectificadas?.IDFacturaRectificada ?? []).map((invoice) => ({
      issuerTaxId: invoice.IDEmisorFactura,
      number: invoice.NumSerieFactura,
      issuedOn: invoice.FechaExpedicionFactura,
    })),
  };
}

/** Each record filed for the sale in chain order: an invoice or a cancellation, and its stored
 * filing state (null before one is queued). */
export async function filedRecordsOf(
  db: Database,
  saleId: string,
): Promise<{ kind: "invoice" | "cancellation"; state: string | null }[]> {
  const rows = await db
    .select({ kind: verifactuRecords.tipoRegistro, state: verifactuSubmissions.estado })
    .from(verifactuRecords)
    .leftJoin(verifactuSubmissions, eq(verifactuSubmissions.registroId, verifactuRecords.id))
    .where(eq(verifactuRecords.saleId, saleId))
    .orderBy(verifactuRecords.secuencia);
  return rows.map(({ kind, state }) => ({
    kind: kind === "alta" ? "invoice" : "cancellation",
    state,
  }));
}

/** Every invoice filed against `saleId`, in number order: its record's invoice type, whether it
 * corrects by differences or replaces, its series' purpose, the customer it names and its total in
 * cents. */
export function correctiveRecordsOf(
  db: Database,
  saleId: string,
): {
  type: string;
  by: "differences" | "replacement" | null;
  purpose: string;
  customer: string | null;
  total: number;
}[] {
  return db.all(sql`
    select r.tipo_factura as type,
           case r.tipo_rectificativa when 'I' then 'differences' when 'S' then 'replacement' end as by,
           ser.purpose as purpose, s.counterparty_tax_id as customer, s.total as total
    from sales s
    join invoice_series ser on ser.id = s.series_id
    join verifactu_records r on r.sale_id = s.id
    where s.corrects_sale_id = ${saleId}
    order by s.invoice_number`);
}

/** Stores AEAT's refusal, with `code`, as the filing reply to one record. */
export async function refuseRecord(db: Database, recordId: string, code: string): Promise<void> {
  await db
    .update(verifactuSubmissions)
    .set({ estado: "rechazado", codigoError: code })
    .where(eq(verifactuSubmissions.registroId, recordId));
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
  await db
    .update(verifactuSubmissions)
    .set({ estado: "detenido" })
    .where(eq(verifactuSubmissions.registroId, recordId));
}
