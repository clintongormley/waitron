import type { PaperWidth } from "@waitron/printing";

import type { VenueReceiptConfig } from "@waitron/shared";

export type ReceiptConfig = VenueReceiptConfig;

/** A 1-bit logo raster as the receipt row keeps it: `data` is base64 of rows MSB-first, each padded to a whole byte. */
export interface StoredLogoRaster {
  widthDots: number;
  heightDots: number;
  data: string;
}

/** One raster per paper width, derived by the server when the logo is saved. */
export type ReceiptLogoRasters = Record<PaperWidth, StoredLogoRaster>;
