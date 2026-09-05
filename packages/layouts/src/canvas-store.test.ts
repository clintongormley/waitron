import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { translateWriteError } from "./canvas-store.js";

// The duplicate-name → canvas.name_taken and referenced-delete → canvas.in_use translations, proven end
// to end against the real DB in canvas-store.rls.test.ts (real Postgres). Here we pin the translator's
// branches directly with crafted errors — no DB — so the re-throw branches are covered
// deterministically. `translateWriteError` is exported from canvas-store.ts for exactly this, not from
// the package barrel. Mirrors identity's `asEmailTaken` unit tests (staff.test.ts).
describe("translateWriteError", () => {
  it("translates a Drizzle-wrapped unique violation (23505) with no constraint name to canvas.name_taken", () => {
    // PGlite omits the constraint name, so a bare 23505 falls back to translating (the only NON-PK
    // unique an insert/update can trip is the name key; a (tenant_id, id) clash is a
    // cryptographically-unreachable defaultRandom collision).
    let thrown: unknown;
    try {
      translateWriteError({ cause: { code: "23505" } });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("canvas.name_taken");
    expect(isAppError(thrown) && thrown.params).toEqual({});
  });

  it("translates a 23505 whose constraint is canvases_tenant_name_key", () => {
    let thrown: unknown;
    try {
      translateWriteError({ cause: { code: "23505", constraint: "canvases_tenant_name_key" } });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("canvas.name_taken");
  });

  // A 23505 on a DIFFERENT canvases constraint (the composite (tenant_id, id) key, or any
  // added later) must NOT be mislabelled canvas.name_taken — it is re-thrown untouched. Proof-by-
  // deletion: drop the constraint gate and this fails (the error becomes name_taken).
  it("re-throws a 23505 whose constraint is not the name key", () => {
    const original = { cause: { code: "23505", constraint: "canvases_tenant_id_key" } };
    let thrown: unknown;
    try {
      translateWriteError(original);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(original);
  });

  // A 23001 restrict_violation on device_profiles_canvas_fk (a delete of a profile-referenced canvas)
  // → canvas.in_use, no params. Proof-by-deletion: drop the 23001 branch and this becomes the re-throw.
  it("translates a 23001 on device_profiles_canvas_fk to canvas.in_use", () => {
    let thrown: unknown;
    try {
      translateWriteError({ cause: { code: "23001", constraint: "device_profiles_canvas_fk" } });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("canvas.in_use");
    expect(isAppError(thrown) && thrown.params).toEqual({});
  });

  // A 23001 on a DIFFERENT (unrelated) constraint must NOT be mislabelled canvas.in_use — re-thrown.
  it("re-throws a 23001 whose constraint is not the canvas FK", () => {
    const original = { cause: { code: "23001", constraint: "some_other_fk" } };
    let thrown: unknown;
    try {
      translateWriteError(original);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(original);
  });

  it("re-throws a non-unique error unchanged", () => {
    const original = { code: "42501" };
    let thrown: unknown;
    try {
      translateWriteError(original);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(original);
  });
});
