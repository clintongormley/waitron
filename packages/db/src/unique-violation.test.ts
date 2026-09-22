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

/**
 * Every fixture here carries a NUMBER on `errcode`, which is what `node:sqlite` discriminates a
 * refusal by: `code` is the constant `"ERR_SQLITE_ERROR"` on every failure alike, so a fixture
 * spelling its refusal on `code` states nothing this predicate can read, and a case built that way
 * answers `false` whichever refusal it meant. The three numbers below are the engine's own, measured
 * on Node v26.7.0 by refusing one real write of each kind — a second row on a unique index (2067),
 * a repeated `integer primary key` (1555), and a child row naming no parent (787).
 */
const UNIQUE_INDEX = 2067;
const PRIMARY_KEY = 1555;
const FOREIGN_KEY = 787;

// Sibling case, on the same predicate through a REAL refusal rather than a hand-built error:
// packages/fiscal-verifactu/src/chain.test.ts's "rejects a second record claiming an occupied
// chain position".
describe("isUniqueViolation", () => {
  it("recognises a bare driver error", () => {
    expect(isUniqueViolation(Object.assign(new Error("dup"), { errcode: UNIQUE_INDEX }))).toBe(
      true,
    );
  });

  it("recognises a primary-key collision as the same class", () => {
    // SQLite splits what PostgreSQL folded into one SQLSTATE: a primary key refuses under its own
    // result code. A caller asking "was this key already taken?" must get the same answer for both,
    // which is why `UNIQUE_VIOLATION` is a list (./sql-state.ts).
    expect(isUniqueViolation(Object.assign(new Error("dup"), { errcode: PRIMARY_KEY }))).toBe(true);
  });

  it("recognises a violation wrapped in a cause chain", () => {
    // Drizzle wraps a failed query in a DrizzleQueryError whose own fields are undefined; a guard
    // that only inspects the top level would misreport a genuine violation as something else
    // entirely. (This driver hands most refusals over unwrapped — measured in ./tenancy.test.ts —
    // so the walk is what makes the predicate indifferent to which.)
    const inner = Object.assign(new Error("dup"), { errcode: UNIQUE_INDEX });
    expect(
      isUniqueViolation(new Error("outer", { cause: new Error("mid", { cause: inner }) })),
    ).toBe(true);
  });

  it("does not treat a foreign-key violation as a unique violation", () => {
    // The control on every case above: a refusal the engine DID report, of a class this predicate
    // must not claim. Without it a predicate that read nothing at all would pass them too.
    expect(isUniqueViolation(Object.assign(new Error("fk"), { errcode: FOREIGN_KEY }))).toBe(false);
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
    const violation = { errcode: UNIQUE_INDEX };
    expect(isUniqueViolation(wrapped(4, violation))).toBe(true);
    expect(isUniqueViolation(wrapped(5, violation))).toBe(false);
  });

  it("does not read a link that is not an object as an error layer", () => {
    // The walk asks `typeof current === "object"` before touching the link, and a function is the
    // only non-object that can carry an `errcode` property at all — so it is the one value that
    // shows that question doing something. Drop the question and this chain reports a violation
    // that no driver ever raised; the second expectation is the control, the same `errcode` on a
    // plain object, which the walk does read.
    const notAnError = Object.assign(() => {}, { errcode: UNIQUE_INDEX });
    expect(isUniqueViolation(new Error("outer", { cause: notAnError }))).toBe(false);
    expect(isUniqueViolation(new Error("outer", { cause: { errcode: UNIQUE_INDEX } }))).toBe(true);
  });

  it("returns false for a non-object value", () => {
    // `current != null && typeof current === "object"` is the guard on every iteration; null,
    // undefined and primitives all take the same false-returning path without matching either.
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("dup key")).toBe(false);
  });
});
