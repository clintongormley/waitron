import type { Database } from "@waitron/db";
import {
  imageExists,
  readImageBytes,
  renderRendition,
  renditionUrl,
  type ImageFraming,
} from "@waitron/media";
import { drawPreviewLogo, type LogoCache } from "@waitron/orders-sales/receipt-logo.js";
import type { MonoRaster, PaperWidth } from "@waitron/printing";

export * from "@waitron/orders-sales/receipt-logo.js";

/** A library image as it stands now: its source file and framing. */
export interface CurrentLibraryImage {
  readonly sourceFilename: string;
  readonly framing: ImageFraming;
}

/** The display rendition a preview draws from, spelled as the library's presentation spells it. */
export function previewLogoAddress(current: CurrentLibraryImage): string {
  return renditionUrl(current.sourceFilename, "display", current.framing);
}

/** `drawPreviewLogo` for the library image `filename` as it stands in `current`. */
export function drawLibraryLogo(
  db: Database,
  cache: LogoCache,
  filename: string,
  current: CurrentLibraryImage,
  paperWidth: PaperWidth,
): Promise<MonoRaster | null> {
  return drawPreviewLogo(cache, previewLogoAddress(current), paperWidth, {
    exists: () => imageExists(db, filename),
    bytes: async () => {
      const source = await readImageBytes(db, current.sourceFilename);
      return source ? renderRendition(source.bytes, "display", current.framing) : null;
    },
  });
}
