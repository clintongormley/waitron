import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import "./index.js";

describe("the receipt / theme error codes carry their declared params", () => {
  it("constructs receipt.invalid with the optional field + maxLength context", () => {
    const error = new AppError("receipt.invalid", {
      reason: "too_long",
      field: "footerMessage",
      maxLength: 200,
    });
    expect(error.code).toBe("receipt.invalid");
    expect(error.params).toEqual({ reason: "too_long", field: "footerMessage", maxLength: 200 });
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
