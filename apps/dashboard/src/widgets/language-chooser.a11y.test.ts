import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./language-chooser.js";
import type { LanguageChooser } from "./language-chooser.js";

/**
 * The chooser fetches its option list on first open through the injected `loadLocales`; a fixture
 * stub stands in for `DashboardApi.getLocales`. axe is run against the themed host in BOTH themes so
 * the color-contrast check means what it means in the app. Two surfaces are covered: COLLAPSED (only
 * the `aria-haspopup`/`aria-expanded` trigger) and OPEN (the `role="menu"` of native
 * `role="menuitemradio"` options), the two states a screen-reader user meets.
 */
const loadLocales = async () => [
  { code: "es-ES", label: "Español" },
  { code: "en-GB", label: "English" },
];

/** Let the async fetch-on-open toggle settle (macrotask), then its repaint — mirrors the spec test. */
async function settle(el: LanguageChooser): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("dashboard-language-chooser a11y (%s theme)", (theme) => {
  it("has no violations while collapsed", async () => {
    const { host } = await mountWidget<LanguageChooser>(
      "dashboard-language-chooser",
      { loadLocales },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations while open (menu of language options)", async () => {
    const { el, host } = await mountWidget<LanguageChooser>(
      "dashboard-language-chooser",
      { loadLocales },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!.click();
    await settle(el);
    await expectNoA11yViolations(host);
  });
});
