import { describe, expect, it } from "vitest";
import { refusalError } from "@waitron/db";
import { isAppError } from "@waitron/shared";
import { translateWriteError } from "./canvas-store.js";

// Each crafted refusal comes from `refusalError`, whose own suite holds it equal to the engine's.
describe("translateWriteError", () => {
  it("translates a unique violation that named no key to canvas.name_taken", () => {
    // The shape SQLite uses for an index over an EXPRESSION: it names the index and no columns, so
    // `constraintTarget` returns undefined.
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

  // A primary-key collision has its own result code, which `UNIQUE_VIOLATION` also holds, so it
  // reaches the unique branch.
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
