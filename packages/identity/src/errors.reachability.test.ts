import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import * as barrel from "./index.js";

/** The augmentation is only real if it is reachable from the public barrel — a declaration in a
 * file nothing imports type-checks locally and vanishes for every consumer. Mirrors
 * packages/credentials/src/errors.reachability.test.ts. */
describe("the identity error codes reach the public barrel", () => {
  it("constructs an identity AppError (person.not_found) with typed params", () => {
    const error = new AppError("person.not_found", { personId: "p" });
    expect(error.code).toBe("person.not_found");
    expect(error.params).toEqual({ personId: "p" });
  });

  it("re-exports something, so the barrel is genuinely loaded", () => {
    expect(Object.keys(barrel).length).toBeGreaterThan(0);
  });
});
