/**
 * The authorable, NON-FISCAL receipt trim. No field here may suppress or reorder a mandated receipt
 * element. `apps/till/src/layout.ts` and the dashboard keep their own copies of this shape.
 */
export interface ReceiptConfig {
  headerSubtitle?: string;
  footerMessage?: string;
}
