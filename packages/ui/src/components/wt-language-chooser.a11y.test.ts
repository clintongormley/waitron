import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { WtLanguageChooser } from "./wt-language-chooser.js";
import "./wt-language-chooser.js";

const loadLocales = async () => [
  { code: "es-ES", label: "Español" },
  { code: "en-GB", label: "English" },
];

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-language-chooser a11y (%s theme)", (theme) => {
  test("closed", async () => {
    await mountThemed('<wt-language-chooser active="es-ES"></wt-language-chooser>', theme);
    await expectNoA11yViolations(host);
  });

  test("open, with the active language checked", async () => {
    const el = (await mountThemed(
      '<wt-language-chooser active="es-ES"></wt-language-chooser>',
      theme,
    )) as WtLanguageChooser;
    el.loadLocales = loadLocales;
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!.click();
    await new Promise((resolve) => setTimeout(resolve));
    await el.updateComplete;
    expect(
      el.shadowRoot!.querySelector('[data-test="lang-es-ES"]')!.getAttribute("aria-checked"),
    ).toBe("true");
    await expectNoA11yViolations(host);
  });

  test("closed, with a page's ::part rules showing the short code instead of the name", async () => {
    const el = (await mountThemed(
      '<wt-language-chooser active="es-ES"></wt-language-chooser>',
      theme,
    )) as WtLanguageChooser;
    const style = document.createElement("style");
    style.textContent =
      "wt-language-chooser::part(name) { display: none } wt-language-chooser::part(code) { display: inline }";
    host.append(style);
    const code = el.shadowRoot!.querySelector('[data-test="lang-trigger"] [part="code"]')!;
    expect(code.getBoundingClientRect().width).toBeGreaterThan(0);
    await expectNoA11yViolations(host);
  });
});
