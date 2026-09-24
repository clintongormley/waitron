import { describe, expect, it } from "vitest";
import { AppError } from "./errors.js";

/**
 * Proves `ErrorParams` is open for extension by declaration merging, from a file `errors.ts`
 * itself never imports. The `probe.augmented_from_outside` code exists only for this file.
 */
declare module "./errors.js" {
  interface ErrorParams {
    "probe.augmented_from_outside": { detail: string };
  }
}

describe("ErrorParams augmentation via declaration merging", () => {
  it("accepts a code declared nowhere in errors.ts itself", () => {
    const error = new AppError("probe.augmented_from_outside", { detail: "x" });
    expect(error.code).toBe("probe.augmented_from_outside");
    expect(error.params).toEqual({ detail: "x" });
  });

  it("still behaves like every other AppError: code as message, frozen params", () => {
    const error = new AppError("probe.augmented_from_outside", { detail: "y" });
    expect(error.message).toBe("probe.augmented_from_outside");
    expect(Object.isFrozen(error.params)).toBe(true);
  });

  it("still discriminates params by shape for a merged code, not just a native one", () => {
    // @ts-expect-error "probe.augmented_from_outside" wants { detail: string }, not this shape
    const error = new AppError("probe.augmented_from_outside", { wrongShape: true });
    expect(error).toBeInstanceOf(AppError);
  });
});
