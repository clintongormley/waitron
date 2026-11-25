import type { readRecoveryPackPdf } from "./read-pack-pdf.js";

/** Loads the recovery pack PDF reader when first called, so pdf-lib stays in a chunk of its own. */
export const loadRecoveryPackReader = (): Promise<typeof readRecoveryPackPdf> =>
  import("./read-pack-pdf.js").then((module) => module.readRecoveryPackPdf);
