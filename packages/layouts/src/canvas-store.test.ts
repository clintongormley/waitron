import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { translateWriteError } from "./canvas-store.js";

// The duplicate-name → canvas.name_taken and referenced-delete → canvas.in_use translations, proven end
// to end against the real DB in canvas-store.pg.test.ts. Here we pin the translator's
// branches directly with crafted errors — no DB — so the re-throw branches are covered
// deterministically. `translateWriteError` is exported from canvas-store.ts for exactly this, not from
// the package barrel. Mirrors identity's `asEmailTaken` unit tests (staff.test.ts).
//
// Each crafted error carries the `table` + `detail` pair `constraintTarget` reads, copied from what
// PostgreSQL reported for the same refusal on 2026-09-21 (the real ones are driven in
// canvas-store.pg.test.ts).
describe("translateWriteError", () => {
  it("translates a Drizzle-wrapped unique violation (23505) that named no key to canvas.name_taken", () => {
    // The fallback branch: a 23505 whose target cannot be identified still translates, because the
    // name key is the only unique an insert/update can trip on an author-supplied value (a
    // primary-key clash is a cryptographically-unreachable defaultRandom collision, and an UPDATE
    // never changes `id`).
    let thrown: unknown;
    try {
      translateWriteError({ cause: { code: "23505" } });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("canvas.name_taken");
    expect(isAppError(thrown) && thrown.params).toEqual({});
  });

  it("translates a 23505 on canvases (name)", () => {
    let thrown: unknown;
    try {
      translateWriteError({
        cause: { code: "23505", table: "canvases", detail: "Key (name)=(Twin) already exists." },
      });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("canvas.name_taken");
  });

  // A 23505 on a DIFFERENT canvases key (the primary key, or any unique added later) must NOT be
  // mislabelled canvas.name_taken — it is re-thrown untouched. Proof-by-deletion: drop the target
  // gate and this fails (the error becomes name_taken).
  it("re-throws a 23505 on canvases whose key is not (name)", () => {
    const original = {
      cause: {
        code: "23505",
        table: "canvases",
        detail: "Key (id)=(6a9cebbb-d0d5-4411-8209-71a202afcb47) already exists.",
      },
    };
    let thrown: unknown;
    try {
      translateWriteError(original);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(original);
  });

  // A 23001 restrict_violation reported against device_profiles (id) — a delete of a canvas a
  // profile still references — → canvas.in_use, no params. Proof-by-deletion: drop the 23001 branch
  // and this becomes the re-throw.
  it("translates a 23001 reported against device_profiles (id) to canvas.in_use", () => {
    let thrown: unknown;
    try {
      translateWriteError({
        cause: {
          code: "23001",
          table: "device_profiles",
          detail:
            'Key (id)=(6a9cebbb-d0d5-4411-8209-71a202afcb47) is referenced from table "device_profiles".',
        },
      });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("canvas.in_use");
    expect(isAppError(thrown) && thrown.params).toEqual({});
  });

  // A 23001 from some OTHER foreign key must NOT be mislabelled canvas.in_use — re-thrown. This one
  // is the devices → device_profiles RESTRICT, which reports a different table.
  it("re-throws a 23001 from a foreign key that does not reference canvases", () => {
    const original = {
      cause: {
        code: "23001",
        table: "devices",
        detail:
          'Key (id)=(2053a761-bbc0-4007-a2f4-be0ff9f220a5) is referenced from table "devices".',
      },
    };
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
