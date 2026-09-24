import { describe, expect, it } from "vitest";
import * as api from "./index.js";

// Loading this barrel is also what exercises errors.ts's registry side-effect. Only VALUE exports
// appear in `Object.keys`; the type-only exports are erased.
describe("the public surface", () => {
  it("exports exactly the intended names", () => {
    expect(Object.keys(api).sort()).toEqual([
      "NOT_FOUND_GRACE_MS",
      "RESOLVE_RETRY_MS",
      "SUMUP_CARD_PROVIDER",
      "SUMUP_PROVIDER",
      "SumUpCloudProvider",
      "fromMajorUnits",
      "sumupClient",
      "toMinorUnits",
    ]);
  });
});
