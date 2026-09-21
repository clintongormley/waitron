import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { translateWriteError } from "./device-profile-store.js";

// The device-profile write/delete error translations, proven end to end against a real migrated
// database in device-profile-store.db.test.ts. Here we pin the translator's branches directly
// with crafted errors — no DB — so every branch is covered deterministically.
// `translateWriteError` is exported from device-profile-store.ts for exactly this, not from the
// package barrel. Mirrors canvas-store.test.ts.
//
// Each crafted error carries the `errcode` + `message` pair the refusal readers in
// `packages/db/src/constraint-target.ts` look at, copied from what node:sqlite reported for the
// same refusal on Node v26.7.0, 2026-09-21. `code` is deliberately absent: node:sqlite sets it to
// the constant "ERR_SQLITE_ERROR" for every failure alike, so nothing reads it.
describe("translateWriteError", () => {
  it("translates a unique violation that named no key to device_profile.name_taken", () => {
    // The fallback branch: a unique violation whose target cannot be identified still translates,
    // because the name key is the only unique an insert/update can trip on an author-supplied
    // value. The message is the shape SQLite uses when the index is over an EXPRESSION: it names
    // the index and no columns, so `constraintTarget` returns undefined.
    let thrown: unknown;
    try {
      translateWriteError({
        cause: {
          errcode: 2067,
          message: "UNIQUE constraint failed: index 'device_profiles_expr_uq'",
        },
      });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("device_profile.name_taken");
    expect(isAppError(thrown) && thrown.params).toEqual({});
  });

  it("translates a unique violation on device_profiles (name)", () => {
    let thrown: unknown;
    try {
      translateWriteError({
        cause: { errcode: 2067, message: "UNIQUE constraint failed: device_profiles.name" },
      });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("device_profile.name_taken");
  });

  // A unique violation on a DIFFERENT key (the primary key, or any unique added later) must NOT be
  // mislabelled name_taken — it is re-thrown untouched. Proof-by-deletion: drop the target gate.
  // The code is 1555 because SQLite reports a primary-key collision under its own result code.
  it("re-throws a unique violation on device_profiles whose key is not (name)", () => {
    const original = {
      cause: { errcode: 1555, message: "UNIQUE constraint failed: device_profiles.id" },
    };
    let thrown: unknown;
    try {
      translateWriteError(original);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(original);
  });

  // A written value naming no parent row (787) — the `canvas_id` case, and the only foreign key
  // `device_profiles` declares.
  it("translates a foreign-key refusal to device_profile.invalid {bad_canvas_ref}", () => {
    let thrown: unknown;
    try {
      translateWriteError({
        cause: { errcode: 787, message: "FOREIGN KEY constraint failed" },
      });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("device_profile.invalid");
    expect(isAppError(thrown) && thrown.params).toEqual({ reason: "bad_canvas_ref" });
  });

  // A delete refused by an ON DELETE RESTRICT key (1811) — the device that still binds the profile.
  // The two directions carry the same message and differ only in this code, which is what keeps
  // this branch and the one above apart.
  it("translates a restrict refusal to device_profile.in_use", () => {
    let thrown: unknown;
    try {
      translateWriteError({
        cause: { errcode: 1811, message: "FOREIGN KEY constraint failed" },
      });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("device_profile.in_use");
    expect(isAppError(thrown) && thrown.params).toEqual({});
  });

  // KNOWN FAILING, and deliberately left so. A restrict refusal from a foreign key that does not
  // reference a profile must not be mislabelled in_use. SQLite reports EVERY foreign-key refusal as
  // the identical `FOREIGN KEY constraint failed` with no table, column or constraint name
  // (measured on node:sqlite, Node v26.7.0 — see the header of
  // `packages/db/src/constraint-target.ts`), so the error this case builds is byte-for-byte the one
  // the case above builds and no code can separate them. The store's replacement guarantee is CALL
  // SCOPE, stated in `translateWriteError`, which a crafted-error unit test cannot exercise.
  // Do NOT make this pass by weakening the assertion: what it asks for is a mechanism this branch
  // does not yet have, and the open item is recorded in
  // `docs/handoffs/2026-09-21-f1-step25-disposition.md`.
  it("re-throws a restrict refusal from a foreign key that does not reference device_profiles", () => {
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
      cause: { errcode: 1299, message: "NOT NULL constraint failed: device_profiles.name" },
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
