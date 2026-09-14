import axe from "axe-core";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-count-badge.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-count-badge a11y (%s theme)", (theme) => {
  test.each(["neutral", "warning", "error"] as const)("a %s badge", async (tone) => {
    await mountThemed(`<wt-count-badge count="12" tone="${tone}"></wt-count-badge>`, theme);
    await expectNoA11yViolations(host);
  });

  test("detects unreadable badge text", async () => {
    await mountThemed('<wt-count-badge count="12" tone="warning"></wt-count-badge>', theme);
    // Not text equal to the background: axe files an exact 1:1 match as "incomplete", never a
    // violation, so that control could not go red.
    host.style.setProperty("--wt-color-warning", "var(--wt-color-bg)");
    const result = await axe.run(host);
    expect(result.violations.map(({ id }) => id)).toContain("color-contrast");
  });
});
