import { afterEach, beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import type { WtModal } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import "./guide-sheet.js";
import type { TillGuideSheet } from "./guide-sheet.js";

let viewport = { width: 0, height: 0 };
const originalLocale = currentLocale();

beforeEach(() => {
  viewport = { width: window.innerWidth, height: window.innerHeight };
  setLocale("en");
});

afterEach(async () => {
  cleanupWidgets();
  setLocale(originalLocale);
  await page.viewport(viewport.width, viewport.height);
});

it.each(
  (["light", "dark"] as const).flatMap((theme) =>
    [390, 1280].map((width) => [theme, width] as const),
  ),
)("the open guide sheet has no axe violations (%s, %i wide)", async (theme, width) => {
  await page.viewport(width, 844);
  const { el } = await mountWidget<TillGuideSheet>(
    "till-guide-sheet",
    { href: "/help/en/products#nutrition-at-the-till" },
    theme,
  );
  const modal = el.shadowRoot!.querySelector<WtModal>("wt-modal")!;
  await modal.updateComplete;
  expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  await expectNoA11yViolations(el);
});
