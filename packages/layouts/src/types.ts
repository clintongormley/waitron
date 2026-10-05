import type { PaperWidth } from "@waitron/printing";

/**
 * The authorable, NON-FISCAL receipt trim. No field here may suppress or reorder a mandated receipt
 * element. `apps/till/src/layout.ts` and the dashboard keep their own copies of this shape.
 */
export interface ReceiptConfig {
  headerSubtitle?: string;
  footerMessage?: string;
  phone?: string;
  email?: string;
  /** Absent prints the till's location address; `false` prints none. */
  printAddress?: boolean;
  /** A `@waitron/media` library filename. */
  logo?: string;
}

/** A 1-bit logo raster as the receipt row keeps it: `data` is base64 of rows MSB-first, each padded to a whole byte. */
export interface StoredLogoRaster {
  widthDots: number;
  heightDots: number;
  data: string;
}

/** One raster per paper width, derived by the server when the logo is saved. */
export type ReceiptLogoRasters = Record<PaperWidth, StoredLogoRaster>;
