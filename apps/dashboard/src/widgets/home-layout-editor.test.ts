import { afterEach, expect, it } from "vitest";
import type { HomeLayout } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
// Value import: pulls the module in for its `@customElement` side effect.
import { HomeLayoutEditor } from "./home-layout-editor.js";
import type { MemberListEditor } from "./member-list-editor.js";
import { t } from "../i18n/t.js";

afterEach(cleanupWidgets);

/** Home is the default: Burger, the Drinks section, and Salad, which has left the menu. Counter
 * holds Lemonade alone. */
function layouts(): HomeLayout[] {
  return [
    {
      id: "l-home",
      name: "Home",
      isDefault: true,
      tiles: [
        {
          memberId: "t-burger",
          position: 0,
          ref: { kind: "product", productId: "p-burger" },
          name: "Burger",
          reachable: true,
          missingName: null,
        },
        {
          memberId: "t-drinks",
          position: 1,
          ref: { kind: "section", sectionId: "s-drinks" },
          name: "Drinks",
          reachable: true,
          missingName: null,
        },
        {
          memberId: "t-salad",
          position: 2,
          ref: { kind: "product", productId: "p-salad" },
          name: "Salad",
          reachable: false,
          missingName: "Salad",
        },
      ],
    },
    {
      id: "l-counter",
      name: "Counter",
      isDefault: false,
      tiles: [
        {
          memberId: "t-lemonade",
          position: 0,
          ref: { kind: "product", productId: "p-lemonade" },
          name: "Lemonade",
          reachable: true,
          missingName: null,
        },
      ],
    },
  ];
}

/** What the menu's structure reaches, which is all the picker may offer. */
const products = [
  { id: "p-burger", name: "Burger" },
  { id: "p-lemonade", name: "Lemonade" },
  { id: "p-chips", name: "Chips" },
];
const sections = [
  { id: "s-drinks", internalName: "Drinks" },
  { id: "s-beer", internalName: "Beer" },
];

async function mount(props: Partial<HomeLayoutEditor> = {}) {
  const { el } = await mountWidget<HomeLayoutEditor>("dashboard-home-layout-editor", {
    layouts: layouts(),
    selected: "l-home",
    products,
    sections,
    menuName: "Lunch Menu",
    ...props,
  });
  await members(el).updateComplete;
  return el;
}

function q<T extends Element = HTMLElement>(el: HomeLayoutEditor, selector: string): T | null {
  return el.shadowRoot!.querySelector<T>(selector);
}

function members(el: HomeLayoutEditor): MemberListEditor {
  return q<MemberListEditor>(el, "dashboard-member-list-editor")!;
}

function capture<T>(el: HTMLElement, type: string): T[] {
  const seen: T[] = [];
  el.addEventListener(type, (event) => seen.push((event as CustomEvent<T>).detail));
  return seen;
}

function text(element: Element | null): string {
  return element!.textContent!.replace(/\s+/g, " ").trim();
}

function tileNames(el: HomeLayoutEditor, which: "handheld" | "till"): string[] {
  return [
    ...el.shadowRoot!.querySelectorAll(`[data-test="preview-${which}"] [data-test="tile-name"]`),
  ].map(text);
}

it("lists the layouts with the default marked in words, and marks the one being edited", async () => {
  const el = await mount();
  const home = q(el, '[data-test="layout-l-home"]')!;
  const counter = q(el, '[data-test="layout-l-counter"]')!;
  expect(text(home)).toContain("Home");
  expect(text(home.querySelector('[data-test="default-mark"]'))).toBe(t("home.default"));
  expect(counter.querySelector('[data-test="default-mark"]')).toBeNull();
  expect(home.getAttribute("aria-current")).toBe("true");
  expect(text(home.querySelector('[data-test="editing-mark"]'))).toBe(t("home.editing"));
  expect(counter.hasAttribute("aria-current")).toBe(false);
  expect(counter.querySelector('[data-test="editing-mark"]')).toBeNull();
  // The one being edited offers no Edit, the others do.
  expect(q(el, '[data-test="edit-l-home"]')).toBeNull();
  expect(q(el, '[data-test="edit-l-counter"]')).not.toBeNull();
});

it("edits the default when the layout it was asked for is not among them", async () => {
  const el = await mount({ selected: "l-gone" });
  expect(q(el, '[data-test="layout-l-home"]')!.getAttribute("aria-current")).toBe("true");
  expect(members(el).members.map(({ id }) => id)).toEqual(["t-burger", "t-drinks", "t-salad"]);
});

it("asks to edit another layout, to add one, and to rename, duplicate, make default or delete one", async () => {
  const el = await mount();
  const seen: [string, unknown][] = [];
  for (const type of [
    "wt-layout-select",
    "wt-layout-add",
    "wt-layout-rename",
    "wt-layout-duplicate",
    "wt-layout-default",
    "wt-layout-delete",
  ])
    el.addEventListener(type, (event) => seen.push([type, (event as CustomEvent).detail]));
  for (const test of [
    "edit-l-counter",
    "add-layout",
    "rename-l-home",
    "duplicate-l-home",
    "make-default-l-counter",
    "delete-l-counter",
  ])
    q(el, `[data-test="${test}"]`)!.click();
  expect(seen).toEqual([
    ["wt-layout-select", { layoutId: "l-counter" }],
    ["wt-layout-add", {}],
    ["wt-layout-rename", { layoutId: "l-home" }],
    ["wt-layout-duplicate", { layoutId: "l-home" }],
    ["wt-layout-default", { layoutId: "l-counter" }],
    ["wt-layout-delete", { layoutId: "l-counter" }],
  ]);
});

it("offers neither Make default nor Delete on the default, and says why it cannot be deleted", async () => {
  const el = await mount();
  expect(q(el, '[data-test="make-default-l-home"]')).toBeNull();
  expect(q(el, '[data-test="delete-l-home"]')).toBeNull();
  expect(q(el, '[data-test="rename-l-home"]')).not.toBeNull();
  expect(text(q(el, '[data-test="default-note"]'))).toBe(t("home.default_note"));
});

it("while busy, disables every layout action and reports nothing", async () => {
  const el = await mount({ busy: true });
  const seen = capture(el, "wt-layout-add");
  const renames = capture(el, "wt-layout-rename");
  const add = q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="add-layout"]')!;
  expect(add.disabled).toBe(true);
  for (const test of ["edit-l-counter", "rename-l-home", "delete-l-counter"])
    expect(q<HTMLElementTagNameMap["wt-button"]>(el, `[data-test="${test}"]`)!.disabled).toBe(true);
  add.click();
  q(el, '[data-test="rename-l-home"]')!.click();
  expect(seen).toEqual([]);
  expect(renames).toEqual([]);
  expect(members(el).busy).toBe(true);
});

it("edits the chosen layout's tiles in the member-list editor, offering only what the menu reaches and it does not hold", async () => {
  const el = await mount();
  const editor = members(el);
  expect(editor.members).toEqual([
    { id: "t-burger", position: 0, ref: { kind: "product", productId: "p-burger" } },
    { id: "t-drinks", position: 1, ref: { kind: "section", sectionId: "s-drinks" } },
    { id: "t-salad", position: 2, ref: { kind: "product", productId: "p-salad" } },
  ]);
  const offered = [...editor.shadowRoot!.querySelectorAll('select[name="member-ref"] option')]
    .map((option) => (option as HTMLOptionElement).value)
    .filter((value) => value !== "");
  expect(offered).toEqual(["product:p-chips", "product:p-lemonade", "section:s-beer"]);
  // A tile keeps its name when its target is no longer offered.
  const salad = editor.shadowRoot!.querySelector('tr[data-member="t-salad"]')!;
  expect(text(salad.querySelector('[data-test="name"]'))).toContain("Salad");
  // A section tile is not opened from here.
  expect(editor.shadowRoot!.querySelector('[data-test="open-t-drinks"]')).toBeNull();
  expect(text(q(el, '[data-test="tiles-heading"]'))).toBe(
    t("home.tiles_heading").replace("{name}", "Home"),
  );
});

it("marks a tile whose target left the menu 'Not on this menu', in the list and the preview", async () => {
  const el = await mount();
  const row = (id: string) => members(el).shadowRoot!.querySelector(`tr[data-member="${id}"]`)!;
  expect(text(row("t-salad").querySelector('[data-test="note"]'))).toBe(t("home.not_on_menu"));
  expect(row("t-burger").querySelector('[data-test="note"]')).toBeNull();
  for (const which of ["handheld", "till"]) {
    const tile = q(el, `[data-test="preview-${which}"] [data-tile="t-salad"]`)!;
    expect(text(tile)).toContain(t("home.not_on_menu"));
    expect(
      q(el, `[data-test="preview-${which}"] [data-tile="t-burger"]`)!.textContent,
    ).not.toContain(t("home.not_on_menu"));
  }
});

it("shows product and section tiles differently in words and in shape, not by colour alone", async () => {
  const el = await mount();
  const tile = (id: string) => q(el, `[data-test="preview-handheld"] [data-tile="${id}"]`)!;
  const burger = tile("t-burger");
  const drinks = tile("t-drinks");
  expect(text(burger.querySelector('[data-test="tile-kind"]'))).toBe(t("home.tile_product"));
  expect(text(drinks.querySelector('[data-test="tile-kind"]'))).toBe(t("home.tile_section"));
  expect(t("home.tile_product")).not.toBe(t("home.tile_section"));
  const product = getComputedStyle(burger);
  const section = getComputedStyle(drinks);
  // A section is drawn as a stack; a product as a single card with square-ish corners.
  expect(section.boxShadow).not.toBe("none");
  expect(product.boxShadow).toBe("none");
  expect(section.borderTopLeftRadius).not.toBe(product.borderTopLeftRadius);
  // A tile off the menu is drawn dashed, besides saying so.
  expect(getComputedStyle(tile("t-salad")).borderTopStyle).toBe("dashed");
  expect(product.borderTopStyle).toBe("solid");
});

it("previews the layout at 3 columns for a handheld and 6 for a till, in the same order", async () => {
  const el = await mount();
  const columns = (which: string) =>
    getComputedStyle(q(el, `[data-test="preview-${which}"]`)!).gridTemplateColumns.split(" ")
      .length;
  expect(columns("handheld")).toBe(3);
  expect(columns("till")).toBe(6);
  expect(tileNames(el, "handheld")).toEqual(["Burger", "Drinks", "Salad"]);
  expect(tileNames(el, "till")).toEqual(["Burger", "Drinks", "Salad"]);
  expect(text(q(el, '[data-test="preview-handheld-caption"]'))).toBe(t("home.preview_handheld"));
  expect(text(q(el, '[data-test="preview-till-caption"]'))).toBe(t("home.preview_till"));
});

it("previews the tiles in position order, whatever order they arrive in", async () => {
  const shuffled = layouts();
  shuffled[0]!.tiles.reverse();
  const el = await mount({ layouts: shuffled });
  expect(tileNames(el, "handheld")).toEqual(["Burger", "Drinks", "Salad"]);
  expect(tileNames(el, "till")).toEqual(["Burger", "Drinks", "Salad"]);
});

it("shows another layout's tiles once it is the one being edited", async () => {
  const el = await mount();
  el.selected = "l-counter";
  await el.updateComplete;
  expect(members(el).members.map(({ id }) => id)).toEqual(["t-lemonade"]);
  expect(tileNames(el, "till")).toEqual(["Lemonade"]);
});

it("says a layout with no tiles has none, in the preview too", async () => {
  const empty = layouts();
  empty[1]!.tiles = [];
  const el = await mount({ layouts: empty, selected: "l-counter" });
  expect(members(el).members).toEqual([]);
  expect(text(q(el, '[data-test="preview-empty"]'))).toBe(t("home.preview_empty"));
  expect(q(el, '[data-test="preview-handheld"]')).toBeNull();
});

it("passes the tile editor's add, remove and keyboard move on for the layout being edited, and keeps its own events in", async () => {
  const el = await mount();
  const adds = capture(el, "wt-tile-add");
  const removes = capture(el, "wt-tile-remove");
  const moves = capture(el, "wt-tile-move");
  const inner = capture(el, "wt-member-add");
  const editor = members(el);
  const select = editor.shadowRoot!.querySelector<HTMLSelectElement>('select[name="member-ref"]')!;
  select.value = "section:s-beer";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await editor.updateComplete;
  editor.shadowRoot!.querySelector<HTMLElement>('[data-test="add"]')!.click();
  editor.shadowRoot!.querySelector<HTMLElement>('[data-test="remove-t-burger"]')!.click();
  const handle = editor.shadowRoot!.querySelector<HTMLElement>('[data-test="drag-t-drinks"]')!;
  handle.focus();
  handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  expect(adds).toEqual([{ layoutId: "l-home", ref: { kind: "section", sectionId: "s-beer" } }]);
  expect(removes).toEqual([{ layoutId: "l-home", memberId: "t-burger" }]);
  expect(moves).toEqual([{ layoutId: "l-home", memberId: "t-drinks", to: 0 }]);
  expect(inner).toEqual([]);
});

it("previews a keyboard move at once, before the host confirms it", async () => {
  const el = await mount();
  const handle = members(el).shadowRoot!.querySelector<HTMLElement>('[data-test="drag-t-salad"]')!;
  handle.focus();
  handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  await el.updateComplete;
  expect(tileNames(el, "handheld")).toEqual(["Burger", "Salad", "Drinks"]);
  expect(tileNames(el, "till")).toEqual(["Burger", "Salad", "Drinks"]);
});

it("names the layouts list after the menu", async () => {
  const el = await mount();
  expect(q(el, '[data-test="layouts"]')!.getAttribute("aria-label")).toBe(
    t("home.layouts_label").replace("{menu}", "Lunch Menu"),
  );
});

it("keeps a missing tile in the editable list by its recorded name, with remove and reorder", async () => {
  const rows = layouts();
  rows[0]!.tiles[1] = {
    memberId: "t-missing",
    position: 1,
    ref: { kind: "missing", name: "Drinks › Beer" },
    name: "Drinks › Beer",
    missingName: "Drinks › Beer",
    reachable: false,
  };
  const el = await mount({ layouts: rows });
  const list = members(el);
  const row = list.shadowRoot!.querySelector('[data-member="t-missing"]')!;
  expect(text(row.querySelector('[data-test="name"]'))).toContain("Drinks › Beer");
  expect(row.querySelector('[data-test="remove-t-missing"]')).not.toBeNull();
  expect(list.members.map((m) => m.id)).toEqual(["t-burger", "t-missing", "t-salad"]);
  expect(tileNames(el, "handheld")).toEqual(["Burger", "Drinks › Beer", "Salad"]);
});
