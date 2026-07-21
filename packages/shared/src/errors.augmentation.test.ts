import { describe, expect, it } from "vitest";
import { AppError } from "./errors.js";

/**
 * Proves `ErrorParams` is genuinely open for extension, not merely namespaced. This is the
 * mechanism every consuming package uses to add its own codes without `packages/shared` ever
 * enumerating them on the dependent's behalf — see the design note atop `errors.ts`.
 * `packages/db`'s real augmentation lives in `packages/db/src/errors.ts` and is exercised there
 * by `allocate-number.test.ts` against real Postgres/PGlite; this file plays the same role from
 * a location `errors.ts` itself never imports, so the merge being visible here proves it is a
 * property of the type-checker's whole-program view, not of some import edge from `errors.ts` to
 * its consumer.
 *
 * `"probe.*"` is not a namespace used anywhere else in the repo. It exists only to demonstrate
 * the mechanism in isolation, which is also why this file has no sibling `probe.ts` — unlike
 * `conventions.test.ts`, which is a policy guard with no source of its own, this one is a
 * capability demonstration with no source of its own for the same reason: there is nothing to
 * implement, only a declaration to merge.
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
    // `errors.test.ts`'s "param-shape discrimination" block proves this for a native `shared.*`
    // code; this is the same proof for a code that exists only via declaration merging, from a
    // file `errors.ts` itself never imports. Discrimination must survive augmentation itself —
    // a merged code falling back to some permissive shape the moment it comes from outside
    // errors.ts would be exactly the regression this whole registry design exists to prevent.
    // @ts-expect-error "probe.augmented_from_outside" wants { detail: string }, not this shape
    const error = new AppError("probe.augmented_from_outside", { wrongShape: true });
    expect(error).toBeInstanceOf(AppError);
  });
});
