import { describe, expect, it } from "vitest";
import { isUniqueViolation, uniqueViolationConstraint } from "./unique-violation.js";

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

describe("uniqueViolationConstraint", () => {
  it("returns the constraint name from a bare 23505 driver error", () => {
    expect(
      uniqueViolationConstraint(
        Object.assign(new Error("dup"), { code: "23505", constraint: "persons_tenant_email_uq" }),
      ),
    ).toBe("persons_tenant_email_uq");
  });

  it("returns the constraint name through a Drizzle-wrapped cause chain", () => {
    const inner = Object.assign(new Error("dup"), { code: "23505", constraint: "some_uq" });
    expect(uniqueViolationConstraint(new Error("outer", { cause: inner }))).toBe("some_uq");
  });

  it("returns undefined when the 23505 layer carries no constraint name (e.g. PGlite)", () => {
    expect(uniqueViolationConstraint(Object.assign(new Error("dup"), { code: "23505" }))).toBe(
      undefined,
    );
  });

  it("returns undefined for a non-23505 error", () => {
    expect(
      uniqueViolationConstraint(
        Object.assign(new Error("fk"), { code: "23503", constraint: "some_fk" }),
      ),
    ).toBe(undefined);
  });

  it("returns undefined for a non-object value and terminates on a self-referential chain", () => {
    expect(uniqueViolationConstraint(null)).toBe(undefined);
    const looped: { code: string; cause?: unknown } = { code: "1" };
    looped.cause = looped;
    expect(uniqueViolationConstraint(looped)).toBe(undefined);
  });
});
