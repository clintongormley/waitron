import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { translateWriteError } from "./device-profile-store.js";

// The device-profile write/delete error translations, proven end to end against the real DB in
// device-profile-store.pg.test.ts. Here we pin the translator's branches directly with
// crafted errors — no DB — so every branch (incl. the two re-throw paths and BOTH referencing
// constraints) is covered deterministically. `translateWriteError` is exported from
// device-profile-store.ts for exactly this, not from the package barrel. Mirrors canvas-store.test.ts.
describe("translateWriteError", () => {
  it("translates a 23505 with no constraint name to device_profile.name_taken", () => {
    // PGlite omits the constraint name, so a bare 23505 falls back to translating (the only NON-PK
    // unique an insert/update can trip is the name key).
    let thrown: unknown;
    try {
      translateWriteError({ cause: { code: "23505" } });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("device_profile.name_taken");
    expect(isAppError(thrown) && thrown.params).toEqual({});
  });

  it("translates a 23505 whose constraint is device_profiles_tenant_name_key", () => {
    let thrown: unknown;
    try {
      translateWriteError({
        cause: { code: "23505", constraint: "device_profiles_tenant_name_key" },
      });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("device_profile.name_taken");
  });

  // A 23505 on a DIFFERENT constraint (the composite (tenant_id, id) key, or any added later) must NOT
  // be mislabelled name_taken — it is re-thrown untouched. Proof-by-deletion: drop the constraint gate.
  it("re-throws a 23505 whose constraint is not the name key", () => {
    const original = { cause: { code: "23505", constraint: "device_profiles_tenant_id_key" } };
    let thrown: unknown;
    try {
      translateWriteError(original);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(original);
  });

  it("translates a 23503 on device_profiles_canvas_fk to device_profile.invalid {bad_canvas_ref}", () => {
    let thrown: unknown;
    try {
      translateWriteError({ cause: { code: "23503", constraint: "device_profiles_canvas_fk" } });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("device_profile.invalid");
    expect(isAppError(thrown) && thrown.params).toEqual({ reason: "bad_canvas_ref" });
  });

  // Both ON DELETE RESTRICT FKs a device/pairing-code holds on a profile → device_profile.in_use.
  it.each(["devices_device_profile_fk", "device_pairing_codes_device_profile_fk"])(
    "translates a 23001 on %s to device_profile.in_use",
    (constraint) => {
      let thrown: unknown;
      try {
        translateWriteError({ cause: { code: "23001", constraint } });
      } catch (e) {
        thrown = e;
      }
      expect(isAppError(thrown) && thrown.code).toBe("device_profile.in_use");
      expect(isAppError(thrown) && thrown.params).toEqual({});
    },
  );

  // A 23001 on an unrelated constraint must NOT be mislabelled in_use — re-thrown untouched.
  it("re-throws a 23001 whose constraint is not a profile-referencing FK", () => {
    const original = { cause: { code: "23001", constraint: "some_other_fk" } };
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
