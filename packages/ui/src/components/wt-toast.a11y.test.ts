import axe from "axe-core";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-toast.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-toast a11y (%s theme)", (theme) => {
  test.each(["info", "error"] as const)("an open %s toast", async (tone) => {
    await mountThemed(
      `<wt-toast open tone="${tone}" message="2 new alerts" close-label="Close" duration="0"></wt-toast>`,
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("a closed toast", async () => {
    await mountThemed('<wt-toast message="x" close-label="Close"></wt-toast>', theme);
    await expectNoA11yViolations(host);
  });

  test("detects a close button with no name", async () => {
    const el = await mountThemed(
      '<wt-toast open message="2 new alerts" close-label="Close" duration="0"></wt-toast>',
      theme,
    );
    el.shadowRoot!.querySelector(".close")!.removeAttribute("aria-label");
    const result = await axe.run(host);
    expect(result.violations.map(({ id }) => id)).toContain("button-name");
  });
});
