import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { WtLanguageFooter } from "./wt-language-footer.js";
import "./wt-language-footer.js";

const loadLocales = async () => [
  { code: "es-ES", label: "Español" },
  { code: "en-GB", label: "English" },
];

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-language-footer a11y (%s theme)", (theme) => {
  test("closed", async () => {
    await mountThemed('<wt-language-footer active="es-ES"></wt-language-footer>', theme);
    await expectNoA11yViolations(host);
  });

  test("open, with the active language checked", async () => {
    const el = (await mountThemed(
      '<wt-language-footer active="es-ES"></wt-language-footer>',
      theme,
    )) as WtLanguageFooter;
    el.loadLocales = loadLocales;
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!.click();
    await new Promise((resolve) => setTimeout(resolve));
    await el.updateComplete;
    expect(
      el.shadowRoot!.querySelector('[data-test="lang-es-ES"]')!.getAttribute("aria-checked"),
    ).toBe("true");
    await expectNoA11yViolations(host);
  });
});
