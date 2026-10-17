import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { WtThemeChooser } from "./wt-theme-chooser.js";
import "./wt-theme-chooser.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-theme-chooser a11y (%s theme)", (theme) => {
  test.each(["light", "dark", "device"] as const)("closed, showing %s", async (choice) => {
    await mountThemed(`<wt-theme-chooser active="${choice}"></wt-theme-chooser>`, theme);
    await expectNoA11yViolations(host);
  });

  test("open, with the active choice checked", async () => {
    const el = (await mountThemed(
      '<wt-theme-chooser active="dark"></wt-theme-chooser>',
      theme,
    )) as WtThemeChooser;
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="theme-trigger"]')!.click();
    await el.updateComplete;
    expect(
      el.shadowRoot!.querySelector('[data-test="theme-dark"]')!.getAttribute("aria-checked"),
    ).toBe("true");
    await expectNoA11yViolations(host);
  });
});
