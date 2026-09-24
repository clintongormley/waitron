import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { resolveEnvironment } from "./environment.js";

/**
 * `apps/server/src/config.ts`'s `deploymentEnvironment` is the twin, and nothing runs both over one
 * input: this table and `apps/server/src/config.test.ts`'s are all that keep them in step.
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
    expect(() => resolveEnvironment({ WAITRON_ENV: "Production" })).toThrow(AppError);
    expect(() => resolveEnvironment({ WAITRON_ENV: " production" })).toThrow(AppError);
  });
});
