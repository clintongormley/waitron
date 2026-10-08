import { afterEach, beforeEach, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, documentProduct, menuDocument, mountWidget } from "./test-helpers.js";
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
      { id: "terrace", name: "Terraza" },
    ],
  });
  const note = el.shadowRoot!.querySelector('[data-test="only-this-menu"]');
  expect(text(note)).toBe(
    "Lunch and Terraza include this menu. They keep their live version until each of them is published.",
  );
  expect([...note!.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
    "/manage/menus/menu/lunch/view/preview",
    "/manage/menus/menu/terrace/view/preview",
  ]);
});
it.each([1, 2])(
  "shows %i clashes as a red sentence with their sources and a filter link",
  async (count) => {
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
    const message = el.shadowRoot!.querySelector<HTMLElement>('[data-test="clash-count"]')!;
    expect(message.tagName).toBe("P");
    expect(message.classList.contains("error")).toBe(true);
    expect(text(message)).toBe(
      count === 1
        ? "1 price has a clash. Resolve it before publishing this menu."
        : "2 prices have clashes. Resolve them before publishing this menu.",
    );
    expect([...el.shadowRoot!.querySelectorAll('[data-test="clashes"] li')].map(text)).toEqual(
      Array.from(
        { length: count },
        () => "Lager: price set to €2.80 in this menu's sections, €3.00 in Drinks.",
      ),
    );
    expect(
      el.shadowRoot!.querySelector('[data-test="clash-prices"]')?.getAttribute("href"),
    ).toContain("/view/prices");
  },
);
it("shows no clash error when every price resolves", async () => {
  const { el } = await mountWidget<MenuPreviewPanel>("dashboard-menu-preview", {
    preview: preview(),
  });
  expect(el.shadowRoot!.querySelector('[data-test="clash-count"]')).toBeNull();
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
