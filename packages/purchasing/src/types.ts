import type { Decimal } from "@waitron/shared";

export type PurchaseRegime = "general" | "equivalence_surcharge";

export type PurchaseVatKind = "ordinary" | "capital";

/** One per-rate VAT line of a received invoice. `tax` is the VAT amount (input VAT), filed verbatim. */
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
  /** Percentage 0–100 of the input VAT that is deductible (partial-deductibility seam); default "100.00". */
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
