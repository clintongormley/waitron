import { afterEach, beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { MenuPreview } from "../api/client.js";
import { MenuPreviewPanel } from "./menu-preview.js";
import {
  cleanupWidgets,
  documentProduct,
  menuDocument,
  mountMenuPreview as mountWidget,
  selectPreviewPane,
} from "./test-helpers.js";

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
  setMenuProblems: [],
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
  "shows both panes on desktop and one at a time on a phone at %i px, %s, %s",
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
    expect(changes.querySelector("#changes-heading")).not.toBeNull();
    expect(menu.querySelector('[data-test="document"]')).not.toBeNull();
    expect(changes.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const a = changes.getBoundingClientRect();
    const b = menu.getBoundingClientRect();
    if (width === 1280) {
      expect(a.right).toBeLessThanOrEqual(b.left);
      expect(a.top).toBe(b.top);
      expect(el.shadowRoot!.querySelector("wt-segmented-control")!.getClientRects()).toHaveLength(
        0,
      );
    } else {
      const picker = el.shadowRoot!.querySelector("wt-segmented-control")!;
      expect(picker.options.map(({ label }) => label)).toEqual(
        language === "en" ? ["Changes", "Menu"] : ["Cambios", "Carta"],
      );
      expect(menu.getClientRects()).toHaveLength(0);
      await selectPreviewPane(el, "menu");
      expect(changes.getClientRects()).toHaveLength(0);
      expect(menu.getBoundingClientRect().left).toBe(a.left);
    }
    for (const pane of [changes, menu]) {
      expect(pane.getAttribute("role")).toBe("region");
      expect(pane.tabIndex).toBe(-1);
      expect(
        el.shadowRoot!.getElementById(pane.getAttribute("aria-labelledby")!)?.textContent?.trim(),
      ).toBeTruthy();
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  },
);

it("fits a 36 px picture into a compact menu row", async () => {
  await page.viewport(1280, 900);
  const { el } = await mountWidget<MenuPreviewPanel>("dashboard-menu-preview", { preview });
  const tree = el.shadowRoot!.querySelector("dashboard-menu-document-tree")!;
  await tree.updateComplete;
  const table = tree.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  const row = table.shadowRoot!.querySelector('[data-row-key="beer"]')!;
  expect(row.querySelector('[part~="thumb-placeholder"]')!.getBoundingClientRect().width).toBe(36);
  expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(50);
});

it("uses one compact warning line with a marker", async () => {
  const { el } = await mountWidget<MenuPreviewPanel>("dashboard-menu-preview", {
    preview: {
      ...preview,
      warnings: [
        {
          kind: "allergens_unreviewed",
          products: [{ id: "lager", name: "Lager", parentName: null }],
        },
      ],
    },
  });
  const warning = el.shadowRoot!.querySelector("wt-disclosure")!;
  await warning.updateComplete;
  const summary = warning.shadowRoot!.querySelector("button")!;
  expect(warning.getBoundingClientRect().height).toBeLessThanOrEqual(48);
  expect(getComputedStyle(warning.closest("section")!).borderTopStyle).toBe("solid");
  expect(getComputedStyle(summary, "::before").content).not.toBe("none");
  expect(summary.getAttribute("aria-expanded")).toBe("false");
});
