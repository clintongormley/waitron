// `apps/setup` does not depend on `@waitron/provisioning`, so the setup page keeps its own copy of
// the default series codes.
import { expect, it } from "vitest";
import { DEFAULT_SERIES_CODES } from "../packages/provisioning/src/default-series-codes.js";
import { DEFAULT_SERIES_CODES as SETUP_DEFAULT_SERIES_CODES } from "../apps/setup/src/default-series-codes.js";

it("the setup page's and provisioning's default series codes are equal and are S, F, SR and FR", () => {
  expect(SETUP_DEFAULT_SERIES_CODES).toEqual(DEFAULT_SERIES_CODES);
  expect(DEFAULT_SERIES_CODES).toEqual({
    seriesCode: "S",
    fullSeriesCode: "F",
    correctiveSeriesCode: "SR",
    fullCorrectiveSeriesCode: "FR",
  });
});
