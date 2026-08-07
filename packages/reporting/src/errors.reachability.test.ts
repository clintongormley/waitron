import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import * as barrel from "./index.js";

/** The augmentation is only real if it is reachable from the public barrel — a declaration in a
 * file nothing imports type-checks locally and vanishes for every consumer. Mirrors
 * packages/identity/src/errors.reachability.test.ts. */
describe("the reporting close error codes reach the public barrel", () => {
  it("constructs a close AppError (close.already_closed) with typed params", () => {
    const error = new AppError("close.already_closed", { businessDay: "2026-08-04" });
    expect(error.code).toBe("close.already_closed");
    expect(error.params).toEqual({ businessDay: "2026-08-04" });
  });

  it("constructs a close AppError (close.invalid_cash_input) with typed params", () => {
    const error = new AppError("close.invalid_cash_input", {
      tillId: "33333333-3333-4333-8333-333333333333",
      reason: "negative_counted_cash",
    });
    expect(error.code).toBe("close.invalid_cash_input");
    expect(error.params).toEqual({
      tillId: "33333333-3333-4333-8333-333333333333",
      reason: "negative_counted_cash",
    });
  });

  it("re-exports something, so the barrel is genuinely loaded", () => {
    expect(Object.keys(barrel).length).toBeGreaterThan(0);
  });
});
