import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { SwitchLabel } from "./switch-label.js";
import "./switch-label.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 768);
});

for (const locale of ["en", "es"] as const)
  for (const theme of ["light", "dark"] as const)
    it(`switch label ${locale}/${theme} is accessible at phone width`, async () => {
      setLocale(locale);
      await page.viewport(390, 844);
      const { el, host } = await mountWidget<SwitchLabel>(
        "dashboard-switch-label",
        { address: "https://box-abcd.waitron.local" },
        theme,
      );
      await vi.waitFor(() => expect(el.shadowRoot!.querySelector("img")).not.toBeNull());
      await expectNoA11yViolations(host);
    });
