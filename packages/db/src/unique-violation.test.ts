import { describe, expect, it } from "vitest";
import {
  isUniqueViolation,
  pgErrorConstraint,
  uniqueViolationConstraint,
} from "./unique-violation.js";

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

describe("pgErrorConstraint", () => {
  // The SQLSTATE-parameterised walk that `uniqueViolationConstraint` (fixed to 23505) and
  // apps/server's `bindingFkField` (fixed to 23503) both delegate to.
  it("returns the constraint name from a bare error whose code matches the sqlstate", () => {
    expect(
      pgErrorConstraint(
        Object.assign(new Error("fk"), {
          code: "23503",
          constraint: "devices_receipt_printer_fk",
        }),
        "23503",
      ),
    ).toBe("devices_receipt_printer_fk");
  });

  it("returns the constraint name through a Drizzle-wrapped cause chain", () => {
    const inner = Object.assign(new Error("fk"), { code: "23503", constraint: "some_fk" });
    expect(pgErrorConstraint(new Error("outer", { cause: inner }), "23503")).toBe("some_fk");
  });

  it("returns undefined when the matching layer carries no constraint name (e.g. PGlite)", () => {
    expect(pgErrorConstraint(Object.assign(new Error("fk"), { code: "23503" }), "23503")).toBe(
      undefined,
    );
  });

  it("returns undefined when no wrapped layer carries the requested sqlstate", () => {
    // A 23505 layer is not a match when 23503 was asked for — the SQLSTATE is the selector.
    expect(
      pgErrorConstraint(
        Object.assign(new Error("dup"), { code: "23505", constraint: "some_uq" }),
        "23503",
      ),
    ).toBe(undefined);
  });

  it("reads five links of the chain and stops", () => {
    // The same bound as isPgError's, asserted here too because the two walks are written out
    // separately and nothing but a test keeps their bounds equal.
    const violation = { code: "23503", constraint: "deep_fk" };
    expect(pgErrorConstraint(wrapped(4, violation), "23503")).toBe("deep_fk");
    expect(pgErrorConstraint(wrapped(5, violation), "23503")).toBe(undefined);
  });

  it("refuses a constraint name the driver did not report as text", () => {
    // The driver reports a string or nothing, and the undefined case is above. This is the other
    // half: whatever else arrives on `.constraint`, a caller is told "unknown" rather than handed a
    // value that is not a name while the return type says it is one.
    const odd = Object.assign(new Error("fk"), { code: "23503", constraint: 42 });
    expect(pgErrorConstraint(odd, "23503")).toBe(undefined);
  });

  it("does not read a link that is not an object as an error layer", () => {
    // The same question as isPgError's, on the other walk, with the same representative.
    const notAnError = Object.assign(() => {}, { code: "23503", constraint: "invented_fk" });
    expect(pgErrorConstraint(new Error("outer", { cause: notAnError }), "23503")).toBe(undefined);
  });

  it("returns undefined for a non-object value and terminates on a self-referential chain", () => {
    expect(pgErrorConstraint(null, "23503")).toBe(undefined);
    const looped: { code: string; cause?: unknown } = { code: "23505" };
    looped.cause = looped;
    expect(pgErrorConstraint(looped, "23503")).toBe(undefined);
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
