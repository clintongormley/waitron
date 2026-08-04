import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import "./errors.js";

/**
 * `fiscal.regime_not_implemented` is registered in ./errors.ts by declaration merging. This asserts
 * only that the code constructs and carries its `{ territory }` param — the registry membership and
 * param shape — not who throws it (that lives with `resolveFiscalModules` in @waitron/provisioning,
 * Task B2, and its runtime re-raisers). The reachability check for the augmenting file itself is in
 * ./errors.reachability.test.ts, which is a pure import-graph walk and constructs no AppError.
 */
describe("fiscal.regime_not_implemented", () => {
  it("fiscal.regime_not_implemented carries the offending territory", () => {
    const err = new AppError("fiscal.regime_not_implemented", { territory: "ES-PV-bizkaia" });
    expect(err.code).toBe("fiscal.regime_not_implemented");
    expect(err.params).toEqual({ territory: "ES-PV-bizkaia" });
  });
});
