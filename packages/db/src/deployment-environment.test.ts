import { describe, expect, it } from "vitest";
import { deploymentEnvironmentFor } from "./index.js";

describe("deploymentEnvironmentFor", () => {
  it.each([
    [undefined, "preproduction"],
    ["", "preproduction"],
    ["dev", "preproduction"],
    ["preproduction", "preproduction"],
    ["production", "production"],
  ] as const)("reads %j as %s", (raw, expected) => {
    expect(deploymentEnvironmentFor(raw)).toBe(expected);
  });

  it.each(["prod", "Production", " production", "production ", "staging", "DEV"])(
    "reads %j as naming no environment, never rounding it to the nearer word",
    (raw) => {
      expect(deploymentEnvironmentFor(raw)).toBeNull();
    },
  );
});
