import { afterEach, beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { MenuPreview } from "../api/client.js";
import { MenuPreviewPanel } from "./menu-preview.js";
import { cleanupWidgets, documentProduct, menuDocument, mountWidget } from "./test-helpers.js";

let locale: string;
beforeEach(() => {
  locale = currentLocale();
});
afterEach(async () => {
  cleanupWidgets();
  setLocale(locale);
  await page.viewport(1280, 900);
});

const preview: MenuPreview = {
  document: menuDocument([documentProduct("beer", "lager")], { lager: "Lager" }),
  live: null,
  hash: "b".repeat(64),
  changes: [],
  warnings: [],
  clashes: [],
  status: { state: "unpublished", clashes: 0 },
};

it.each([
  [1280, "en", "light"],
  [1280, "en", "dark"],
  [1280, "es-ES", "light"],
  [1280, "es-ES", "dark"],
  [390, "en", "light"],
  [390, "en", "dark"],
  [390, "es-ES", "light"],
  [390, "es-ES", "dark"],
] as const)(
  "puts unpublished changes before the menu at %i px, %s, %s",
  async (width, language, theme) => {
    await page.viewport(width, 900);
    setLocale(language);
    const { el } = await mountWidget<MenuPreviewPanel>(
      "dashboard-menu-preview",
      { preview },
      theme,
    );
    const changes = el.shadowRoot!.querySelector<HTMLElement>('[data-test="changes-pane"]')!;
    const menu = el.shadowRoot!.querySelector<HTMLElement>('[data-test="document-pane"]')!;
    expect(changes.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const a = changes.getBoundingClientRect();
    const b = menu.getBoundingClientRect();
    if (width === 1280) {
      expect(a.right).toBeLessThanOrEqual(b.left);
      expect(a.top).toBe(b.top);
    } else {
      expect(a.bottom).toBeLessThanOrEqual(b.top);
      expect(a.left).toBe(b.left);
    }
    for (const pane of [changes, menu]) {
      expect(pane.getAttribute("role")).toBe("region");
      expect(pane.tabIndex).toBe(0);
      expect(
        el.shadowRoot!.getElementById(pane.getAttribute("aria-labelledby")!)?.textContent?.trim(),
      ).toBeTruthy();
      pane.focus();
      expect(el.shadowRoot!.activeElement).toBe(pane);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  },
);
