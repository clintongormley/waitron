import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { asNameTaken } from "./canvas-store.js";

// The duplicate-name → canvas.name_taken translation, proven end to end against the DB unique index
// in canvas-store.rls.test.ts (real Postgres). Here we pin the translator's branches directly with
// crafted errors — no DB — so the re-throw branch is covered deterministically. `asNameTaken` is
// exported from canvas-store.ts for exactly this, not from the package barrel. Mirrors identity's
// `asEmailTaken` unit tests (staff.test.ts).
describe("asNameTaken", () => {
  it("translates a Drizzle-wrapped unique violation (23505) with no constraint name to canvas.name_taken", () => {
    // PGlite omits the constraint name, so a bare 23505 falls back to translating (the only NON-PK
    // unique an insert/update can trip is the name key; a (tenant_id, id) clash is a
    // cryptographically-unreachable defaultRandom collision).
    let thrown: unknown;
    try {
      asNameTaken({ cause: { code: "23505" } });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("canvas.name_taken");
    expect(isAppError(thrown) && thrown.params).toEqual({});
  });

  it("translates a 23505 whose constraint is canvases_tenant_name_key", () => {
    let thrown: unknown;
    try {
      asNameTaken({ cause: { code: "23505", constraint: "canvases_tenant_name_key" } });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("canvas.name_taken");
  });

  // A 23505 on a DIFFERENT canvases constraint (the composite (tenant_id, id) key, or any
  // added later) must NOT be mislabelled canvas.name_taken — it is re-thrown untouched. Proof-by-
  // deletion: drop the constraint gate in asNameTaken and this fails (the error becomes name_taken).
  it("re-throws a 23505 whose constraint is not the name key", () => {
    const original = { cause: { code: "23505", constraint: "canvases_tenant_id_key" } };
    let thrown: unknown;
    try {
      asNameTaken(original);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(original);
  });

  it("re-throws a non-unique error unchanged", () => {
    const original = { code: "42501" };
    let thrown: unknown;
    try {
      asNameTaken(original);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(original);
  });
});
