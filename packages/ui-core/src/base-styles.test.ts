import { expect, test } from "vitest";
import { baseStyles, disabledStyles } from "./base-styles.js";
test("exports a Lit stylesheet", () => {
  expect(baseStyles.cssText).toContain("box-sizing");
});

// Every shared stylesheet this module exports must read colour from `--wt-*` tokens, never a literal
// hex — a hardcoded chrome colour would not follow the user's theme. Parameterised so a new shared
// stylesheet added here is covered by naming it in the table.
test.each([
  ["baseStyles", baseStyles],
  ["disabledStyles", disabledStyles],
])("%s declares no literal colours", (_name, styles) => {
  expect(styles.cssText).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
});
