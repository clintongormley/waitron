/**
 * The four series codes the venue step offers pre-filled. A copy of `@waitron/provisioning`'s
 * `DEFAULT_SERIES_CODES`, kept equal by `scripts/default-series-codes.test.ts`.
 */
export const DEFAULT_SERIES_CODES = {
  seriesCode: "S",
  fullSeriesCode: "F",
  correctiveSeriesCode: "SR",
  fullCorrectiveSeriesCode: "FR",
} as const;
