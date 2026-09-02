import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import "./index.js"; // loads the barrel, which loads errors.ts

describe("membership error registry", () => {
  it("constructs membership.key_invalid with its params", () => {
    const e = new AppError("membership.key_invalid", { operation: "sign" });
    expect(e.code).toBe("membership.key_invalid");
    expect(e.params).toEqual({ operation: "sign" });
  });
});
