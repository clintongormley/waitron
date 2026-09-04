import { describe, expect, it } from "vitest";
import { AppError, isAppError } from "@waitron/shared";
import "./errors.js";

describe("module error registry", () => {
  it("constructs each module.* code with its params", () => {
    const e = new AppError("module.config_unknown", { module: "nope" });
    expect(isAppError(e) && e.code).toBe("module.config_unknown");
  });
});
