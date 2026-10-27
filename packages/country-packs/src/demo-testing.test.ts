import { expect, it } from "vitest";
import { DEMO_BASELINE_FIXTURE_ROOTS } from "./demo-testing.js";
it("lists the pack-owned baseline fixture roots by demo id", () => {
  expect(Object.keys(DEMO_BASELINE_FIXTURE_ROOTS)).toEqual(["casa-delgado-es"]);
  expect(DEMO_BASELINE_FIXTURE_ROOTS["casa-delgado-es"]?.pathname).toMatch(
    /country-es\/test-fixtures\/demo\/$/,
  );
});
