import { afterEach, expect, it } from "vitest";
import type { WtModal } from "@waitron/ui";
import type { LegalAbout } from "@waitron/shared";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./about-dialog.js";
import type { AboutDialog } from "./about-dialog.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const answers: Record<string, LegalAbout | null> = {
  release: { release: { version: "1.2.3", releasedOn: "2026-10-22" }, build: "b" },
  "no release": { release: null, build: "abc123" },
  "read failed": null,
};

const cases = (["light", "dark"] as const).flatMap((theme) =>
  ["en-GB", "es"].flatMap((locale) =>
    Object.keys(answers).map((answer) => ({ theme, locale, answer })),
  ),
);

it.each(cases)(
  "the open About window has no axe violations: $answer, $locale, $theme",
  async ({ theme, locale, answer }) => {
    setLocale(locale);
    const { el } = await mountWidget<AboutDialog>(
      "dashboard-about-dialog",
      { open: true, about: answers[answer] ?? null },
      theme,
    );
    const modal = el.shadowRoot!.querySelector<WtModal>("wt-modal")!;
    await modal.updateComplete;
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    await expectNoA11yViolations(el);
  },
);
