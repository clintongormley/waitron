import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import * as barrel from "./index.js";

/** A SMOKE test: it constructs the `close.*` codes via `AppError` and confirms the barrel loads. It
 * does NOT prove the augmentation is reachable from external consumers — per CLAUDE.md §4 this pattern
 * (mirrored across the repo) can pass even if the barrel stops importing `./errors.js`, because
 * tsconfig `include: ["src"]` makes the declaration visible regardless of the import graph. Do not
 * cite it as a reachability receipt. Mirrors packages/identity/src/errors.reachability.test.ts. */
describe("the reporting close error codes construct via the barrel (smoke, not reachability)", () => {
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
