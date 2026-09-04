/**
 * Canonical receipt-trim type for @waitron/layouts — the SERVER-SIDE source of truth for a till's
 * receipt trim. The till (`apps/till/src/layout.ts`) and the dashboard keep their own LOCAL copies of
 * this shape, bundle-decoupled, exactly as `apps/till/src/api/client.ts` explains for every server
 * shape; this package is where validation and defaults live.
 */

/**
 * The authorable, NON-FISCAL receipt trim (design §7/§8). Both optional; each a short string rendered
 * AROUND the immutable art. 7.1 core, never able to touch it: `headerSubtitle` under the venue name,
 * `footerMessage` under the VERI*FACTU legend. No field here can suppress or reorder a mandated
 * element — that is the fiscal-safety constraint the receipt editor is built on.
 */
export interface ReceiptConfig {
  headerSubtitle?: string;
  footerMessage?: string;
}
