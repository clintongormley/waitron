import { afterEach, expect, it } from "vitest";
import type { WtModal } from "@waitron/ui";
import type { LegalAbout } from "@waitron/shared";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./about-dialog.js";
import type { AboutDialog } from "./about-dialog.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const answers: Record<string, LegalAbout> = {
  release: { release: { version: "1.2.3", releasedOn: "2026-10-22" }, build: "b" },
  "no release": { release: null, build: "abc123" },
};

it.each(
  (["light", "dark"] as const).flatMap((theme) =>
    Object.keys(answers).map((answer) => [theme, answer] as const),
  ),
)("the open About window has no axe violations (%s, %s)", async (theme, answer) => {
  const { el } = await mountWidget<AboutDialog>(
    "dashboard-about-dialog",
    { open: true, about: answers[answer]! },
    theme,
  );
  const modal = el.shadowRoot!.querySelector<WtModal>("wt-modal")!;
  await modal.updateComplete;
  expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  await expectNoA11yViolations(el);
});
