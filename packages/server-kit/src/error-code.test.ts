import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { codeOf } from "./error-code.js";

describe("codeOf", () => {
  it("returns an AppError's own code", () => {
    expect(codeOf(new AppError("shared.invalid_id", { kind: "TillId", value: "x" }))).toBe(
      "shared.invalid_id",
    );
  });

  it("classifies anything else as `unknown`, never surfacing its message", () => {
    // A message a driver could load with a secret — codeOf must not echo it.
    expect(codeOf(new Error("postgres://user:s3cr3t@db/prod"))).toBe("unknown");
    expect(codeOf("a bare string")).toBe("unknown");
    expect(codeOf(undefined)).toBe("unknown");
  });
});
