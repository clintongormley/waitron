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

  it("constructs theme.invalid with a field and a reason, and theme.name_taken with its field", () => {
    const invalid = new AppError("theme.invalid", {
      field: "handSet.light.bg",
      reason: "bad_value",
    });
    expect(invalid.code).toBe("theme.invalid");
    expect(invalid.params).toEqual({ field: "handSet.light.bg", reason: "bad_value" });

    const taken = new AppError("theme.name_taken", { field: "name" });
    expect(taken.code).toBe("theme.name_taken");
    expect(taken.params).toEqual({ field: "name" });
  });
});
