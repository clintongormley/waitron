import { describe, expect, it } from "vitest";
import { refusalError } from "@waitron/db";
import { isAppError } from "@waitron/shared";
import { translateWriteError } from "./canvas-store.js";

// The duplicate-name → canvas.name_taken and referenced-delete → canvas.in_use translations, proven
// end to end against a real migrated database in canvas-store.db.test.ts. Here we pin the
// translator's branches directly with crafted errors — no DB — so the re-throw branches are covered
// deterministically. `translateWriteError` is exported from canvas-store.ts for exactly this, not
// from the package barrel. Mirrors identity's `asEmailTaken` unit tests (staff.test.ts).
//
// Each crafted refusal comes from `refusalError`, whose own suite holds it equal to the engine's.
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
        cause: refusalError({ uniqueIndex: "canvases_expr_uq" }),
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
        cause: refusalError({ unique: { table: "canvases", columns: ["name"] } }),
      });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("canvas.name_taken");
  });

  // A unique violation on a DIFFERENT canvases key (the primary key, or any unique added later)
  // must NOT be mislabelled canvas.name_taken — it is re-thrown untouched. Proof-by-deletion: drop
  // the target gate and this fails (the error becomes name_taken). A primary-key collision has its
  // own result code, which `UNIQUE_VIOLATION` also holds, so it reaches the branch.
  it("re-throws a unique violation on canvases whose key is not (name)", () => {
    const original = {
      cause: refusalError({ primaryKey: { table: "canvases", column: "id" } }),
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
        cause: refusalError({ restrict: true }),
      });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("canvas.in_use");
    expect(isAppError(thrown) && thrown.params).toEqual({});
  });

  // Not checked here: that a restrict refusal from some OTHER key re-throws. The engine's message
  // names no key, so every restrict refusal is the same error and no crafted one could tell them
  // apart. The schema holds it instead: `has device_profiles.canvas_id as the ONLY key into
  // canvases, and no key out of it` (canvas-store.db.test.ts) fails if another key could raise one
  // on `canvases` — for the schema as it stands, not for whatever is added later.

  // A refusal of another class on the SAME key the name branch matches: only the class tells a NOT
  // NULL from a unique index apart, so this is the case that proves the class half of the gate.
  it("re-throws a refusal of another class unchanged", () => {
    const original = {
      cause: refusalError({ notNull: { table: "canvases", column: "name" } }),
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
