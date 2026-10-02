import { afterEach, expect, it } from "vitest";
import type { HomeLayout } from "../api/client.js";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
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

type Picker = HTMLElement & {
  value: string;
  error: string;
  required: boolean;
  options: { value: string; label: string }[];
  updateComplete: Promise<unknown>;
};

/** The tile editor's add-or-replace dropdown. */
const pickerOf = (list: MemberListEditor): Picker =>
  list.shadowRoot!.querySelector<Picker>('wt-combobox[name="member-ref"]')!;

/** The dropdown's own trigger, which carries its invalid state. */
const controlOf = (picker: Picker): HTMLElement =>
  picker.shadowRoot!.querySelector<HTMLElement>("button.trigger")!;

/** What the closed dropdown shows on its trigger, not what its properties say it holds. */
async function shownIn(picker: Picker): Promise<string | undefined> {
  await picker.updateComplete;
  return picker.shadowRoot!.querySelector(".trigger .value")?.textContent?.trim();
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
    {
      id: "t-salad",
      position: 2,
      ref: { kind: "missing", name: t("home.missing").replace("{name}", "Salad") },
    },
  ]);
  const offered = pickerOf(editor)
    .options.map((option) => option.value)
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

it("marks an unreachable target as missing and leaves its preview cell blank", async () => {
  const el = await mount();
  const row = members(el).shadowRoot!.querySelector('[data-member="t-salad"]')!;
  expect(text(row.querySelector('[data-test="name"]'))).toBe(
    t("home.missing").replace("{name}", "Salad"),
  );
  for (const which of ["handheld", "till"]) {
    const tile = q(el, `[data-test="preview-${which}"] [data-tile="t-salad"]`)!;
    expect(text(tile)).toBe("");
    expect(tile.getAttribute("aria-hidden")).toBe("true");
    expect(tile.getBoundingClientRect().height).toBeGreaterThan(0);
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
  expect(getComputedStyle(tile("t-salad")).visibility).toBe("hidden");
  expect(product.borderTopStyle).toBe("solid");
});

it("previews the layout at 3 columns for a handheld and 6 for a till, in the same order", async () => {
  const el = await mount();
  const columns = (which: string) =>
    getComputedStyle(q(el, `[data-test="preview-${which}"]`)!).gridTemplateColumns.split(" ")
      .length;
  expect(columns("handheld")).toBe(3);
  expect(columns("till")).toBe(6);
  expect(tileNames(el, "handheld")).toEqual(["Burger", "Drinks"]);
  expect(tileNames(el, "till")).toEqual(["Burger", "Drinks"]);
  expect(text(q(el, '[data-test="preview-handheld-caption"]'))).toBe(t("home.preview_handheld"));
  expect(text(q(el, '[data-test="preview-till-caption"]'))).toBe(t("home.preview_till"));
});

it("previews the tiles in position order, whatever order they arrive in", async () => {
  const shuffled = layouts();
  shuffled[0]!.tiles.reverse();
  const el = await mount({ layouts: shuffled });
  expect(tileNames(el, "handheld")).toEqual(["Burger", "Drinks"]);
  expect(tileNames(el, "till")).toEqual(["Burger", "Drinks"]);
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
  await chooseOption(pickerOf(editor), "section:s-beer");
  await editor.updateComplete;
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
  for (const which of ["handheld", "till"]) {
    expect(
      [...q(el, `[data-test="preview-${which}"]`)!.children].map((cell) =>
        cell.getAttribute("data-tile"),
      ),
    ).toEqual(["t-burger", "t-salad", "t-drinks"]);
  }
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
  expect(text(row.querySelector('[data-test="name"]'))).toBe(
    t("home.missing").replace("{name}", "Drinks › Beer"),
  );
  expect(row.querySelector('[data-test="remove-t-missing"]')).not.toBeNull();
  expect(list.members.map((m) => m.id)).toEqual(["t-burger", "t-missing", "t-salad"]);
  expect(tileNames(el, "handheld")).toEqual(["Burger"]);
  const removes = capture(el, "wt-tile-remove");
  const moves = capture(el, "wt-tile-move");
  const replaces = capture(el, "wt-tile-replace");
  row.querySelector<HTMLElement>('[data-test="remove-t-missing"]')!.click();
  row
    .querySelector<HTMLElement>('[data-test="drag-t-missing"]')!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  await list.updateComplete;
  list.shadowRoot!.querySelector<HTMLElement>('[data-test="replace-t-missing"]')!.click();
  await list.updateComplete;
  await chooseOption(pickerOf(list), "section:s-beer");
  await list.updateComplete;
  list.shadowRoot!.querySelector<HTMLElement>('[data-test="add"]')!.click();
  expect(removes).toEqual([{ layoutId: "l-home", memberId: "t-missing" }]);
  expect(moves).toEqual([{ layoutId: "l-home", memberId: "t-missing", to: 0 }]);
  expect(replaces).toEqual([
    { layoutId: "l-home", memberId: "t-missing", ref: { kind: "section", sectionId: "s-beer" } },
  ]);
});

it("cancels a replacement when a refresh replaces the tile list or another layout is selected", async () => {
  const el = await mount();
  const list = members(el);
  const replaces = capture(el, "wt-tile-replace");
  list.shadowRoot!.querySelector<HTMLElement>('[data-test="replace-t-salad"]')!.click();
  await list.updateComplete;
  expect(list.shadowRoot!.querySelector('[data-test="replace-cancel"]')).not.toBeNull();
  el.selected = "l-counter";
  await el.updateComplete;
  await list.updateComplete;
  expect(list.shadowRoot!.querySelector('[data-test="replace-cancel"]')).toBeNull();
  expect(replaces).toEqual([]);
});

it("keeps a replacement choice through an unchanged passive snapshot and cancels when its target disappears", async () => {
  const el = await mount();
  const list = members(el);
  list.shadowRoot!.querySelector<HTMLElement>('[data-test="replace-t-salad"]')!.click();
  await list.updateComplete;
  const select = pickerOf(list);
  await chooseOption(select, "section:s-beer");
  await list.updateComplete;
  el.layouts = layouts();
  await el.updateComplete;
  await list.updateComplete;
  expect(select.value).toBe("section:s-beer");
  expect(await shownIn(select)).toBe("Beer");
  expect(list.shadowRoot!.querySelector('[data-test="replace-cancel"]')).not.toBeNull();
  const next = layouts();
  next[0]!.tiles = next[0]!.tiles.filter((tile) => tile.memberId !== "t-salad");
  el.layouts = next;
  await el.updateComplete;
  await list.updateComplete;
  expect(list.shadowRoot!.querySelector('[data-test="replace-cancel"]')).toBeNull();
});

it("explains an empty replacement beside its picker and before its disabled action", async () => {
  const el = await mount();
  const list = members(el);
  list.shadowRoot!.querySelector<HTMLElement>('[data-test="replace-t-salad"]')!.click();
  await list.updateComplete;
  list.shadowRoot!.querySelector<HTMLElement>('[data-test="add"]')!.click();
  await list.updateComplete;
  const select = pickerOf(list);
  // The dropdown draws its error inside itself, so the dropdown's place in the order is the error's.
  expect(select.shadowRoot!.querySelector("[data-error]")).not.toBeNull();
  const action =
    list.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="add"]')!;
  expect(controlOf(select).getAttribute("aria-invalid")).toBe("true");
  expect(list.shadowRoot!.activeElement).toBe(select);
  expect(action.disabled).toBe(true);
  expect(select.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("keeps a blank cell between its neighbours at both column counts", async () => {
  const rows = layouts();
  rows[0]!.tiles[1] = {
    memberId: "t-missing",
    position: 1,
    ref: { kind: "missing", name: "Drinks › Beer" },
    name: "Drinks › Beer",
    missingName: "Drinks › Beer",
    reachable: false,
  };
  rows[0]!.tiles[2]!.reachable = true;
  const el = await mount({ layouts: rows });
  for (const which of ["handheld", "till"]) {
    const grid = q(el, `[data-test="preview-${which}"]`)!;
    const cells = [...grid.children];
    expect(cells.map((cell) => cell.getAttribute("data-tile"))).toEqual([
      "t-burger",
      "t-missing",
      "t-salad",
    ]);
    const [first, blank, last] = cells.map((cell) => cell.getBoundingClientRect());
    expect(blank!.width).toBeCloseTo(first!.width, 0);
    expect(blank!.height).toBeCloseTo(first!.height, 0);
    expect(last!.left - first!.left).toBeCloseTo(2 * (blank!.left - first!.left), 0);
    expect(last!.top).toBe(first!.top);
    expect(cells[1]!.textContent?.trim()).toBe("");
  }
});

it("closes the missing row menu before focusing the replacement picker", async () => {
  const el = await mount();
  const list = members(el);
  const actions = list.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
    '[data-test="actions-t-salad"]',
  )!;
  await actions.updateComplete;
  actions.show();
  expect(actions.shadowRoot!.querySelector("#actions")!.matches(":popover-open")).toBe(true);
  const replace = list.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="replace-t-salad"]',
  )!;
  await replace.updateComplete;
  replace.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  await list.updateComplete;
  expect(actions.shadowRoot!.querySelector("#actions")!.matches(":popover-open")).toBe(false);
  expect(list.shadowRoot!.activeElement).toBe(list.shadowRoot!.querySelector("wt-combobox"));
});

it("cancels the picker when the same tile row has already been replaced by a refresh", async () => {
  const el = await mount();
  const list = members(el);
  const replacements = capture(el, "wt-tile-replace");
  list.shadowRoot!.querySelector<HTMLElement>('[data-test="replace-t-salad"]')!.click();
  await list.updateComplete;
  const next = layouts();
  next[0]!.tiles[2] = {
    memberId: "t-salad",
    position: 2,
    ref: { kind: "section", sectionId: "s-beer" },
    name: "Beer",
    missingName: null,
    reachable: true,
  };
  el.layouts = next;
  await el.updateComplete;
  await list.updateComplete;
  expect(list.shadowRoot!.querySelector('[data-test="replace-cancel"]')).toBeNull();
  expect(replacements).toEqual([]);
});

it("rechecks a required replacement after an invalid attempt and a removed passive choice", async () => {
  const el = await mount();
  const list = members(el);
  list.shadowRoot!.querySelector<HTMLElement>('[data-test="replace-t-salad"]')!.click();
  await list.updateComplete;
  const select = pickerOf(list);
  const action =
    list.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="add"]')!;
  action.click();
  await list.updateComplete;
  for (const value of ["section:s-beer", ""]) {
    await chooseOption(select, value);
    await list.updateComplete;
    expect(action.disabled).toBe(value === "");
    expect(controlOf(select).getAttribute("aria-invalid")).toBe(value === "" ? "true" : "false");
  }
  await chooseOption(select, "section:s-beer");
  await list.updateComplete;
  el.sections = el.sections.filter((section) => section.id !== "s-beer");
  await el.updateComplete;
  await list.updateComplete;
  expect(select.value).toBe("");
  expect(await shownIn(select)).toBe(t("members.tile_placeholder"));
  expect(action.disabled).toBe(true);
  expect(controlOf(select).getAttribute("aria-invalid")).toBe("true");
  expect(select.required).toBe(true);
  expect(text(select.shadowRoot!.querySelector(".field-label"))).toContain("*");
});

it("ignores an old replacement completion after cancellation and reopening the same row", async () => {
  const el = await mount();
  const list = members(el);
  const open = async () => {
    list.shadowRoot!.querySelector<HTMLElement>('[data-test="replace-t-salad"]')!.click();
    await list.updateComplete;
  };
  await open();
  const complete = el.replacementCompletion("t-salad");
  list.shadowRoot!.querySelector<HTMLElement>('[data-test="replace-cancel"]')!.click();
  await list.updateComplete;
  await open();
  complete("Old refusal");
  await list.updateComplete;
  expect(
    list.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
      .error,
  ).toBe("");
  complete("");
  await list.updateComplete;
  expect(list.shadowRoot!.querySelector('[data-test="replace-cancel"]')).not.toBeNull();
});
