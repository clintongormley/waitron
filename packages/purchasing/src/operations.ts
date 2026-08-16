import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { isUniqueViolation, purchaseInvoiceVat, purchaseInvoices } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, compareDecimal, decimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import "./errors.js";
import type {
  CreatePurchaseInvoiceInput,
  ListPurchaseInvoicesInput,
  PurchaseInvoice,
  PurchaseInvoiceLine,
  PurchaseInvoiceLineInput,
  PurchaseRegime,
  PurchaseVatKind,
  UpdatePurchaseInvoiceInput,
} from "./types.js";

/**
 * Plain mutable CRUD over the two purchase-invoice tables (`purchase_invoices` +
 * `purchase_invoice_vat`). Every function takes a `(tx, …)` and runs under the CALLER's tenant
 * context: the caller opens the transaction with `withTenant` (and `asAppUser` in the running POS),
 * so writes adopt that tenant through `current_tenant_id()` and reads are filtered to it by the
 * tenant-isolation policy — nothing here takes a `tenantId` argument, mirroring `packages/recipes`
 * and `packages/catalogue`. These are received-supplier records (facturas recibidas), the
 * commercial/accounting lane: mutable, with no huella, chain, or invoice number (spec §2).
 *
 * All SQL is built with Drizzle query builders — no string concatenation.
 */

const CURRENT_TENANT = sql`current_tenant_id()`;
const ZERO = decimal("0.00");
const HUNDRED = decimal("100.00");

const HEADER_SELECT = {
  id: purchaseInvoices.id,
  supplierTaxId: purchaseInvoices.supplierTaxId,
  supplierName: purchaseInvoices.supplierName,
  supplierInvoiceNumber: purchaseInvoices.supplierInvoiceNumber,
  issuedOn: purchaseInvoices.issuedOn,
  receivedOn: purchaseInvoices.receivedOn,
  total: purchaseInvoices.total,
  regime: purchaseInvoices.regime,
  deductibleProportion: purchaseInvoices.deductibleProportion,
  note: purchaseInvoices.note,
};

const LINE_SELECT = {
  purchaseInvoiceId: purchaseInvoiceVat.purchaseInvoiceId,
  rate: purchaseInvoiceVat.rate,
  base: purchaseInvoiceVat.base,
  tax: purchaseInvoiceVat.tax,
  kind: purchaseInvoiceVat.kind,
};

// The line INSERT's RETURNING columns: LINE_SELECT plus the generated `id`, needed to reproduce
// `selectLines`' `orderBy(asc(rate), asc(id))` tie-break in JS without a re-read.
const LINE_RETURNING = { ...LINE_SELECT, id: purchaseInvoiceVat.id };

interface HeaderRow {
  id: string;
  supplierTaxId: string;
  supplierName: string;
  supplierInvoiceNumber: string;
  issuedOn: string;
  receivedOn: string;
  total: string;
  regime: PurchaseRegime;
  deductibleProportion: string;
  note: string | null;
}

interface LineRow {
  purchaseInvoiceId: string;
  rate: string;
  base: string;
  tax: string;
  kind: PurchaseVatKind;
}

interface LineRowWithId extends LineRow {
  id: string;
}

function mapHeader(row: HeaderRow): Omit<PurchaseInvoice, "lines"> {
  return {
    id: row.id,
    supplierTaxId: row.supplierTaxId,
    supplierName: row.supplierName,
    supplierInvoiceNumber: row.supplierInvoiceNumber,
    issuedOn: row.issuedOn,
    receivedOn: row.receivedOn,
    total: row.total as Decimal,
    regime: row.regime,
    deductibleProportion: row.deductibleProportion as Decimal,
    note: row.note,
  };
}

function mapLine(row: LineRow): PurchaseInvoiceLine {
  return {
    rate: row.rate as Decimal,
    base: row.base as Decimal,
    tax: row.tax as Decimal,
    kind: row.kind,
  };
}

/** The prorrata seam must be a percentage 0–100 (spec §9); anything else is a caller bug. */
function validateProportion(proportion: Decimal | undefined): void {
  if (proportion === undefined) return;
  if (compareDecimal(proportion, ZERO) < 0 || compareDecimal(proportion, HUNDRED) > 0) {
    throw new AppError("purchase.invalid", { reason: "proportion_out_of_range" });
  }
}

/** At least one VAT line, each with a non-negative base and cuota and a rate in 0–100. */
function validateLines(lines: readonly PurchaseInvoiceLineInput[]): void {
  if (lines.length === 0) throw new AppError("purchase.invalid", { reason: "no_lines" });
  for (const line of lines) {
    if (compareDecimal(line.base, ZERO) < 0) {
      throw new AppError("purchase.invalid", { reason: "negative_base" });
    }
    if (compareDecimal(line.tax, ZERO) < 0) {
      throw new AppError("purchase.invalid", { reason: "negative_tax" });
    }
    if (compareDecimal(line.rate, ZERO) < 0 || compareDecimal(line.rate, HUNDRED) > 0) {
      throw new AppError("purchase.invalid", { reason: "rate_out_of_range" });
    }
  }
}

/**
 * Insert the VAT lines of one invoice and return the STORED rows via RETURNING, so DB defaults (`kind`
 * omitted → `ordinary`) and numeric-scale normalization ("21" → "21.00") are reflected without a
 * re-read. `kind` omitted falls to the column default. Callers that do not need the rows discard them.
 */
async function insertLines(
  tx: Transaction,
  invoiceId: string,
  lines: readonly PurchaseInvoiceLineInput[],
): Promise<LineRowWithId[]> {
  return tx
    .insert(purchaseInvoiceVat)
    .values(
      lines.map((line) => ({
        tenantId: CURRENT_TENANT,
        purchaseInvoiceId: invoiceId,
        rate: line.rate,
        base: line.base,
        tax: line.tax,
        kind: line.kind,
      })),
    )
    .returning(LINE_RETURNING);
}

/**
 * Order RETURNING'd line rows exactly as `selectLines`' `orderBy(asc(rate), asc(id))` would: by rate
 * ascending (numeric compare, so "10.00" precedes "21.00"), ties broken by `id` — the canonical
 * lowercase UUID string compares the same way PostgreSQL orders the `uuid` type. Sorts in place.
 */
function sortLineRows(rows: LineRowWithId[]): LineRowWithId[] {
  return rows.sort((a, b) => {
    const byRate = compareDecimal(a.rate as Decimal, b.rate as Decimal);
    if (byRate !== 0) return byRate;
    // Branchless id compare (no dependence on random-UUID ordering for coverage): the canonical
    // lowercase UUID string compares the same way PostgreSQL orders the `uuid` type.
    return Number(a.id > b.id) - Number(a.id < b.id);
  });
}

/** VAT lines of one invoice, in a stable order (rate asc, then id). */
async function selectLines(tx: Transaction, invoiceId: string): Promise<PurchaseInvoiceLine[]> {
  const rows = await tx
    .select(LINE_SELECT)
    .from(purchaseInvoiceVat)
    .where(eq(purchaseInvoiceVat.purchaseInvoiceId, invoiceId))
    .orderBy(asc(purchaseInvoiceVat.rate), asc(purchaseInvoiceVat.id));
  return rows.map(mapLine);
}

/**
 * Insert a received invoice and its VAT lines in the caller's transaction. Validates the header's
 * prorrata seam and the lines (≥1 line, non-negative base/cuota, rate 0–100 → `purchase.invalid`)
 * BEFORE any write; a collision on the `(tenant, supplier, supplier's number)` unique index becomes
 * `purchase.duplicate` (the libro-registro no-duplicate rule). `regime`/`deductibleProportion`/`kind`
 * omitted fall to their column defaults.
 */
export async function createPurchaseInvoice(
  tx: Transaction,
  input: CreatePurchaseInvoiceInput,
): Promise<PurchaseInvoice> {
  validateProportion(input.header.deductibleProportion);
  validateLines(input.lines);

  // RETURNING the STORED header + line tuples rather than re-reading them: the DB applies the same
  // column defaults (`regime` → general, `deductible_proportion` → 100.00, line `kind` → ordinary) and
  // numeric-scale normalization it would on a SELECT, so the returned shape is identical to the old
  // insert-then-getPurchaseInvoice re-read — two fewer round-trips, mirroring the catalogue/recipes
  // `.values(...).returning(COLUMNS)` house pattern this module follows.
  let header: Omit<PurchaseInvoice, "lines">;
  try {
    const [row] = await tx
      .insert(purchaseInvoices)
      .values({
        tenantId: CURRENT_TENANT,
        supplierTaxId: input.header.supplierTaxId,
        supplierName: input.header.supplierName,
        supplierInvoiceNumber: input.header.supplierInvoiceNumber,
        issuedOn: input.header.issuedOn,
        receivedOn: input.header.receivedOn,
        total: input.header.total,
        regime: input.header.regime,
        deductibleProportion: input.header.deductibleProportion,
        note: input.header.note ?? null,
      })
      .returning(HEADER_SELECT);
    header = mapHeader(row!);
  } catch (error) {
    if (isUniqueViolation(error)) {
      // A translation, not a recovery: Postgres has already aborted the transaction (the same note
      // record-void.ts's duplicate translation carries). The caller gets a structured code instead
      // of a raw driver string.
      throw new AppError("purchase.duplicate", {
        supplierTaxId: input.header.supplierTaxId,
        supplierInvoiceNumber: input.header.supplierInvoiceNumber,
      });
    }
    throw error;
  }

  const lines = sortLineRows(await insertLines(tx, header.id, input.lines)).map(mapLine);
  return { ...header, lines };
}

/** The header plus its VAT lines, or null when no invoice with `id` is visible in this tenant. */
export async function getPurchaseInvoice(
  tx: Transaction,
  id: string,
): Promise<PurchaseInvoice | null> {
  const [row] = await tx
    .select(HEADER_SELECT)
    .from(purchaseInvoices)
    .where(eq(purchaseInvoices.id, id));
  if (row === undefined) return null;
  return { ...mapHeader(row), lines: await selectLines(tx, id) };
}

/**
 * Every visible invoice (header + lines), optionally narrowed to a half-open `received_on` window —
 * the deduction-period bound. Two queries regardless of count (headers, then all their lines grouped
 * in JS), not a per-invoice fan-out.
 */
export async function listPurchaseInvoices(
  tx: Transaction,
  opts?: ListPurchaseInvoicesInput,
): Promise<PurchaseInvoice[]> {
  const conds: SQL[] = [];
  if (opts?.from !== undefined) conds.push(gte(purchaseInvoices.receivedOn, opts.from));
  if (opts?.to !== undefined) conds.push(lt(purchaseInvoices.receivedOn, opts.to));
  const headerRows = await tx
    .select(HEADER_SELECT)
    .from(purchaseInvoices)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(asc(purchaseInvoices.receivedOn), asc(purchaseInvoices.id));
  if (headerRows.length === 0) return [];

  const ids = headerRows.map((h) => h.id);
  const lineRows = await tx
    .select(LINE_SELECT)
    .from(purchaseInvoiceVat)
    .where(inArray(purchaseInvoiceVat.purchaseInvoiceId, ids))
    .orderBy(asc(purchaseInvoiceVat.rate), asc(purchaseInvoiceVat.id));

  // Pre-seed one bucket per header so grouping needs no presence check and every header gets its
  // (guaranteed ≥1, but defensively) lines array.
  const byInvoice = new Map<string, PurchaseInvoiceLine[]>(
    headerRows.map((h) => [h.id, [] as PurchaseInvoiceLine[]]),
  );
  for (const row of lineRows) byInvoice.get(row.purchaseInvoiceId)!.push(mapLine(row));
  return headerRows.map((h) => ({ ...mapHeader(h), lines: byInvoice.get(h.id)! }));
}

/**
 * Patch a received invoice: any subset of header fields, and optionally a full REPLACEMENT of its
 * VAT lines (validated like create — fixing a mis-keyed rate is the motivating case). Throws
 * `purchase.not_found` when no invoice with `id` is visible. `updated_at` is always bumped.
 */
export async function updatePurchaseInvoice(
  tx: Transaction,
  id: string,
  patch: UpdatePurchaseInvoiceInput,
): Promise<void> {
  if (patch.header?.deductibleProportion !== undefined) {
    validateProportion(patch.header.deductibleProportion);
  }
  if (patch.lines !== undefined) validateLines(patch.lines);

  const updated = await tx
    .update(purchaseInvoices)
    .set({ ...patch.header, updatedAt: sql`now()` })
    .where(eq(purchaseInvoices.id, id))
    .returning({ id: purchaseInvoices.id });
  if (updated.length === 0) throw new AppError("purchase.not_found", { id });

  if (patch.lines !== undefined) {
    await tx.delete(purchaseInvoiceVat).where(eq(purchaseInvoiceVat.purchaseInvoiceId, id));
    await insertLines(tx, id, patch.lines);
  }
}

/** Delete a received invoice; its VAT lines cascade. Throws `purchase.not_found` when none matched. */
export async function deletePurchaseInvoice(tx: Transaction, id: string): Promise<void> {
  const deleted = await tx
    .delete(purchaseInvoices)
    .where(eq(purchaseInvoices.id, id))
    .returning({ id: purchaseInvoices.id });
  if (deleted.length === 0) throw new AppError("purchase.not_found", { id });
}
