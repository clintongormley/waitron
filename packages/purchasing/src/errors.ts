// A bare side-effect import so TypeScript augments the real "@waitron/shared" module rather than
// declaring a fresh ambient one.
import "@waitron/shared";

/**
 * packages/purchasing's contribution to the shared error registry, by declaration merging. The
 * concept here is the received purchase invoice, so the prefix is `purchase.*`: never `purchasing.*`
 * (the package name) or `invoice.*` (which would collide with the invoices WE issue).
 *
 * Codes are never renamed once shipped: a wrong one is deprecated and a new one added beside it.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** No purchase invoice with this id exists. `id` is the id looked up. */
    "purchase.not_found": { id: string };
    /** The `(supplier_tax_id, supplier_invoice_number)` unique index rejected a second entry
     * of the same supplier invoice (the VAT record-book no-duplicate rule). */
    "purchase.duplicate": { supplierTaxId: string; supplierInvoiceNumber: string };
    /** A supplied invoice was rejected before any write: no VAT lines, a negative base or VAT amount, or a
     * rate/proportion outside 0–100. `reason` is a stable English discriminator, never a user-facing
     * sentence. */
    "purchase.invalid": { reason: string };
  }
}
