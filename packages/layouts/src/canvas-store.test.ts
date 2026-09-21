import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { translateWriteError } from "./canvas-store.js";

// The duplicate-name → canvas.name_taken and referenced-delete → canvas.in_use translations, proven
// end to end against a real migrated database in canvas-store.db.test.ts. Here we pin the
// translator's branches directly with crafted errors — no DB — so the re-throw branches are covered
// deterministically. `translateWriteError` is exported from canvas-store.ts for exactly this, not
// from the package barrel. Mirrors identity's `asEmailTaken` unit tests (staff.test.ts).
//
// Each crafted error carries the `errcode` + `message` pair the refusal readers in
// `packages/db/src/constraint-target.ts` look at, copied from what node:sqlite reported for the
// same refusal on Node v26.7.0, 2026-09-21 (the real ones are driven in canvas-store.db.test.ts).
// `code` is deliberately absent: node:sqlite sets it to the constant "ERR_SQLITE_ERROR" for every
// failure alike, so nothing reads it.
describe("translateWriteError", () => {
  it("translates a unique violation that named no key to canvas.name_taken", () => {
    // The fallback branch: a unique violation whose target cannot be identified still translates,
    // because the name key is the only unique an insert/update can trip on an author-supplied value
    // (a primary-key clash is a cryptographically-unreachable newId() collision, and an UPDATE
    // never changes `id`). The message is the shape SQLite uses when the index is over an
    // EXPRESSION: it names the index and no columns, so `constraintTarget` returns undefined.
    let thrown: unknown;
    try {
      translateWriteError({
        cause: { errcode: 2067, message: "UNIQUE constraint failed: index 'canvases_expr_uq'" },
      });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("canvas.name_taken");
    expect(isAppError(thrown) && thrown.params).toEqual({});
  });

  it("translates a unique violation on canvases (name)", () => {
    let thrown: unknown;
    try {
      translateWriteError({
        cause: { errcode: 2067, message: "UNIQUE constraint failed: canvases.name" },
      });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("canvas.name_taken");
  });

  // A unique violation on a DIFFERENT canvases key (the primary key, or any unique added later)
  // must NOT be mislabelled canvas.name_taken — it is re-thrown untouched. Proof-by-deletion: drop
  // the target gate and this fails (the error becomes name_taken). The code is 1555 rather than
  // 2067 because SQLite reports a primary-key collision under its own result code; both are in
  // `UNIQUE_VIOLATION`, so it reaches the branch.
  it("re-throws a unique violation on canvases whose key is not (name)", () => {
    const original = {
      cause: { errcode: 1555, message: "UNIQUE constraint failed: canvases.id" },
    };
    let thrown: unknown;
    try {
      translateWriteError(original);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(original);
  });

  // A restrict refusal (1811) — a delete of a canvas a profile still references → canvas.in_use, no
  // params. Proof-by-deletion: drop the 1811 branch and this becomes the re-throw.
  it("translates a restrict refusal to canvas.in_use", () => {
    let thrown: unknown;
    try {
      translateWriteError({
        cause: { errcode: 1811, message: "FOREIGN KEY constraint failed" },
      });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("canvas.in_use");
    expect(isAppError(thrown) && thrown.params).toEqual({});
  });

  // KNOWN FAILING, and deliberately left so. A restrict refusal raised by some foreign key that
  // does not reference canvases must not be mislabelled canvas.in_use. SQLite reports EVERY
  // foreign-key refusal as the identical `FOREIGN KEY constraint failed` with no table, column or
  // constraint name (measured on node:sqlite, Node v26.7.0 — see the header of
  // `packages/db/src/constraint-target.ts`), so the error this case builds is byte-for-byte the one
  // the case above builds and no code can separate them. The store's replacement guarantee is CALL
  // SCOPE, stated in `translateWriteError`, which a crafted-error unit test cannot exercise.
  // Do NOT make this pass by weakening the assertion: what it asks for is a mechanism this branch
  // does not yet have, and the open item is recorded in
  // `docs/handoffs/2026-09-21-f1-step25-disposition.md`.
  it("re-throws a restrict refusal from a foreign key that does not reference canvases", () => {
    const original = {
      cause: { errcode: 1811, message: "FOREIGN KEY constraint failed" },
    };
    let thrown: unknown;
    try {
      translateWriteError(original);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(original);
  });

  // A refusal of another class on the SAME key the name branch matches: only the class tells a NOT
  // NULL from a unique index apart, so this is the case that proves the class half of the gate.
  it("re-throws a refusal of another class unchanged", () => {
    const original = {
      cause: { errcode: 1299, message: "NOT NULL constraint failed: canvases.name" },
    };
    let thrown: unknown;
    try {
      translateWriteError(original);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(original);
  });
});
