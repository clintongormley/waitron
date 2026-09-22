import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { resolveEnvironment } from "./environment.js";

/**
 * The whole mapping, case by case, because this is the derivation that decides which environment a
 * venue directory is stamped for — permanently. CLAUDE.md §5: unset means `preproduction`, and
 * `production` has to be typed out in full.
 *
 * `apps/server/src/config.ts`'s `deploymentEnvironment` is the twin, and the two cannot share an
 * implementation: a package must not import an app. Four of the cases below are also asserted of
 * that one by `apps/server/src/config.test.ts` — absent, empty, `dev`, and an unknown value. The
 * capital and the space-padded spellings are asserted HERE ONLY; nothing in this repository runs
 * both functions over one input, so the twins are kept in step by these two tables and by nothing
 * else.
 */
describe("resolveEnvironment", () => {
  it("defaults to preproduction when WAITRON_ENV is absent", () => {
    expect(resolveEnvironment({})).toBe("preproduction");
  });

  it("treats an EMPTY WAITRON_ENV as unset rather than as a bad value", () => {
    expect(resolveEnvironment({ WAITRON_ENV: "" })).toBe("preproduction");
  });

  it("maps dev to preproduction", () => {
    expect(resolveEnvironment({ WAITRON_ENV: "dev" })).toBe("preproduction");
  });

  it("takes preproduction and production as written", () => {
    expect(resolveEnvironment({ WAITRON_ENV: "preproduction" })).toBe("preproduction");
    expect(resolveEnvironment({ WAITRON_ENV: "production" })).toBe("production");
  });

  it("refuses a value that is not one of the three, echoing what was set", () => {
    let thrown: unknown;
    try {
      resolveEnvironment({ WAITRON_ENV: "prod" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("provisioning.invalid_environment");
    expect((thrown as AppError).params).toEqual({ variable: "WAITRON_ENV", value: "prod" });
  });

  it("refuses production spelled with a capital, and production padded with a space", () => {
    // `production` must be TYPED OUT — an approximation of it is refused, never rounded to the
    // nearer of the two. Both of these are what a hand-edited env file produces.
    expect(() => resolveEnvironment({ WAITRON_ENV: "Production" })).toThrow(AppError);
    expect(() => resolveEnvironment({ WAITRON_ENV: " production" })).toThrow(AppError);
  });
});
