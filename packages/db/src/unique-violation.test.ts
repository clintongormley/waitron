import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "./unique-violation.js";

// Mirrors packages/fiscal-verifactu/src/chain.test.ts's identical suite for its own,
// independently-written copy of this exact check — see ./unique-violation.ts's own doc comment
// for why the two are not (yet) consolidated into one.
describe("isUniqueViolation", () => {
  it("recognises a bare driver error", () => {
    expect(isUniqueViolation(Object.assign(new Error("dup"), { code: "23505" }))).toBe(true);
  });

  it("recognises a violation wrapped in a cause chain", () => {
    // Drizzle wraps every failed query in a DrizzleQueryError whose own `.code` is undefined; a
    // guard that only inspects the top level would misreport a genuine violation as something
    // else entirely.
    const inner = Object.assign(new Error("dup"), { code: "23505" });
    expect(
      isUniqueViolation(new Error("outer", { cause: new Error("mid", { cause: inner }) })),
    ).toBe(true);
  });

  it("does not treat a foreign-key violation as a unique violation", () => {
    // 23503, not 23505.
    expect(isUniqueViolation(Object.assign(new Error("fk"), { code: "23503" }))).toBe(false);
  });

  it("terminates on a self-referential cause chain", () => {
    const looped: Error & { cause?: unknown } = new Error("loop");
    looped.cause = looped;
    expect(isUniqueViolation(looped)).toBe(false);
  });

  it("returns false for a non-object value", () => {
    // `error != null && typeof error === "object"` is the guard on every iteration; null,
    // undefined and primitives all take the same false-returning path without matching either.
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("dup key")).toBe(false);
  });
});
