/**
 * The four series codes the setup page offers pre-filled. The setup page's routes require every
 * code except the full-corrective one, which falls back here when left out; the command-line tool
 * also lets the full code be left out, and falls back here for both. The standard and corrective
 * entries are read by no server code: they are here so `scripts/default-series-codes.test.ts`
 * checks the setup page's whole copy against one set.
 */
export const DEFAULT_SERIES_CODES = {
  seriesCode: "S",
  fullSeriesCode: "F",
  correctiveSeriesCode: "SR",
  fullCorrectiveSeriesCode: "FR",
} as const;
