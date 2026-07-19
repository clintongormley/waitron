import { expect, test } from "vitest";
import { baseStyles } from "./base-styles.js";

test("exports a Lit stylesheet", () => {
  expect(baseStyles.cssText).toContain("box-sizing");
});

test("declares no literal colours", () => {
  expect(baseStyles.cssText).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
});
