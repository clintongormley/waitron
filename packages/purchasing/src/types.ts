import type { Decimal } from "@waitron/shared";

/**
 * The VAT regime a received invoice is treated under (mirrors the `purchase_regime` enum).
 * `general` = régimen general (deductible, on the 303); `equivalence_surcharge` = recargo de
 * equivalencia (non-deductible, off the 303 — excluded from the deducible aggregate).
 */
export type PurchaseRegime = "general" | "equivalence_surcharge";

/**
 * What a VAT line was spent on (mirrors the `purchase_vat_kind` enum): `ordinary` = operaciones
 * corrientes (casilla 28/29); `capital` = bienes de inversión (casilla 30/31).
 */
export type PurchaseVatKind = "ordinary" | "capital";

/** One per-rate VAT line of a received invoice. `tax` is the cuota (IVA soportado), filed verbatim. */
export interface PurchaseInvoiceLine {
  rate: Decimal;
  base: Decimal;
  tax: Decimal;
  kind: PurchaseVatKind;
}

/** A received supplier invoice as read back: the header plus its per-rate VAT lines. */
export interface PurchaseInvoice {
  id: string;
  supplierTaxId: string;
  supplierName: string;
  supplierInvoiceNumber: string;
  /** "YYYY-MM-DD" civil date. */
  issuedOn: string;
  /** "YYYY-MM-DD" civil date — drives the deduction period. */
  receivedOn: string;
  total: Decimal;
  regime: PurchaseRegime;
  /** Percentage 0–100 of the input VAT that is deductible (prorrata seam); default "100.00". */
  deductibleProportion: Decimal;
  note: string | null;
  lines: PurchaseInvoiceLine[];
}

/** The header fields supplied on create (mutable record; `regime`/`deductibleProportion` default). */
export interface PurchaseInvoiceHeaderInput {
  supplierTaxId: string;
  supplierName: string;
  supplierInvoiceNumber: string;
  issuedOn: string;
  receivedOn: string;
  total: Decimal;
  regime?: PurchaseRegime;
  deductibleProportion?: Decimal;
  note?: string | null;
}

/** A VAT line supplied on create/update; `kind` defaults to `ordinary`. */
export interface PurchaseInvoiceLineInput {
  rate: Decimal;
  base: Decimal;
  tax: Decimal;
  kind?: PurchaseVatKind;
}

export interface CreatePurchaseInvoiceInput {
  header: PurchaseInvoiceHeaderInput;
  lines: PurchaseInvoiceLineInput[];
}

/** A header patch (any subset) and, optionally, a full replacement of the VAT lines. */
export interface UpdatePurchaseInvoiceInput {
  header?: Partial<PurchaseInvoiceHeaderInput>;
  /** When present, REPLACES all VAT lines (validated like create); omitted leaves them unchanged. */
  lines?: PurchaseInvoiceLineInput[];
}

/** Inclusive-lower/exclusive-upper `received_on` bounds for `listPurchaseInvoices` (both optional). */
export interface ListPurchaseInvoicesInput {
  /** "YYYY-MM-DD" inclusive lower bound on `received_on`. */
  from?: string;
  /** "YYYY-MM-DD" exclusive upper bound on `received_on`. */
  to?: string;
}
