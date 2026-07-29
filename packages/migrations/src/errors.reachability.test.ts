import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import * as barrel from "./index.js";

/** The augmentation is only real if it is reachable from the public barrel — a declaration in a
 * file nothing imports type-checks locally and vanishes for every consumer. Mirrors
 * packages/credentials/src/errors.reachability.test.ts. */
describe("the migrations error codes reach the public barrel", () => {
  it("constructs a server.migrations_missing AppError with typed params", () => {
    const error = new AppError("server.migrations_missing", { name: "core", folder: "/x" });
    expect(error.code).toBe("server.migrations_missing");
    expect(error.params).toEqual({ name: "core", folder: "/x" });
  });

  it("re-exports something, so the barrel is genuinely loaded", () => {
    expect(Object.keys(barrel).length).toBeGreaterThan(0);
  });
});
