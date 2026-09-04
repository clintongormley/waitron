import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import "./index.js";

// One assertion per receipt.* / canvas.* / theme.* code: each is constructible via
// `new AppError(code, params)` carrying the params errors.ts declares for it. The construction
// typechecks ONLY because errors.ts's `declare module "@waitron/shared"` augmentation is loaded —
// index.js imports it — which is what makes the codes and their param shapes real for a consumer,
// mirroring packages/sync/src/errors.test.ts.
describe("the receipt / canvas / theme error codes carry their declared params", () => {
  it("constructs receipt.invalid with the optional field + maxLength context", () => {
    const error = new AppError("receipt.invalid", {
      reason: "too_long",
      field: "footerMessage",
      maxLength: 200,
    });
    expect(error.code).toBe("receipt.invalid");
    expect(error.params).toEqual({ reason: "too_long", field: "footerMessage", maxLength: 200 });
  });

  it("constructs canvas.invalid with a reason and a numeric tabIndex", () => {
    const error = new AppError("canvas.invalid", { reason: "bad_tab", tabIndex: 2 });
    expect(error.code).toBe("canvas.invalid");
    expect(error.params).toEqual({ reason: "bad_tab", tabIndex: 2 });
  });

  it("constructs canvas.invalid with the optional card (a CardType) + configKey context", () => {
    const error = new AppError("canvas.invalid", {
      reason: "bad_config",
      tabIndex: 0,
      card: "product-grid",
      configKey: "columns",
    });
    expect(error.code).toBe("canvas.invalid");
    expect(error.params).toEqual({
      reason: "bad_config",
      tabIndex: 0,
      card: "product-grid",
      configKey: "columns",
    });
  });

  it("constructs canvas.not_found with no params", () => {
    const error = new AppError("canvas.not_found", {});
    expect(error.code).toBe("canvas.not_found");
    expect(error.params).toEqual({});
  });

  it("constructs canvas.name_taken with no params", () => {
    const error = new AppError("canvas.name_taken", {});
    expect(error.code).toBe("canvas.name_taken");
    expect(error.params).toEqual({});
  });

  it("constructs theme.invalid with a reason and a policy maxLength", () => {
    const error = new AppError("theme.invalid", {
      reason: "too_long",
      token: "--wt-color-primary",
      maxLength: 64,
    });
    expect(error.code).toBe("theme.invalid");
    expect(error.params).toEqual({
      reason: "too_long",
      token: "--wt-color-primary",
      maxLength: 64,
    });
  });
});
