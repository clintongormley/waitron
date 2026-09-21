import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { translateWriteError } from "./device-profile-store.js";

// The device-profile write/delete error translations, proven end to end against the real DB in
// device-profile-store.pg.test.ts. Here we pin the translator's branches directly with
// crafted errors — no DB — so every branch (incl. the two re-throw paths and BOTH referencing
// constraints) is covered deterministically. `translateWriteError` is exported from
// device-profile-store.ts for exactly this, not from the package barrel. Mirrors canvas-store.test.ts.
//
// Each crafted error carries the `table` + `detail` pair `constraintTarget` reads, copied from what
// PostgreSQL reported for the same refusal on 2026-09-21 (the real ones are driven in
// device-profile-store.pg.test.ts).
describe("translateWriteError", () => {
  it("translates a 23505 that named no key to device_profile.name_taken", () => {
    // The fallback branch: a 23505 whose target cannot be identified still translates, because the
    // name key is the only unique an insert/update can trip on an author-supplied value.
    let thrown: unknown;
    try {
      translateWriteError({ cause: { code: "23505" } });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("device_profile.name_taken");
    expect(isAppError(thrown) && thrown.params).toEqual({});
  });

  it("translates a 23505 on device_profiles (name)", () => {
    let thrown: unknown;
    try {
      translateWriteError({
        cause: {
          code: "23505",
          table: "device_profiles",
          detail: "Key (name)=(Twin) already exists.",
        },
      });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("device_profile.name_taken");
  });

  // A 23505 on a DIFFERENT key (the primary key, or any unique added later) must NOT be
  // mislabelled name_taken — it is re-thrown untouched. Proof-by-deletion: drop the target gate.
  it("re-throws a 23505 on device_profiles whose key is not (name)", () => {
    const original = {
      cause: {
        code: "23505",
        table: "device_profiles",
        detail: "Key (id)=(2053a761-bbc0-4007-a2f4-be0ff9f220a5) already exists.",
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

  it("translates a 23503 on device_profiles (canvas_id) to device_profile.invalid {bad_canvas_ref}", () => {
    let thrown: unknown;
    try {
      translateWriteError({
        cause: {
          code: "23503",
          table: "device_profiles",
          detail:
            'Key (canvas_id)=(00000000-0000-4000-8000-000000000000) is not present in table "canvases".',
        },
      });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("device_profile.invalid");
    expect(isAppError(thrown) && thrown.params).toEqual({ reason: "bad_canvas_ref" });
  });

  // The ON DELETE RESTRICT FK a device holds on a profile → device_profile.in_use. The target is
  // `{devices, [id]}`, which every RESTRICT key out of `devices` reports — a refused till or printer
  // delete included — so what keeps those out of this branch is call scope, not this assertion. See
  // `PROFILE_REFERENCED_BY_DEVICE` in the store.
  it("translates a 23001 reported against devices (id) to device_profile.in_use", () => {
    let thrown: unknown;
    try {
      translateWriteError({
        cause: {
          code: "23001",
          table: "devices",
          detail:
            'Key (id)=(2053a761-bbc0-4007-a2f4-be0ff9f220a5) is referenced from table "devices".',
        },
      });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("device_profile.in_use");
    expect(isAppError(thrown) && thrown.params).toEqual({});
  });

  // A 23001 from a foreign key that does not reference a profile must NOT be mislabelled in_use —
  // re-thrown untouched. This one is the device_profiles → canvases RESTRICT.
  it("re-throws a 23001 from a foreign key that does not reference device_profiles", () => {
    const original = {
      cause: {
        code: "23001",
        table: "device_profiles",
        detail:
          'Key (id)=(6a9cebbb-d0d5-4411-8209-71a202afcb47) is referenced from table "device_profiles".',
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

  it("re-throws a non-translated error unchanged", () => {
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
