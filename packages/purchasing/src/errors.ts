// A bare side-effect import so TypeScript augments the real "@waitron/shared" module rather than
// declaring a fresh ambient one — the idiom packages/reporting, packages/identity use.
import "@waitron/shared";

/**
 * packages/purchasing's contribution to the shared error registry, by declaration merging — the
 * DOMAIN-CONCEPT, lowercase, dot-namespaced convention, never the package name. The concept here is
 * the received purchase invoice (factura recibida), so the prefix is `purchase.*` — grepped against
 * the registry first: never `purchasing.*` (the package name) or `invoice.*` (which would collide
 * with the invoices WE issue). Thrown by the CRUD operations; every file that throws one imports
 * "./errors.js" so the augmentation is reachable from this package's own barrel.
 *
 * Codes are never renamed once shipped: a wrong one is deprecated and a new one added beside it.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** No purchase invoice with this id is visible in the current tenant. `id` is the id looked up. */
    "purchase.not_found": { id: string };
    /** The `(tenant, supplier_tax_id, supplier_invoice_number)` unique index rejected a second entry
     * of the same supplier invoice (the libro-registro no-duplicate rule). */
    "purchase.duplicate": { supplierTaxId: string; supplierInvoiceNumber: string };
    /** A supplied invoice was rejected before any write: no VAT lines, a negative base or cuota, or a
     * rate/proportion outside 0–100. `reason` is a stable English discriminator, never a user-facing
     * sentence. */
    "purchase.invalid": { reason: string };
  }
}
