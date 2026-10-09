import { afterEach, beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import type { MenuTarget } from "@waitron/catalogue/src/menu-document-types.js";
import type { MenuDocument } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import "./menu-document-tree.js";
import type { MenuDocumentTree } from "./menu-document-tree.js";
import { MenuStructureTable } from "./menu-structure-table.js";
import {
  cleanupWidgets,
  documentProduct,
  documentSection,
  menuDocument,
  mountWidget,
} from "./test-helpers.js";

registerIcons(DASHBOARD_ICONS);
let locale: string;
beforeEach(async () => {
  locale = currentLocale();
  setLocale("en");
  await page.viewport(1280, 900);
});
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

type Tree = MenuDocumentTree;
function fixture(): MenuDocument {
  const doc = menuDocument(
    [
      documentSection("drinks", "Counter drinks", [
        documentSection("beer", "Counter beer", [documentProduct("mi", "lager")]),
      ]),
      documentProduct("juice", "juice"),
    ],
    { lager: "Counter lager", juice: "Counter juice" },
    "Frozen lunch",
  );
  doc.offers.mi!.customerName = { es: "Cerveza fría", en: "Cold beer" };
  doc.offers.mi!.image = "lager.webp";
  doc.offers.juice!.color = "#aabbcc";
  doc.offers.juice!.customerName = null;
  return doc;
}
async function mount(document = fixture(), theme?: "light" | "dark") {
  const { el } = await mountWidget<Tree>(
    "dashboard-menu-document-tree",
    {
      document,
      view: { kind: "internal" },
    },
    theme,
  );
  expect(el.shadowRoot?.querySelector("wt-data-table")).toBeInstanceOf(HTMLElement);
  await settle(el);
  return el;
}
function table(el: Tree) {
  return el.shadowRoot!.querySelector("wt-data-table")!;
}
async function settle(el: Tree) {
  await el.updateComplete;
  await table(el).updateComplete;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await table(el).updateComplete;
}
function row(el: Tree, key: string) {
  return table(el).shadowRoot!.querySelector<HTMLElement>(`tr[data-row-key="${CSS.escape(key)}"]`);
}
function shown(el: Tree) {
  return [...table(el).shadowRoot!.querySelectorAll<HTMLElement>("tbody tr[data-row-key]")].map(
    (node) => node.dataset.rowKey,
  );
}
async function toggle(el: Tree, key: string) {
  row(el, key)!.querySelector<HTMLButtonElement>(".row-activate")!.click();
  await settle(el);
}

it("shows only frozen members in document order, with collapsible nested sections and no editing controls", async () => {
  const el = await mount();
  expect(shown(el)).toEqual(["root", "drinks", "juice"]);
  expect(row(el, "root")!.textContent).toContain("Frozen lunch");
  await toggle(el, "drinks");
  expect(shown(el)).toEqual(["root", "drinks", "drinks/beer", "juice"]);
  await toggle(el, "drinks/beer");
  expect(shown(el)).toEqual(["root", "drinks", "drinks/beer", "drinks/beer/mi", "juice"]);
  expect(row(el, "drinks/beer/mi")!.textContent).toContain("Counter lager");
  expect(
    table(el).shadowRoot!.querySelector("wt-row-actions, a, [part~='drag-grip'], input"),
  ).toBeNull();
  expect(row(el, "drinks/beer/mi")!.querySelector(".row-activate")).toBeNull();
});

it("switches the frozen names with requested, default and staff fallbacks visibly identified", async () => {
  const el = await mount();
  await toggle(el, "drinks");
  await toggle(el, "drinks/beer");
  el.view = { kind: "customer", language: "en" };
  await settle(el);
  expect(row(el, "drinks/beer/mi")!.textContent).toContain("Cold beer");
  expect(row(el, "drinks")!.textContent).toContain("Counter drinks para clientes");
  expect(row(el, "drinks")!.textContent).toContain("Missing translation: en");
  expect(row(el, "juice")!.textContent).toContain("Counter juice");
  expect(row(el, "juice")!.textContent).toContain("Staff name fallback");
  el.view = { kind: "customer", language: "es" };
  await settle(el);
  expect(row(el, "drinks/beer/mi")!.textContent).toContain("Cerveza fría");
  expect(row(el, "drinks")!.textContent).not.toContain("Missing translation");
});

it("keeps the per-mount snapshot when its caller mutates it and resets expansion for a replacement document", async () => {
  const document = fixture();
  const el = await mount(document);
  await toggle(el, "drinks");
  await toggle(el, "drinks/beer");
  document.offers.mi!.name = "Later catalogue name";
  document.root.members.pop();
  el.view = { kind: "customer", language: "en" };
  await settle(el);
  el.view = { kind: "internal" };
  await settle(el);
  expect(row(el, "drinks/beer/mi")!.textContent).toContain("Counter lager");
  expect(row(el, "juice")).not.toBeNull();
  const replacement = fixture();
  replacement.menuName = "Replacement lunch";
  replacement.offers.mi!.name = "Replacement lager";
  el.document = replacement;
  await settle(el);
  expect(shown(el)).toEqual(["root", "drinks", "juice"]);
  expect(row(el, "root")!.textContent).toContain("Replacement lunch");
  await toggle(el, "drinks");
  await toggle(el, "drinks/beer");
  expect(row(el, "drinks/beer/mi")!.textContent).toContain("Replacement lager");
});

it("resets the tree for a replacement preview even when it reuses the same document object", async () => {
  const el = await mount();
  await toggle(el, "drinks");
  expect(shown(el)).toContain("drinks/beer");
  el.inspectionKey = "replacement-preview";
  await settle(el);
  expect(shown(el)).toEqual(["root", "drinks", "juice"]);
});

it("updates interface words with the locale while preserving the chosen content language and expansion", async () => {
  const el = await mount();
  el.view = { kind: "customer", language: "en" };
  await settle(el);
  await toggle(el, "drinks");
  await toggle(el, "drinks/beer");
  setLocale("es-ES");
  await el.updateComplete;
  await settle(el);
  expect(row(el, "drinks/beer/mi")!.textContent).toContain("Cold beer");
  expect(row(el, "drinks/beer/mi")!.textContent).toContain("Producto");
  expect(row(el, "drinks")!.textContent).toContain("Falta traducción: en");
});

it("names section toggles with the content language drawn in their row", async () => {
  const el = await mount();
  el.view = { kind: "customer", language: "es" };
  await settle(el);
  expect(row(el, "drinks")!.querySelector(".row-activate")!.getAttribute("aria-label")).toBe(
    "Show what is in Counter drinks para clientes",
  );
});

it("shows Structure's empty-menu explanation and clears the old snapshot when no document is supplied", async () => {
  const empty = menuDocument([], {}, "Empty frozen menu");
  const el = await mount(empty);
  expect(row(el, "root")!.textContent).toContain("Nothing is on this menu yet.");
  el.document = null;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-data-table")).toBeNull();
});

it("uses the Structure row's indentation, row height and swatch slot for photos and colour fallbacks", async () => {
  const el = await mount();
  await toggle(el, "drinks");
  await toggle(el, "drinks/beer");
  const { el: structure } = await mountWidget<MenuStructureTable>(
    "dashboard-menu-structure-table",
    {
      menuName: "Frozen lunch",
      // Structure has no menu row, so one more section puts its rows at the Preview rows' depth.
      nodes: [
        {
          memberId: "outer",
          ref: { kind: "section", sectionId: "outer" },
          internalName: "Counter outer",
          children: [
            {
              memberId: "drinks",
              ref: { kind: "section", sectionId: "drinks" },
              internalName: "Counter drinks",
              children: [
                {
                  memberId: "beer",
                  ref: { kind: "section", sectionId: "beer" },
                  internalName: "Counter beer",
                  children: [{ memberId: "mi", ref: { kind: "product", productId: "lager" } }],
                },
              ],
            },
            { memberId: "juice", ref: { kind: "product", productId: "juice" } },
          ],
        },
      ],
      products: [
        {
          id: "lager",
          name: "Counter lager",
          image: "lager.webp",
          color: null,
          available: true,
        } as MenuStructureTable["products"][number],
        {
          id: "juice",
          name: "Counter juice",
          image: null,
          color: "#aabbcc",
          available: true,
        } as MenuStructureTable["products"][number],
      ],
    },
  );
  const otherTable = structure.shadowRoot!.querySelector("wt-data-table")!;
  await otherTable.updateComplete;
  for (const key of ["outer", "outer/drinks", "outer/drinks/beer"]) {
    otherTable.setExpanded(key, true);
    await otherTable.updateComplete;
  }
  const a = row(el, "drinks/beer/mi")!;
  const b = otherTable.shadowRoot!.querySelector<HTMLElement>(
    'tr[data-row-key="outer/drinks/beer/mi"]',
  )!;
  expect(getComputedStyle(a.querySelector(".tree-cell")!).paddingInlineStart).toBe(
    getComputedStyle(b.querySelector(".tree-cell")!).paddingInlineStart,
  );
  expect(a.getBoundingClientRect().height).toBe(b.getBoundingClientRect().height);
  const photo = a.querySelector<HTMLElement>("[part~='product-media']")!;
  const otherPhoto = b.querySelector<HTMLElement>("[part~='product-media']")!;
  expect(photo.getBoundingClientRect().width).toBe(otherPhoto.getBoundingClientRect().width);
  expect(photo.getBoundingClientRect().height).toBe(otherPhoto.getBoundingClientRect().height);
  expect(photo.querySelector("img")!.getAttribute("src")).toBe("/media/lager.webp");
  const colour = row(el, "juice")!.querySelector<HTMLElement>("[part~='media-frame']")!;
  expect(getComputedStyle(colour).backgroundColor).toBe("rgb(170, 187, 204)");
  expect(colour.getBoundingClientRect().width).toBe(photo.getBoundingClientRect().width);
  expect(colour.getBoundingClientRect().height).toBe(photo.getBoundingClientRect().height);
  expect(table(el).columns.map((column) => column.label)).toEqual([
    t("members.name"),
    t("members.kind"),
    t("editor.available"),
  ]);
  expect(row(el, "juice")!.querySelector('[data-test="available"]')!.textContent).toBe("—");
});

it("puts a section's photo at the same size and position as Structure's section swatch", async () => {
  const document = fixture();
  const section = document.root.members[0]!;
  if (section.kind !== "section") throw new Error("Fixture needs its section");
  section.image = "drinks.webp";
  const el = await mount(document);
  const { el: structure } = await mountWidget<MenuStructureTable>(
    "dashboard-menu-structure-table",
    {
      menuName: "Frozen lunch",
      nodes: [
        {
          memberId: "drinks",
          ref: { kind: "section", sectionId: "drinks" },
          internalName: "Counter drinks",
          names: {},
          image: null,
          color: "#aabbcc",
          ownerMenuId: "menu-lunch",
          children: [],
        },
      ],
    },
  );
  const other = structure.shadowRoot!.querySelector("wt-data-table")!;
  await other.updateComplete;
  const a = row(el, "drinks")!;
  const b = other.shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="drinks"]')!;
  const photo = a.querySelector<HTMLElement>('[part~="media-frame"]')!;
  const swatch = b.querySelector<HTMLElement>('[part~="color-swatch"]')!;
  const frame = a.querySelector<HTMLElement>('[part~="folder-frame"]')!;
  const otherFrame = b.querySelector<HTMLElement>('[part~="folder-frame"]')!;
  expect(photo.getBoundingClientRect().width).toBe(swatch.getBoundingClientRect().width);
  expect(photo.getBoundingClientRect().height).toBe(swatch.getBoundingClientRect().height);
  expect(photo.getBoundingClientRect().left - frame.getBoundingClientRect().left).toBe(
    swatch.getBoundingClientRect().left - otherFrame.getBoundingClientRect().left,
  );
  expect(photo.querySelector("img")!.getAttribute("src")).toBe("/media/drinks.webp");
});

it.each([390, 1280])(
  "wraps long frozen names without sideways scrolling at %i px",
  async (width) => {
    await page.viewport(width, 900);
    const document = fixture();
    document.offers.juice!.name =
      "Zumo de naranja recién exprimido para compartir con toda la mesa";
    const el = await mount(document);
    const scroll = table(el).shadowRoot!.querySelector<HTMLElement>(".scroll")!;
    if (width === 390) await expect.poll(() => table(el).hasAttribute("narrow")).toBe(true);
    expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);
    expect(documentElementWidth()).toBeLessThanOrEqual(width);
  },
);
function documentElementWidth() {
  return document.documentElement.scrollWidth;
}

it.each(
  [390, 1280].flatMap((width) =>
    ["en", "es-ES"].flatMap((locale) =>
      ["light", "dark"].map((theme) => ({ width, locale, theme: theme as "light" | "dark" })),
    ),
  ),
)(
  "fits expanded translated rows at $width px in $locale, $theme",
  async ({ width, locale, theme }) => {
    await page.viewport(width, 900);
    setLocale(locale);
    const document = fixture();
    document.offers.mi!.customerName = {
      en: "Cold beer to share with the whole table",
      es: "Cerveza bien fría para compartir con toda la mesa",
    };
    const el = await mount(document, theme);
    el.view = { kind: "customer", language: locale === "en" ? "en" : "es" };
    await settle(el);
    await toggle(el, "drinks");
    await toggle(el, "drinks/beer");
    if (width === 390) await expect.poll(() => table(el).hasAttribute("narrow")).toBe(true);
    const scroll = table(el).shadowRoot!.querySelector<HTMLElement>(".scroll")!;
    expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);
    expect(documentElementWidth()).toBeLessThanOrEqual(width);
    for (const key of ["root", "drinks", "drinks/beer", "drinks/beer/mi", "juice"]) {
      const tr = row(el, key)!;
      const name = tr
        .querySelector('[data-test="name"], [data-test="root-name"]')!
        .getBoundingClientRect();
      expect(name.right).toBeLessThanOrEqual(tr.getBoundingClientRect().right);
    }
    expect(
      await el.reveal({
        kind: "product",
        sectionIds: ["drinks", "beer"],
        menuItemId: "mi",
        productId: "lager",
        field: { kind: "summary" },
      }),
    ).toBe(true);
    expect(row(el, "drinks/beer/mi")!.querySelector('[aria-current="true"]')).not.toBeNull();
    await page.screenshot({
      element: el,
      path: `.superpowers/a350-reveal/${locale}-${theme}-${width}.png`,
    });
  },
);

const lagerTarget: MenuTarget = {
  kind: "product",
  sectionIds: ["drinks", "beer"],
  menuItemId: "mi",
  productId: "lager",
  field: { kind: "description", language: "en" },
};

it("reveals the exact nested occurrence, scrolls it clear of the header and keeps focus on the invoking link", async () => {
  const document = fixture();
  document.root.members.unshift(
    ...Array.from({ length: 30 }, (_, i) => documentSection(`other-${i}`, `Other ${i}`, [])),
  );
  const el = await mount(document);
  const scroll = table(el).shadowRoot!.querySelector<HTMLElement>(".scroll")!;
  scroll.style.maxHeight = "240px";
  const link = window.document.createElement("a");
  link.href = "#view";
  link.textContent = "View";
  window.document.body.append(link);
  try {
    link.focus();
    expect(row(el, "drinks/beer/mi")).toBeNull();
    expect(await el.reveal(lagerTarget)).toBe(true);
    await settle(el);
    const target = row(el, "drinks/beer/mi")!;
    expect(target.textContent).toContain("Counter lager");
    expect(target.querySelector('[aria-current="true"]')).not.toBeNull();
    expect(scroll.scrollTop).toBeGreaterThan(0);
    const headings = table(el).shadowRoot!.querySelector("thead")!.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    expect(rect.top).toBeGreaterThanOrEqual(headings.bottom - 1);
    expect(rect.bottom).toBeLessThanOrEqual(scroll.getBoundingClientRect().bottom + 1);
    expect(window.document.activeElement).toBe(link);
  } finally {
    link.remove();
  }
});

it("moves the mark between product, section, list and menu targets and clears it on a click elsewhere", async () => {
  const el = await mount();
  expect(await el.reveal(lagerTarget)).toBe(true);
  expect(row(el, "drinks/beer/mi")!.querySelector('[aria-current="true"]')).not.toBeNull();
  expect(
    await el.reveal({ kind: "section", sectionIds: ["drinks"], field: { kind: "image" } }),
  ).toBe(true);
  await settle(el);
  expect(row(el, "drinks")!.querySelector('[aria-current="true"]')).not.toBeNull();
  expect(row(el, "drinks/beer/mi")!.querySelector("[aria-current]")).toBeNull();
  expect(await el.reveal({ kind: "list", sectionIds: ["drinks", "beer"] })).toBe(true);
  expect(row(el, "drinks/beer")!.querySelector('[aria-current="true"]')).not.toBeNull();
  expect(await el.reveal({ kind: "title", menuId: el.document!.menuId })).toBe(true);
  expect(row(el, "root")!.querySelector('[aria-current="true"]')).not.toBeNull();
  row(el, "root")!.querySelector<HTMLElement>('[aria-current="true"]')!.click();
  await settle(el);
  expect(row(el, "root")!.querySelector('[aria-current="true"]')).not.toBeNull();
  window.document.body.click();
  await settle(el);
  expect(table(el).shadowRoot!.querySelector("[aria-current]")).toBeNull();
});

it("refuses stale paths, another product in the same slot and targets outside this frozen menu", async () => {
  const el = await mount();
  for (const target of [
    { ...lagerTarget, productId: "different" },
    { ...lagerTarget, sectionIds: ["beer", "drinks"] },
    { kind: "section", sectionIds: ["missing"], field: { kind: "summary" } },
    { kind: "section", sectionIds: [], field: { kind: "summary" } },
    { kind: "title", menuId: "other-menu" },
    { kind: "home", device: "till", field: "columns" },
  ] as MenuTarget[])
    expect(await el.reveal(target)).toBe(false);
  expect(shown(el)).toEqual(["root", "drinks", "juice"]);
  expect(table(el).shadowRoot!.querySelector("[aria-current]")).toBeNull();
});

it("keeps a revealed mark through content-language changes and drops it for a replacement preview", async () => {
  const el = await mount();
  await el.reveal(lagerTarget);
  el.view = { kind: "customer", language: "en" };
  await settle(el);
  expect(row(el, "drinks/beer/mi")!.textContent).toContain("Cold beer");
  expect(row(el, "drinks/beer/mi")!.querySelector('[aria-current="true"]')).not.toBeNull();
  el.inspectionKey = "new-preview";
  await settle(el);
  expect(shown(el)).toEqual(["root", "drinks", "juice"]);
  expect(table(el).shadowRoot!.querySelector("[aria-current]")).toBeNull();
});

it("paints the revealed name with the shared focus outline", async () => {
  const el = await mount(fixture(), "light");
  await el.reveal(lagerTarget);
  const marker = row(el, "drinks/beer/mi")!.querySelector<HTMLElement>('[aria-current="true"]')!;
  expect(getComputedStyle(marker).outlineStyle).toBe("solid");
  expect(getComputedStyle(marker).outlineWidth).toBe("2px");
  expect(getComputedStyle(marker).outlineColor).toBe("rgb(31, 111, 235)");
});

it("reveals the named occurrence of a repeated subtree rather than the first matching product", async () => {
  const document = fixture();
  const drinks = document.root.members[0]!;
  if (drinks.kind !== "section") throw new Error("Fixture needs a section");
  document.root.members.push(documentSection("terrace", "Terrace", [structuredClone(drinks)]));
  const el = await mount(document);
  expect(await el.reveal({ ...lagerTarget, sectionIds: ["terrace", "drinks", "beer"] })).toBe(true);
  expect(row(el, "terrace/drinks/beer/mi")!.querySelector('[aria-current="true"]')).not.toBeNull();
  expect(row(el, "drinks/beer/mi")).toBeNull();
});

it("abandons a reveal when its captured preview is replaced before the render completes", async () => {
  const el = await mount();
  const pending = el.reveal(lagerTarget);
  el.inspectionKey = "replaced-before-reveal";
  await settle(el);
  expect(await pending).toBe(false);
  expect(shown(el)).toEqual(["root", "drinks", "juice"]);
  expect(table(el).shadowRoot!.querySelector("[aria-current]")).toBeNull();
});

it("clears the mark for an outside control even when that control stops its click bubbling", async () => {
  const el = await mount();
  await el.reveal(lagerTarget);
  const button = document.createElement("button");
  button.textContent = "Outside";
  button.addEventListener("click", (event) => event.stopPropagation());
  document.body.append(button);
  try {
    button.click();
    await settle(el);
    expect(table(el).shadowRoot!.querySelector("[aria-current]")).toBeNull();
  } finally {
    button.remove();
  }
});

it("tags translated names with their actual language and clears inherited language for staff names", async () => {
  const el = await mount();
  el.lang = "en";
  await toggle(el, "drinks");
  await toggle(el, "drinks/beer");
  expect(row(el, "root")!.querySelector('[data-test="root-name"]')!.getAttribute("lang")).toBe("");
  expect(row(el, "drinks/beer/mi")!.querySelector('[data-test="name"]')!.getAttribute("lang")).toBe(
    "",
  );
  el.view = { kind: "customer", language: "en" };
  await settle(el);
  expect(row(el, "drinks/beer/mi")!.querySelector('[data-test="name"]')!.getAttribute("lang")).toBe(
    "en",
  );
  expect(row(el, "drinks")!.querySelector('[data-test="name"]')!.getAttribute("lang")).toBe("es");
  expect(row(el, "juice")!.querySelector('[data-test="name"]')!.getAttribute("lang")).toBe("");
});

it("uses the phone name column for a short product name without reserving absent row actions", async () => {
  await page.viewport(390, 844);
  const doc = fixture();
  doc.offers.mi!.customerName = { es: "Patatas bravas" };
  const el = await mount(doc);
  el.style.width = "310px";
  el.view = { kind: "customer", language: "es" };
  await toggle(el, "drinks");
  await toggle(el, "drinks/beer");
  await expect.poll(() => table(el).hasAttribute("narrow")).toBe(true);
  const name = row(el, "drinks/beer/mi")!.querySelector<HTMLElement>('[data-test="name"]')!;
  expect(name.getBoundingClientRect().width).toBeGreaterThan(44);
  expect(
    table(el).shadowRoot!.querySelector<HTMLElement>(".scroll")!.scrollWidth,
  ).toBeLessThanOrEqual(310);
});
