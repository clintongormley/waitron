import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { setLocale } from "../i18n/t.js";
import type { MenuPreview, MenuStatus } from "../api/client.js";
import {
  cleanupWidgets,
  documentProduct,
  documentSection,
  expectNoA11yViolations,
  menuDocument,
  mountWidget,
} from "./test-helpers.js";
import { MenuPreviewPanel } from "./menu-preview.js";

afterEach(cleanupWidgets);

const live: MenuStatus = {
  state: "changed",
  clashes: 0,
  version: 2,
  publishedAt: "2026-09-26T10:15:00.000Z",
  hash: "a".repeat(64),
};

const changes: MenuPreview = {
  live: null,
  clashes: [],
  hash: "b".repeat(64),
  changes: [
    {
      id: "fixture-src/widgets/menu-preview.a11y.test.ts-2",
      targets: { before: [], after: [] },
      kind: "price_changed",
      productId: "p-burger",
      name: "Burger",
      from: "12.00",
      to: "13.00",
      source: "shared_product",
      alsoOn: ["Dinner Menu"],
    },
    {
      id: "fixture-src/widgets/menu-preview.a11y.test.ts-1",
      targets: { before: [], after: [] },
      kind: "section_changed",
      sectionId: "s-drinks",
      name: "Drinks",
      fields: ["names"],
      source: "included_menu",
    },
  ],
  warnings: [{ kind: "shortcut_missing", name: "Lemonade" }],
  status: live,
  document: menuDocument(
    [
      documentProduct("mi-burger", "p-burger"),
      documentSection("s-drinks", "Drinks", [documentProduct("mi-lemonade", "p-lemonade")]),
    ],
    { "p-burger": "Burger", "p-lemonade": "Lemonade" },
  ),
};

const states: Record<string, Partial<MenuPreviewPanel>> = {
  loading: { status: null, preview: null },
  "live version unread": { status: null, statusFailed: true, preview: changes },
  failed: { preview: null, failed: true },
  "changes and a warning": { preview: changes },
  unpublished: { status: { state: "unpublished", clashes: 0 }, preview: changes },
  "nothing to publish": {
    status: { ...live, state: "current", clashes: 0, hash: changes.hash },
    preview: {
      ...changes,
      changes: [],
      warnings: [],
      status: { ...live, state: "current", clashes: 0, hash: changes.hash },
    },
  },
  "no changes to list": { preview: { ...changes, changes: [], warnings: [] } },
  publishing: { preview: changes, publishing: true },
  published: { preview: changes, result: { kind: "published", number: 3 } },
  stale: { preview: changes, result: { kind: "stale" } },
  "publish failed": { preview: changes, result: { kind: "failed", reason: "Try again." } },
};

describe.each(["light", "dark"] as const)("menu preview (%s)", (theme) => {
  it("renders the warning confirmation accessibly", async () => {
    const { el, host } = await mountWidget<MenuPreviewPanel>(
      "dashboard-menu-preview",
      { menuName: "Evening", status: live, preview: changes },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="publish"]')!.click();
    await el.updateComplete;
    await el.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
    await expectNoA11yViolations(host);
  });
  it.each(Object.keys(states))("renders %s accessibly", async (state) => {
    const { host } = await mountWidget<MenuPreviewPanel>(
      "dashboard-menu-preview",
      { menuName: "Lunch Menu", status: live, ...states[state] },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});

it.each(
  (["en", "es-ES"] as const).flatMap((locale) =>
    (["light", "dark"] as const).flatMap((theme) =>
      [390, 1280].map((width) => ({ locale, theme, width })),
    ),
  ),
)(
  "keeps Preview publication states accessible at $locale $theme $width",
  async ({ locale, theme, width }) => {
    const previousWidth = window.innerWidth;
    const previousHeight = window.innerHeight;
    try {
      await page.viewport(width, 844);
      expect(window.innerWidth).toBe(width);
      setLocale(locale);
      for (const state of [
        "loading",
        "failed",
        "nothing to publish",
        "unpublished",
        "clash",
        "confirmation",
      ]) {
        const clash = {
          ...changes,
          clashes: [
            {
              productId: "p-burger",
              variantId: null,
              field: "price" as const,
              candidates: [
                {
                  place: { kind: "own_sections" as const },
                  value: "12.00" as never,
                  source: { kind: "product" as const },
                },
                {
                  place: { kind: "menu" as const, menuId: "drinks", menuName: "Drinks" },
                  value: "14.00" as never,
                  source: { kind: "own" as const },
                },
              ],
            },
          ],
        };
        const props =
          state === "clash"
            ? { preview: clash }
            : state === "confirmation"
              ? { preview: changes }
              : states[state]!;
        const { el, host } = await mountWidget<MenuPreviewPanel>(
          "dashboard-menu-preview",
          { menuName: "Evening", status: live, ...props },
          theme,
        );
        if (state === "confirmation") {
          el.shadowRoot!.querySelector<HTMLElement>('[data-test="publish"]')!.click();
          await el.updateComplete;
          await el.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
        }
        if (state === "clash")
          expect(
            el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
              '[data-test="publish"]',
            )!.disabled,
          ).toBe(true);
        if (state === "failed" || state === "loading")
          expect(el.shadowRoot!.querySelector('[data-test="publish"]')).toBeNull();
        await expectNoA11yViolations(host);
        cleanupWidgets();
      }
    } finally {
      setLocale("es-ES");
      await page.viewport(previousWidth, previousHeight);
    }
  },
);
