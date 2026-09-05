import { describe, expect, it } from "vitest";
import { AppError, isAppError } from "@waitron/shared";
import "./errors.js";

describe("module error registry", () => {
  it("constructs each module.* code with its params", () => {
    const e = new AppError("module.config_unknown", { module: "nope" });
    expect(isAppError(e) && e.code).toBe("module.config_unknown");
  });

  it("constructs the SP-1c ordering codes with their params", () => {
    const missing = new AppError("module.dependency_missing", {
      module: "workforce",
      requires: "identity",
    });
    expect(isAppError(missing) && missing.code).toBe("module.dependency_missing");
    const cycle = new AppError("module.dependency_cycle", { modules: ["a", "b"] });
    expect(isAppError(cycle) && cycle.code).toBe("module.dependency_cycle");
    const incompat = new AppError("module.incompatible_version", {
      module: "workforce",
      dependency: "identity",
      required: ">=1.0.0",
      actual: "0.0.0",
    });
    expect(isAppError(incompat) && incompat.code).toBe("module.incompatible_version");
    const invalid = new AppError("module.requires_invalid", {
      module: "workforce",
      dependency: "core",
      range: "not-a-range",
    });
    expect(isAppError(invalid) && invalid.code).toBe("module.requires_invalid");
  });

  it("constructs the fiscal-slot codes with their params", () => {
    const empty = new AppError("module.fiscal_slot_empty", {});
    expect(isAppError(empty) && empty.code).toBe("module.fiscal_slot_empty");
    const ambiguous = new AppError("module.fiscal_slot_ambiguous", { candidates: ["a", "b"] });
    expect(isAppError(ambiguous) && ambiguous.code).toBe("module.fiscal_slot_ambiguous");
    const mismatch = new AppError("module.fiscal_slot_mismatch", { stamped: "b", enabled: "a" });
    expect(isAppError(mismatch) && mismatch.code).toBe("module.fiscal_slot_mismatch");
  });
});
