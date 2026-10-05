import { describe, expect, it } from "vitest";
import { FORM_FACTOR_REFUSAL, refusalError } from "@waitron/db";
import { isAppError } from "@waitron/shared";
import { translateWriteError } from "./device-profile-store.js";

// Each crafted refusal comes from `refusalError`, whose own suite holds it equal to the engine's.
describe("translateWriteError", () => {
  it("translates a unique violation that named no key to device_profile.name_taken", () => {
    // The shape SQLite uses for an index over an EXPRESSION: it names the index and no columns, so
    // `constraintTarget` returns undefined.
    let thrown: unknown;
    try {
      translateWriteError({
        cause: refusalError({ uniqueIndex: "device_profiles_expr_uq" }),
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
        cause: refusalError({ unique: { table: "device_profiles", columns: ["name"] } }),
      });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("device_profile.name_taken");
  });

  // A primary-key collision has its own result code, which `UNIQUE_VIOLATION` also holds, so it
  // reaches the unique branch.
  it("re-throws a unique violation on device_profiles whose key is not (name)", () => {
    const original = {
      cause: refusalError({ primaryKey: { table: "device_profiles", column: "id" } }),
    };
    let thrown: unknown;
    try {
      translateWriteError(original);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(original);
  });

  it("translates a foreign-key refusal to device_profile.invalid {bad_canvas_ref}", () => {
    let thrown: unknown;
    try {
      translateWriteError({
        cause: refusalError({ foreignKey: true }),
      });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("device_profile.invalid");
    expect(isAppError(thrown) && thrown.params).toEqual({ reason: "bad_canvas_ref" });
  });

  // The two foreign-key directions carry the same message and differ only in their code.
  it("translates a restrict refusal to device_profile.in_use", () => {
    let thrown: unknown;
    try {
      translateWriteError({
        cause: refusalError({ restrict: true }),
      });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("device_profile.in_use");
    expect(isAppError(thrown) && thrown.params).toEqual({});
  });

  it("translates the form-factor lock's refusal to device_profile.in_use", () => {
    let thrown: unknown;
    try {
      translateWriteError({ cause: refusalError({ trigger: FORM_FACTOR_REFUSAL }) });
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("device_profile.in_use");
    expect(isAppError(thrown) && thrown.params).toEqual({});
  });

  // Same result code as the two refusals above; only the words tell them apart.
  it("re-throws any other trigger's refusal unchanged", () => {
    const original = { cause: refusalError({ trigger: "some other guard refused the row" }) };
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
      cause: refusalError({ notNull: { table: "device_profiles", column: "name" } }),
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
