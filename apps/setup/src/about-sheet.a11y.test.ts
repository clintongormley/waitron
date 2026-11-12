import { afterEach, expect, it } from "vitest";
import type { WtModal } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./widgets/test-helpers.js";
import { setLocale, t } from "./i18n/t.js";
import "./about-sheet.js";
import type { SetupAboutSheet } from "./about-sheet.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const cases = (["light", "dark"] as const).flatMap((theme) =>
  (["en-GB", "es-ES"] as const).map((locale) => ({ theme, locale })),
);

it.each(cases)(
  "the open sheet has no axe violations: $locale, $theme",
  async ({ theme, locale }) => {
    setLocale(locale);
    const { el, host } = await mountWidget<SetupAboutSheet>(
      "setup-about-sheet",
      { open: true },
      theme,
    );
    const modal = el.shadowRoot!.querySelector<WtModal>("wt-modal")!;
    await modal.updateComplete;
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(el.shadowRoot!.querySelector("h2")!.textContent).toBe(
      locale === "en-GB" ? "About Waitron" : "Acerca de Waitron",
    );
    expect(modal.getAttribute("aria-label")).toBe(t("shell.about.title"));
    await expectNoA11yViolations(host);
  },
);
