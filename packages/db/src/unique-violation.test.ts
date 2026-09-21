import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "./unique-violation.js";

/**
 * `wrappers` Error links wrapping `tail`, so `tail` sits at index `wrappers` of the cause chain —
 * the shape Drizzle and the driver build between them, made as deep as a test needs.
 */
function wrapped(wrappers: number, tail: unknown): unknown {
  let current = tail;
  for (let i = 0; i < wrappers; i++) current = new Error(`wrapper ${i}`, { cause: current });
  return current;
}

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

  it("reads five links of the chain and stops", () => {
    // The walk is bounded so a cause chain that loops cannot spin forever, and five is the bound.
    // Both directions matter: a bound that stopped one link early would miss a real violation, and
    // one that never stopped would not be a bound at all.
    const violation = { code: "23505" };
    expect(isUniqueViolation(wrapped(4, violation))).toBe(true);
    expect(isUniqueViolation(wrapped(5, violation))).toBe(false);
  });

  it("does not read a link that is not an object as an error layer", () => {
    // The walk asks `typeof current === "object"` before touching the link, and a function is the
    // only non-object that can carry a `code` property at all — so it is the one value that shows
    // that question doing something. Drop the question and this chain reports a violation that no
    // driver ever raised.
    const notAnError = Object.assign(() => {}, { code: "23505" });
    expect(isUniqueViolation(new Error("outer", { cause: notAnError }))).toBe(false);
  });

  it("returns false for a non-object value", () => {
    // `error != null && typeof error === "object"` is the guard on every iteration; null,
    // undefined and primitives all take the same false-returning path without matching either.
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("dup key")).toBe(false);
  });
});
