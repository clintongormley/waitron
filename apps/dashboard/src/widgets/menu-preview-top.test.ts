import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { decimal } from "@waitron/shared";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import {
  cleanupWidgets,
  documentProduct,
  menuDocument,
  mountMenuPreview as mountWidget,
} from "./test-helpers.js";
import { MenuPreviewPanel } from "./menu-preview.js";
import type { MenuPreview } from "../api/client.js";

let locale: string;
beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
});
afterEach(() => {
  setLocale(locale);
  cleanupWidgets();
});
const document = menuDocument([documentProduct("beer", "lager")], { lager: "Lager" });
const preview = (): MenuPreview => ({
  setMenuProblems: [],
  document,
  live: null,
  hash: "b".repeat(64),
  changes: [],
  warnings: [],
  clashes: [],
  status: { state: "unpublished", clashes: 0 },
});
const text = (node: Element | null) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();

it("keeps publication state in the editor header and shows no duplicate Live version section", async () => {
  const { el } = await mountWidget<MenuPreviewPanel>("dashboard-menu-preview", {
    preview: preview(),
  });
  expect(el.shadowRoot!.querySelector('[data-test="live"]')).toBeNull();
  expect(el.shadowRoot!.textContent).not.toContain("Live version");
});
it.each([
  ["en", "Unpublished changes"],
  ["es-ES", "Cambios sin publicar"],
])("uses the editor's unpublished heading in %s", async (language, words) => {
  setLocale(language);
  const { el } = await mountWidget<MenuPreviewPanel>("dashboard-menu-preview", {
    preview: preview(),
  });
  expect(text(el.shadowRoot!.querySelector("#changes-heading"))).toBe(words);
});
it("omits the publication note when no menu includes this menu", async () => {
  const { el } = await mountWidget<MenuPreviewPanel>("dashboard-menu-preview", {
    preview: preview(),
    menuName: "Drinks",
  });
  expect(el.shadowRoot!.querySelector('[data-test="only-this-menu"]')).toBeNull();
});
it("names every includer and links to its Preview", async () => {
  const { el } = await mountWidget<MenuPreviewPanel>("dashboard-menu-preview", {
    preview: preview(),
    menuName: "Drinks",
    includedBy: [
      { id: "lunch", name: "Lunch" },
      { id: "terrace", name: "Terrace" },
    ],
  });
  const note = el.shadowRoot!.querySelector('[data-test="only-this-menu"]');
  expect(text(note)).toBe(
    "Lunch and Terrace include this menu. They keep their live version until each of them is published.",
  );
  expect([...note!.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
    "/menus/menu/lunch/view/preview",
    "/menus/menu/terrace/view/preview",
  ]);
});
it.each(["en", "es-ES"])("shows clashes with their prices and sources in %s", async (locale) => {
  const spanish = locale === "es-ES";
  const count = spanish ? 2 : 1;
  setLocale(locale);
  const p = preview();
  p.clashes = Array.from({ length: count }, () => ({
    productId: "lager",
    variantId: null,
    field: "price",
    candidates: [
      { value: decimal("2.80"), place: { kind: "own_sections" }, source: { kind: "own" } },
      {
        value: decimal("3.00"),
        place: { kind: "menu", menuId: "drinks", menuName: "Drinks" },
        source: { kind: "own" },
      },
    ],
  })) as MenuPreview["clashes"];
  const { el } = await mountWidget<MenuPreviewPanel>("dashboard-menu-preview", { preview: p });
  const card = el.shadowRoot!.querySelector('wt-card[data-test="publish-blockers"]')!;
  expect(text(card.querySelector("h2"))).toBe(
    spanish ? "Corrige antes de publicar (2)" : "Fix before publishing (1)",
  );
  const rows = [...card.querySelectorAll("li")];
  expect(rows).toHaveLength(count);
  for (const row of rows) {
    expect(text(row)).toBe(
      spanish
        ? "Lager 2,80 € en las secciones de esta carta 3,00 € en Drinks Elegir un precio ›"
        : "Lager €2.80 in this menu's sections €3.00 in Drinks Choose a price ›",
    );
    expect(row.querySelector("a")?.getAttribute("href")).toContain("/view/prices/filter/clashes");
  }
});
it("places both kinds of publishing blocker before any folded warning", async () => {
  const p = preview();
  p.clashes = [{ productId: "lager", variantId: null, field: "price", candidates: [] }];
  p.setMenuProblems = [
    {
      menuId: "daily",
      name: "Daily menu",
      problems: [{ kind: "dish_sold_by_measure", productId: "lager", name: "Lager" }],
    },
  ];
  p.warnings = [{ kind: "shortcut_missing", name: "Missing" }];
  const { el } = await mountWidget<MenuPreviewPanel>("dashboard-menu-preview", { preview: p });
  const root = el.shadowRoot!;
  const warning = root.querySelector("wt-disclosure")!;
  expect(warning.open).toBe(false);
  expect(warning.card).toBe(false);
  const headingColor = getComputedStyle(root.querySelector("#document-heading")!).color;
  expect(getComputedStyle(warning.closest("wt-card")!.querySelector("h2")!).color).toBe(
    headingColor,
  );
  expect(getComputedStyle(root.querySelector("#changes-heading")!).color).toBe(headingColor);
  expect(text(root.querySelector("#publish-blockers-heading"))).toBe("Fix before publishing (2)");
  for (const blocker of [
    root.querySelector("#publish-blockers-heading")!,
    root.querySelector('a[href="/set-menus/menu/daily"]')!,
  ]) {
    expect(blocker.compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  }
});

it("shows no clash error when every price resolves", async () => {
  const { el } = await mountWidget<MenuPreviewPanel>("dashboard-menu-preview", {
    preview: preview(),
  });
  expect(el.shadowRoot!.querySelector("#publish-blockers-heading")).toBeNull();
});
it.each([
  ["en", "Lunch includes this menu. It keeps its live version until it is published."],
  ["es-ES", "Lunch incluye esta carta. Mantiene su versión publicada hasta que se publique."],
])("uses singular wording for one includer in %s", async (language, words) => {
  setLocale(language);
  const { el } = await mountWidget<MenuPreviewPanel>("dashboard-menu-preview", {
    preview: preview(),
    includedBy: [{ id: "lunch", name: "Lunch" }],
  });
  expect(text(el.shadowRoot!.querySelector('[data-test="only-this-menu"]'))).toBe(words);
});

it.each(["ctrlKey", "metaKey", "shiftKey", "altKey"])(
  "leaves the Preview Clashes link's %s click to the browser",
  async (modifier) => {
    const p = preview();
    p.clashes = [{ productId: "lager", variantId: null, field: "price", candidates: [] }];
    const { el } = await mountWidget<MenuPreviewPanel>("dashboard-menu-preview", { preview: p });
    const heard = vi.fn();
    el.addEventListener("wt-preview-clashes", heard);
    const link = el.shadowRoot!.querySelector<HTMLAnchorElement>('[data-test="clash-prices"]')!;
    let prevented = true;
    link.addEventListener("click", (event) => {
      prevented = event.defaultPrevented;
      event.preventDefault();
    });
    link.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        composed: true,
        cancelable: true,
        [modifier]: true,
      }),
    );
    expect(prevented).toBe(false);
    expect(heard).not.toHaveBeenCalled();
    expect(link.getAttribute("href")).toBe("/menus/menu/menu-lunch/view/prices/filter/clashes");
  },
);

it("uses conflicto throughout the Spanish Prices vocabulary", () => {
  setLocale("es-ES");
  expect(t("menu_prices.clash")).toBe("Conflicto");
  expect(t("menu_prices.clashes_only")).toBe("Con conflictos");
  expect(t("menu_prices.show_clashes")).toBe("Ver conflictos");
  expect(t("menus.publish_waits_clash")).toBe("No se puede publicar hasta resolver 1 conflicto");
  expect(t("menus.publish_waits_clashes").replace("{count}", "2")).toBe(
    "No se puede publicar hasta resolver 2 conflictos",
  );
});
