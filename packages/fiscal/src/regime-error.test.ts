import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import "./errors.js";

/** Asserts the code's registration and param shape only, not who throws it. */
describe("fiscal.regime_not_implemented", () => {
  it("fiscal.regime_not_implemented carries the offending territory", () => {
    const err = new AppError("fiscal.regime_not_implemented", { territory: "ES-PV-bizkaia" });
    expect(err.code).toBe("fiscal.regime_not_implemented");
    expect(err.params).toEqual({ territory: "ES-PV-bizkaia" });
  });
});
