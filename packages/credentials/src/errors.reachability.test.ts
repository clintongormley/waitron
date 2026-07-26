import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import * as barrel from "./index.js";

/** The augmentation is only real if it is reachable from the public barrel — a declaration in a
 * file nothing imports type-checks locally and vanishes for every consumer. Mirrors
 * packages/payments/src/errors.reachability.test.ts. */
describe("the credentials error codes reach the public barrel", () => {
  it("constructs a credentials.* AppError with typed params", () => {
    const error = new AppError("credentials.missing", { tenantId: "t", purpose: "p" });
    expect(error.code).toBe("credentials.missing");
    expect(error.params).toEqual({ tenantId: "t", purpose: "p" });
  });

  it("re-exports something, so the barrel is genuinely loaded", () => {
    expect(Object.keys(barrel).length).toBeGreaterThan(0);
  });
});
