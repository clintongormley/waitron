import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { isUniqueViolation, now, purchaseInvoiceVat, purchaseInvoices } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  AppError,
  basisPointsToDecimal,
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToBasisPoints,
  decimalToCents,
} from "@waitron/shared";
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
 * Received supplier invoices and VAT lines share the caller's transaction.
 * This is the mutable commercial/accounting lane: no fiscal fingerprint, chain or allocated invoice number.
 * All SQL is built with Drizzle query builders — no string concatenation.
 */

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

// The row shapes as the DATABASE hands them over — every one of them a whole number, and none of
// them a decimal literal: `total`, `base` and `tax` are money columns and arrive as a count of
// whole cents, `rate` and `deductible_proportion` are rate columns and arrive as a count of whole
// basis points. `mapHeader`/`mapLine` are the only crossing back to `Decimal`.
interface HeaderRow {
  id: string;
  supplierTaxId: string;
  supplierName: string;
  supplierInvoiceNumber: string;
  issuedOn: string;
  receivedOn: string;
  total: number;
  regime: PurchaseRegime;
  deductibleProportion: number;
  note: string | null;
}

interface LineRow {
  purchaseInvoiceId: string;
  rate: number;
  base: number;
  tax: number;
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
    total: centsToDecimal(row.total),
    regime: row.regime,
    deductibleProportion: basisPointsToDecimal(row.deductibleProportion),
    note: row.note,
  };
}

function mapLine(row: LineRow): PurchaseInvoiceLine {
  return {
    rate: basisPointsToDecimal(row.rate),
    base: centsToDecimal(row.base),
    tax: centsToDecimal(row.tax),
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

/** At least one VAT line, each with a non-negative base and VAT amount and a rate in 0–100. */
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
 * Insert the VAT lines of one invoice and return the STORED rows via RETURNING, so the default an
 * omitted `kind` falls to (`ordinary`) is reflected without a re-read. Callers that do not need the
 * rows discard them.
 *
 * A rate still reads back at two decimal places, so a caller that wrote "21" gets "21.00". That is
 * the conversion pair's doing and no longer the column's: a rate column holds a count of basis
 * points and carries no scale of its own. Pinned by the unscaled-literal case in
 * `operations.test.ts`.
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
        purchaseInvoiceId: invoiceId,
        rate: decimalToBasisPoints(line.rate),
        base: decimalToCents(line.base),
        tax: decimalToCents(line.tax),
        kind: line.kind,
      })),
    )
    .returning(LINE_RETURNING);
}

/**
 * Order RETURNING'd line rows exactly as `selectLines`' `orderBy(asc(rate), asc(id))` would: by rate
 * ascending — a stored rate is a count of basis points, so subtracting the two counts is the same
 * ordering the column's own `asc` gives — ties broken by `id`. Sorts in place.
 *
 * That the two orderings agree on the tie-break is checked rather than asserted: the same-rate
 * case in `operations.test.ts` builds three lines at one rate and compares this sort, line for
 * line, with the order the database hands back.
 */
function sortLineRows(rows: LineRowWithId[]): LineRowWithId[] {
  return rows.sort((a, b) => {
    const byRate = a.rate - b.rate;
    if (byRate !== 0) return byRate;
    // Branchless id compare (no dependence on random-UUID ordering for coverage).
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
 * prorrata seam and the lines (≥1 line, non-negative base/VAT amount, rate 0–100 → `purchase.invalid`)
 * BEFORE any write; a collision on the `(supplier, supplier's number)` unique index becomes
 * `purchase.duplicate` (the VAT record-book no-duplicate rule). `regime`/`deductibleProportion`/`kind`
 * omitted fall to their column defaults.
 */
export async function createPurchaseInvoice(
  tx: Transaction,
  input: CreatePurchaseInvoiceInput,
): Promise<PurchaseInvoice> {
  validateProportion(input.header.deductibleProportion);
  validateLines(input.lines);

  // RETURNING the STORED header + line tuples, so the result is the row as stored, with the
  // database's column defaults applied (`regime` → general, `deductible_proportion` → 10000 basis
  // points, line `kind` → ordinary) — the catalogue/recipes `.values(...).returning(COLUMNS)`
  // house pattern this module follows.
  let header: Omit<PurchaseInvoice, "lines">;
  try {
    const [row] = await tx
      .insert(purchaseInvoices)
      .values({
        supplierTaxId: input.header.supplierTaxId,
        supplierName: input.header.supplierName,
        supplierInvoiceNumber: input.header.supplierInvoiceNumber,
        issuedOn: input.header.issuedOn,
        receivedOn: input.header.receivedOn,
        total: decimalToCents(input.header.total),
        regime: input.header.regime,
        // Omitted stays omitted, so the column default still decides it.
        deductibleProportion:
          input.header.deductibleProportion === undefined
            ? undefined
            : decimalToBasisPoints(input.header.deductibleProportion),
        note: input.header.note ?? null,
      })
      .returning(HEADER_SELECT);
    header = mapHeader(row!);
  } catch (error) {
    if (isUniqueViolation(error)) {
      // A translation, not a recovery: the row was refused and nothing here retries it. The
      // AppError leaves the caller's transaction, which rolls back with it; what this buys is a
      // structured code rather than a raw driver string.
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

/** The header plus its VAT lines, or null when no invoice with `id` exists. */
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
 * Every invoice (header + lines), optionally narrowed to a half-open `received_on` window —
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

  // `total` crosses to cents and `deductibleProportion` to basis points; the rest pass through.
  // An absent field stays `undefined`, which drizzle's `set` leaves out of the statement.
  const { total, deductibleProportion, ...header } = patch.header ?? {};
  const updated = await tx
    .update(purchaseInvoices)
    .set({
      ...header,
      total: total === undefined ? undefined : decimalToCents(total),
      deductibleProportion:
        deductibleProportion === undefined ? undefined : decimalToBasisPoints(deductibleProportion),
      updatedAt: now(),
    })
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
