/**
 * The cause WALK and `sameTarget` — the parts of `./constraint-target.ts` that turn on the shape of
 * an error object rather than on one engine's words. `./constraint-target.sqlite.test.ts` asks the
 * message-grammar questions against REAL `node:sqlite` refusals; a second copy driven by crafted
 * strings would only prove the parser reads itself.
 *
 * WHAT IS LEFT IS WHAT THAT FILE CANNOT DRIVE. No engine emits a cause chain five layers deep, a
 * cause that points at itself, or a layer carrying a result code with no message — so these cases
 * are crafted, and they are the only ones that reach `causeLayers`' bound and its self-reference
 * guard, and `refusalOn`'s two `continue`s.
 *
 * THE CRAFTED SHAPES CARRY `errcode`, NOT `code`. `node:sqlite` puts `"ERR_SQLITE_ERROR"` on `code`
 * for every failure alike and the discriminating number on `errcode` (`./sql-state.ts`), so a stub
 * built on `code` would be read as carrying no result code at all — and every negative assertion
 * on it would pass for the wrong reason.
 */
import { describe, expect, it } from "vitest";
import { constraintTarget, refusalOn, sameTarget } from "./constraint-target.js";
import { UNIQUE_VIOLATION } from "./sql-state.js";
import { isRefusal } from "./unique-violation.js";

describe("constraintTarget's cause walk", () => {
  /** One layer shaped the way `node:sqlite` shapes a real unique-index refusal. */
  const violation = Object.assign(new Error("UNIQUE constraint failed: people.email"), {
    errcode: 2067,
  });
  const wrapped = (depth: number, inner: unknown): unknown => {
    let error = inner;
    for (let i = 0; i < depth; i++) error = new Error(`layer ${i}`, { cause: error });
    return error;
  };

  it("finds a violation four layers down and gives up on the fifth", () => {
    expect(constraintTarget(wrapped(4, violation))).toEqual({
      table: "people",
      columns: ["email"],
    });
    expect(constraintTarget(wrapped(5, violation))).toBeUndefined();
  });

  // No engine can produce this: the CLASS on one layer and the key on another. It is the one shape
  // that separates refusalOn's same-layer rule from asking the two questions separately. The
  // outer layer carries the key under the WRONG class (a CHECK's result code with a unique index's
  // words) and the inner layer carries the RIGHT class with no key, so no single layer answers both
  // questions.
  it("refusalOn does not join a code on one layer to a key on another", () => {
    const split = Object.assign(new Error("UNIQUE constraint failed: people.email"), {
      errcode: 275,
      cause: Object.assign(new Error("some other refusal"), { errcode: 2067 }),
    });
    expect(refusalOn(split, UNIQUE_VIOLATION, { table: "people", columns: ["email"] })).toBe(false);
    // …while the two questions asked separately DO join them, which is the difference.
    expect(sameTarget(constraintTarget(split), { table: "people", columns: ["email"] })).toBe(true);
  });

  // The layer carrying the result code names a DIFFERENT key, so the walk must carry on past it
  // rather than answer false — the deeper layer is the one that matches.
  it("refusalOn keeps walking past a matching class whose key is a different one", () => {
    const outerKeyDiffers = Object.assign(new Error("UNIQUE constraint failed: people.nickname"), {
      errcode: 2067,
      cause: violation,
    });
    expect(
      refusalOn(outerKeyDiffers, UNIQUE_VIOLATION, { table: "people", columns: ["email"] }),
    ).toBe(true);
  });

  it("does not spin on a self-referential cause", () => {
    const looped: { cause?: unknown } = {};
    looped.cause = looped;
    expect(constraintTarget(looped)).toBeUndefined();
  });

  it("returns undefined for values that are not errors at all", () => {
    expect(constraintTarget(null)).toBeUndefined();
    expect(constraintTarget(undefined)).toBeUndefined();
    expect(constraintTarget("dup key")).toBeUndefined();
    // `refusalCode`'s own "nothing in this chain carries a result code" answer, asked through the
    // predicate that reads it. Without this line that branch is the one statement in
    // `constraint-target.ts` neither this file nor the SQLite suite reaches.
    expect(
      isRefusal(new Error("not a refusal", { cause: new Error("nor this") }), UNIQUE_VIOLATION),
    ).toBe(false);
  });

  // A layer whose `message` is not a string is the shape `refusalOn` and `constraintTarget` each
  // guard against.
  it("ignores a layer that carries a result code but no message", () => {
    const noMessage = { errcode: 2067, message: 42 };
    expect(constraintTarget(noMessage)).toBeUndefined();
    expect(refusalOn(noMessage, UNIQUE_VIOLATION, { table: "people", columns: ["email"] })).toBe(
      false,
    );
  });

  // The prefix is there and the tail is empty, so there is no `table.column` to read.
  it("treats an empty key as no key at all", () => {
    expect(
      constraintTarget(Object.assign(new Error("UNIQUE constraint failed: "), { errcode: 2067 })),
    ).toBeUndefined();
  });

  // A refusal class that names no key at all: a CHECK reports its constraint's NAME, which is not a
  // `table.column` pair.
  it("ignores a layer whose message names no key", () => {
    expect(
      constraintTarget(
        Object.assign(new Error("CHECK constraint failed: people_age_ck"), { errcode: 275 }),
      ),
    ).toBeUndefined();
  });
});

describe("sameTarget", () => {
  const target = { table: "persons", columns: ["lower(email)"] } as const;

  it("is true for the same table and the same columns", () => {
    expect(sameTarget({ table: "persons", columns: ["lower(email)"] }, target)).toBe(true);
  });

  it("is false for a different table", () => {
    expect(sameTarget({ table: "people", columns: ["lower(email)"] }, target)).toBe(false);
  });

  it("is false for a different column", () => {
    expect(sameTarget({ table: "persons", columns: ["email"] }, target)).toBe(false);
  });

  it("is false for a longer column list that starts the same way", () => {
    expect(sameTarget({ table: "persons", columns: ["lower(email)", "id"] }, target)).toBe(false);
  });

  // Column ORDER is part of the identity: `(location_id, name)` and `(name, location_id)` are two
  // different indexes, and the engine reports each in its own declared order.
  it("is false when the same columns arrive in the other order", () => {
    const pair = { table: "tills", columns: ["location_id", "name"] } as const;
    expect(sameTarget({ table: "tills", columns: ["name", "location_id"] }, pair)).toBe(false);
  });

  it("is false when there is no target at all", () => {
    expect(sameTarget(undefined, target)).toBe(false);
  });
});
