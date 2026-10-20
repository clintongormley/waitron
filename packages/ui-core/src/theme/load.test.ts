import { expect, test } from "vitest";

// Each case imports inside the test, so a table that throws while its module loads fails a case
// here instead of failing the file's import, which a mutation run does not count as a failed test.

test("the contrast rules build when their module loads", async () => {
  const { THEME_RULES, CONTRAST_GROUPS } = await import("./contrast-rules.js");
  expect(THEME_RULES.light).toHaveLength(100);
  expect(THEME_RULES.dark).toHaveLength(105);
  expect(CONTRAST_GROUPS).toHaveLength(22);
});

test("Waitron's values are read from the token text when their module loads", async () => {
  const { WAITRON_DEFAULTS } = await import("./waitron.js");
  expect(WAITRON_DEFAULTS.light["--wt-color-primary"]).toBe("#1f6feb");
  expect(WAITRON_DEFAULTS.dark["--wt-color-bg"]).toBe("#101216");
  expect(WAITRON_DEFAULTS.structure["--wt-radius-md"]).toBe("8px");
});
