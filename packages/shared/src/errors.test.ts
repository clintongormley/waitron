import { describe, expect, it } from "vitest";
import { AppError, hasCode, isAppError } from "./errors.js";

describe("AppError", () => {
  it("carries the code as the code, not as prose", () => {
    const error = new AppError("shared.invalid_id", { kind: "SeriesId", value: "nope" });
    expect(error.code).toBe("shared.invalid_id");
  });

  it("uses the code as the Error message so a stray log prints a key, not prose", () => {
    const error = new AppError("shared.invalid_id", { kind: "SeriesId", value: "nope" });
    expect(error.message).toBe("shared.invalid_id");
  });

  it("carries typed params alongside the code", () => {
    const error = new AppError("shared.decimal_overflow", {
      value: "1000000000000.00",
      maxIntegerDigits: 12,
    });
    expect(error.params).toEqual({ value: "1000000000000.00", maxIntegerDigits: 12 });
  });

  it("is a real Error, so it survives throw/catch and keeps a stack", () => {
    let caught: unknown;
    try {
      throw new AppError("shared.invalid_decimal", { value: "1,50" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).stack).toContain("errors.test.ts");
  });

  it("reports its name as AppError", () => {
    expect(new AppError("shared.invalid_id", { kind: "TillId", value: "x" }).name).toBe("AppError");
  });

  it("does not mutate the params object it was given", () => {
    const params = { kind: "TillId", value: "x" };
    const error = new AppError("shared.invalid_id", params);
    expect(error.params).toEqual(params);
    expect(Object.isFrozen(error.params)).toBe(true);
  });

  it("can be constructed without being thrown", () => {
    const warning = new AppError("shared.decimal_overflow", {
      value: "1000000000000.00",
      maxIntegerDigits: 12,
    });
    expect(warning.code).toBe("shared.decimal_overflow");
  });
});

describe("isAppError", () => {
  it("accepts an AppError", () => {
    expect(isAppError(new AppError("shared.invalid_id", { kind: "TillId", value: "x" }))).toBe(
      true,
    );
  });

  it("rejects a plain Error", () => {
    expect(isAppError(new Error("boom"))).toBe(false);
  });

  it("rejects a plain object that merely looks like one", () => {
    // `instanceof` alone would already reject this, but a duck-typed guard would accept it.
    expect(isAppError({ code: "shared.invalid_id", params: {} })).toBe(false);
  });

  it("rejects null and undefined", () => {
    expect(isAppError(null)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
  });
});

describe("param-shape discrimination", () => {
  // The `@ts-expect-error` directive below is the real assertion: `tsc --noEmit` fails with
  // "Unused '@ts-expect-error' directive" the moment `ErrorParams[C]` ever widens enough to
  // accept an unrelated shape. Vitest does not typecheck, so no runtime assertion catches it.
  it("rejects a wrong-shaped params object for a native shared.* code", () => {
    // @ts-expect-error "shared.invalid_id" wants { kind: string; value: string }, not this shape
    const error = new AppError("shared.invalid_id", { wrongShape: true });
    expect(error).toBeInstanceOf(AppError);
  });
});

describe("narrowing by code", () => {
  it("does not narrow .params from a bare `.code` check — see the class doc comment", () => {
    const error: AppError = new AppError("shared.invalid_id", { kind: "TillId", value: "x" });
    if (error.code === "shared.invalid_id") {
      // @ts-expect-error `.params` is not narrowed by a bare `.code` check; use `hasCode` instead
      expect(error.params.kind).toBe("TillId");
    } else {
      expect.unreachable("the code check above should have matched");
    }
  });

  it("narrows .params together with .code via hasCode", () => {
    const error: AppError = new AppError("shared.invalid_id", { kind: "TillId", value: "x" });
    if (hasCode(error, "shared.invalid_id")) {
      expect(error.params.kind).toBe("TillId");
    } else {
      expect.unreachable("hasCode should have matched");
    }
  });

  it("hasCode rejects a non-matching code", () => {
    const error: AppError = new AppError("shared.invalid_id", { kind: "TillId", value: "x" });
    expect(hasCode(error, "shared.invalid_decimal")).toBe(false);
  });
});
