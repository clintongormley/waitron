import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { SectionsScreen } from "./sections-screen.js";
import type {
  CategorySummary,
  DashboardApi,
  LibrarySection,
  Product,
  SectionMember,
  SectionUsages,
} from "../api/client.js";
import type { MemberListEditor } from "../widgets/member-list-editor.js";
import type { SectionAddProducts } from "../widgets/section-add-products.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";

afterEach(cleanupWidgets);
// The table remembers its filter in sessionStorage under its `viewKey`.
beforeEach(() => sessionStorage.clear());
beforeEach(() => history.replaceState(null, "", "/manage/sections"));

/** The three names read differently (CLAUDE.md §3), so a surface showing the customer-facing or
 * kitchen name where the staff name belongs fails rather than passing by coincidence. */
function product(id: string, name: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    modifiers: [],
    catalogueId: "cat-1",
    categoryId: null,
    labelIds: [],
    primaryCategoryId: null,
    name,
    customerName: { es: `${name} para clientes`, en: `${name} for guests` },
    unitId: "unit-each",
    unit: { id: "unit-each", name: { es: "Unidad" }, precision: 0, abbreviation: { es: "ud" } },
    description: null,
    kitchenName: name.toUpperCase(),
    dietaryDeclarations: [],
    pricingUnit: "each",
    unitPrice: "2.00",
    vatClass: "general",
    active: true,
    available: true,
    soldAlone: true,
    allergens: null,
    dietOverride: null,
    manualAllergens: null,
    image: null,
    variants: [],
    ...overrides,
  };
}

const products: Product[] = [
  product("p-lager", "Lager", { categoryId: "c-beer", primaryCategoryId: "c-beer" }),
  product("p-lemonade", "Lemonade", { categoryId: "c-drinks", primaryCategoryId: "c-drinks" }),
  product("p-burger", "Burger", { categoryId: "c-mains", primaryCategoryId: "c-mains" }),
  product("p-soup", "Old soup", { active: false }),
];

const categories: CategorySummary[] = [
  { id: "c-drinks", name: { es: "Bebidas" }, image: null, color: null, parentId: null },
  { id: "c-beer", name: { es: "Cerveza" }, image: null, color: null, parentId: "c-drinks" },
  { id: "c-mains", name: { es: "Principales" }, image: null, color: null, parentId: null },
];

const productMember = (id: string, position: number, productId: string): SectionMember => ({
  id,
  position,
  ref: { kind: "product", productId },
});
const sectionMember = (id: string, position: number, sectionId: string): SectionMember => ({
  id,
  position,
  ref: { kind: "section", sectionId },
});

/** Each section's customer names read differently from its internal name. */
function sections(): LibrarySection[] {
  return [
    {
      id: "s-drinks",
      internalName: "Drinks",
      names: { es: "Bebidas frías", en: "Something to drink" },
      image: null,
      color: "#aabbcc",
      members: [
        productMember("m-lager", 0, "p-lager"),
        sectionMember("m-beer", 1, "s-beer"),
        productMember("m-lemonade", 2, "p-lemonade"),
      ],
    },
    {
      id: "s-beer",
      internalName: "Beer",
      names: { es: "Cervezas" },
      image: null,
      color: null,
      members: [productMember("m-lager-2", 0, "p-lager")],
    },
    {
      id: "s-fav",
      internalName: "Favourites",
      names: { es: "Favoritos", en: "Our picks" },
      image: null,
      color: null,
      members: [
        productMember("m-fav-lemonade", 0, "p-lemonade"),
        sectionMember("m-fav-drinks", 1, "s-drinks"),
      ],
    },
    {
      id: "s-specials",
      internalName: "Specials",
      names: {},
      image: null,
      color: null,
      members: [sectionMember("m-sides", 0, "s-sides")],
    },
    {
      id: "s-sides",
      internalName: "Sides",
      names: { es: "Guarniciones" },
      image: null,
      color: null,
      members: [],
    },
  ];
}

const lunch = { id: "menu-lunch", name: "Lunch Menu" };
const dinner = { id: "menu-dinner", name: "Dinner Menu" };

/** Beer is on both menus only through nesting; Sides is held by a section but on no menu. */
function usages(): Record<string, SectionUsages> {
  return {
    "s-drinks": { menus: [dinner, lunch], sections: [{ id: "s-fav", internalName: "Favourites" }] },
    "s-beer": { menus: [dinner, lunch], sections: [{ id: "s-drinks", internalName: "Drinks" }] },
    "s-fav": { menus: [dinner], sections: [] },
    "s-specials": { menus: [], sections: [] },
    "s-sides": { menus: [], sections: [{ id: "s-specials", internalName: "Specials" }] },
  };
}

function api(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}) {
  return {
    listSections: vi.fn().mockResolvedValue(sections()),
    listSectionUsages: vi.fn().mockResolvedValue(usages()),
    listLibraryProducts: vi.fn().mockResolvedValue(products),
    listCategories: vi.fn().mockResolvedValue(categories),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getSectionUsages: vi.fn(async (id: string) => usages()[id]),
    createSection: vi.fn(async (input: { internalName: string }) => ({
      id: "s-new",
      internalName: input.internalName,
      names: {},
      image: null,
      color: null,
      members: [],
    })),
    updateSection: vi.fn(async (id: string) => sections().find((row) => row.id === id)),
    deleteSection: vi.fn().mockResolvedValue(undefined),
    listSectionMembers: vi.fn(
      async (id: string) => sections().find((row) => row.id === id)!.members,
    ),
    addSectionMember: vi.fn().mockResolvedValue(productMember("m-new", 3, "p-burger")),
    addSectionProducts: vi.fn().mockResolvedValue({ added: 1 }),
    removeSectionMember: vi.fn().mockResolvedValue(undefined),
    moveSectionMember: vi.fn(),
    duplicateSection: vi.fn().mockResolvedValue({ ...sections()[0]!, id: "s-copy" }),
    ...overrides,
  } as unknown as DashboardApi & { [K in keyof DashboardApi]: ReturnType<typeof vi.fn> };
}

type Api = ReturnType<typeof api>;

async function mount(client: Api = api()) {
  const { el } = await mountWidget<SectionsScreen>("dashboard-sections-screen", { api: client });
  await vi.waitFor(() => expect(table(el)).not.toBeNull());
  await table(el).updateComplete;
  return el;
}

type Table = HTMLElement & {
  rows: { key: string; section: LibrarySection }[];
  rowKey: (row: never) => string;
  rowParent: (row: never) => string | null;
  columns: { key: string; filter?: { options: { value: string; label: string }[] } }[];
  searchable: boolean;
  updateComplete: Promise<unknown>;
  shadowRoot: ShadowRoot;
};

function table(el: SectionsScreen): Table {
  return el.shadowRoot!.querySelector('[data-test="sections"]') as unknown as Table;
}

function shown(el: SectionsScreen, level?: number): string[] {
  const selector = level === undefined ? "tbody tr" : `tbody tr[aria-level="${level}"]`;
  return [...table(el).shadowRoot.querySelectorAll(selector)].map((row) =>
    row.getAttribute("data-row-key")!,
  );
}

async function inTable(el: SectionsScreen, testId: string): Promise<void> {
  await table(el).updateComplete;
  table(el).shadowRoot.querySelector<HTMLElement>(`[data-test="${testId}"]`)!.click();
  await el.updateComplete;
}

function modal(el: SectionsScreen, testId: string) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
    `wt-modal[data-test="${testId}"]`,
  )!;
}

function inModal<T extends Element = HTMLElement>(
  el: SectionsScreen,
  testId: string,
  selector: string,
): T | null {
  return modal(el, testId).querySelector<T>(selector);
}

async function type(target: Element, value: string): Promise<void> {
  target.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

async function openEditor(el: SectionsScreen, key: string): Promise<void> {
  await inTable(el, `open-${key}`);
  await vi.waitFor(() => expect(modal(el, "editor").open).toBe(true));
}

function memberList(el: SectionsScreen): MemberListEditor {
  return inModal<MemberListEditor>(el, "editor", "dashboard-member-list-editor")!;
}

function field(el: SectionsScreen, name: string) {
  return inModal<HTMLElementTagNameMap["wt-input"]>(el, "editor", `wt-input[name="${name}"]`)!;
}

async function summary(el: SectionsScreen, testId: string): Promise<string[]> {
  const found = inModal<HTMLElementTagNameMap["wt-form-error-summary"]>(
    el,
    testId,
    "wt-form-error-summary",
  )!;
  await found.updateComplete;
  return [...found.shadowRoot!.querySelectorAll("li")].map((item) => item.textContent!.trim());
}

function click(el: SectionsScreen, selector: string): void {
  el.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
}

function emit(target: Element, type: string, detail: unknown): void {
  target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// The list

it("lists every library section at the top level by its internal name", async () => {
  const el = await mount();
  expect(shown(el, 1).sort()).toEqual(["s-beer", "s-drinks", "s-fav", "s-sides", "s-specials"]);
  const text = table(el).shadowRoot.textContent!;
  expect(text).toContain("Drinks");
  expect(text).toContain("Favourites");
  // The customer names show in their own column, in the dashboard's language when there is one.
  const drinks = table(el).shadowRoot.querySelector('tr[data-row-key="s-drinks"]')!;
  expect(drinks.querySelector('[data-test="name"]')!.textContent!.trim()).toBe("Drinks");
  expect(drinks.textContent).toContain("Bebidas frías");
});

it("reads every section's usages in one request, never one per section", async () => {
  const client = api();
  await mount(client);
  expect(client.listSectionUsages).toHaveBeenCalledOnce();
  expect(client.getSectionUsages).not.toHaveBeenCalled();
});

it("says where each section is used, and that an unused one is not used", async () => {
  // A section the usages read does not name yet (created since) reads as not used.
  const partial = usages();
  delete partial["s-specials"];
  const el = await mount(api({ listSectionUsages: vi.fn().mockResolvedValue(partial) }));
  const cell = (key: string) =>
    table(el)
      .shadowRoot.querySelector(`tr[data-row-key="${key}"] [data-test="used-in"]`)!
      .textContent!.trim();
  expect(cell("s-drinks")).toBe("Dinner Menu, Lunch Menu, Favourites");
  expect(cell("s-specials")).toBe(t("sections.not_used"));
});

it("searches the sections by name and by where they are used", async () => {
  const el = await mount();
  expect(table(el).searchable).toBe(true);
  const search = table(el).shadowRoot.querySelector<HTMLInputElement>('[name="search"]')!;
  search.value = "Spec";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  // Sides matches because Specials holds it.
  await vi.waitFor(() => expect(shown(el, 1).sort()).toEqual(["s-sides", "s-specials"]));
  // A customer name finds Beer; Drinks is kept, muted, only to show the way down to it.
  search.value = "Cervezas";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(() => expect(shown(el)).toContain("s-drinks/s-beer"));
  const button = (key: string) =>
    table(el).shadowRoot.querySelector<HTMLElement>(`[data-test="open-${key}"]`)!;
  expect(button("s-drinks").getAttribute("part")).toBe("name name-muted");
  expect(button("s-beer").getAttribute("part")).toBe("name");
  const colour = (key: string) =>
    getComputedStyle(button(key).shadowRoot!.querySelector("button")!).color;
  expect(colour("s-drinks")).not.toBe(colour("s-beer"));
});

it("filters by use: in a menu, through nesting too, or not used at all", async () => {
  const el = await mount();
  const column = table(el).columns.find((each) => each.key === "usedIn")!;
  expect(column.filter!.options).toEqual([
    { value: "menu", label: t("sections.used_in_menu") },
    { value: "unused", label: t("sections.not_used") },
  ]);
  const filter = table(el).shadowRoot.querySelector<HTMLSelectElement>('[name="usedIn-filter"]')!;
  expect(filter.options[0]!.textContent!.trim()).toBe(t("sections.used_in_any"));
  filter.value = "menu";
  filter.dispatchEvent(new Event("change", { bubbles: true }));
  // Beer is on a menu only because Drinks holds it; Sides is held only by an unused section.
  await vi.waitFor(() => expect(shown(el, 1).sort()).toEqual(["s-beer", "s-drinks", "s-fav"]));
  filter.value = "unused";
  filter.dispatchEvent(new Event("change", { bubbles: true }));
  await vi.waitFor(() => expect(shown(el, 1)).toEqual(["s-specials"]));
  filter.value = "";
  filter.dispatchEvent(new Event("change", { bubbles: true }));
  await vi.waitFor(() => expect(shown(el, 1)).toHaveLength(5));
});

it("shows each place a section is nested, keyed by its path, and opens the same section from any", async () => {
  const client = api();
  const el = await mount(client);
  const keys = table(el).rows.map((row) => (table(el).rowKey as (row: unknown) => string)(row));
  expect(keys).toEqual(
    expect.arrayContaining([
      "s-drinks",
      "s-fav/s-drinks",
      "s-fav/s-drinks/s-beer",
      "s-drinks/s-beer",
    ]),
  );
  // Nested places start folded, so the top level reads as the library.
  expect(shown(el)).not.toContain("s-fav/s-drinks");
  const favourites = table(el).shadowRoot.querySelector<HTMLElement>(
    'tr[data-row-key="s-fav"] .tree-toggle',
  )!;
  favourites.click();
  await vi.waitFor(() => expect(shown(el)).toContain("s-fav/s-drinks"));
  expect(shown(el).filter((key) => key.endsWith("s-drinks"))).toEqual(
    expect.arrayContaining(["s-drinks", "s-fav/s-drinks"]),
  );

  await openEditor(el, "s-fav/s-drinks");
  expect(field(el, "internalName").value).toBe("Drinks");
  click(el, '[data-test="editor-cancel"]');
  await vi.waitFor(() => expect(modal(el, "editor").open).toBe(false));
  await openEditor(el, "s-drinks");
  expect(field(el, "internalName").value).toBe("Drinks");
  expect(client.getSectionUsages.mock.calls).toEqual([["s-drinks"], ["s-drinks"]]);
});

it("stops at a section already on its own path rather than nesting forever", async () => {
  const looped = sections();
  looped.find((row) => row.id === "s-beer")!.members.push(sectionMember("m-loop", 1, "s-drinks"));
  // A nested section the library list does not hold is left out rather than guessed at.
  looped.find((row) => row.id === "s-sides")!.members.push(sectionMember("m-gone", 0, "s-gone"));
  const el = await mount(api({ listSections: vi.fn().mockResolvedValue(looped) }));
  const keys = table(el).rows.map((row) => (table(el).rowKey as (row: unknown) => string)(row));
  expect(keys).toContain("s-drinks/s-beer");
  expect(keys).not.toContain("s-drinks/s-beer/s-drinks");
  expect(keys).toContain("s-beer/s-drinks");
  expect(keys.some((key) => key.includes("s-gone"))).toBe(false);
});

it("opens the section a ?section= link names, once, and ignores an unknown one", async () => {
  history.replaceState(null, "", "/manage/sections?section=s-beer&keep=1");
  const client = api();
  const el = await mount(client);
  await vi.waitFor(() => expect(modal(el, "editor").open).toBe(true));
  expect(field(el, "internalName").value).toBe("Beer");
  expect(location.search).toBe("?keep=1");
  cleanupWidgets();

  history.replaceState(null, "", "/manage/sections?section=s-gone");
  const other = await mount();
  expect(modal(other, "editor").open).toBe(false);
});

it("says so when there are no sections yet", async () => {
  const el = await mount(api({ listSections: vi.fn().mockResolvedValue([]) }));
  expect((table(el) as unknown as { emptyMessage: string }).emptyMessage).toBe(t("sections.empty"));
});

it("shows a load failure with a retry that loads again", async () => {
  const client = api({
    listSections: vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(sections()),
  });
  const { el } = await mountWidget<SectionsScreen>("dashboard-sections-screen", { api: client });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector('[data-test="load-error"]')).not.toBeNull(),
  );
  click(el, '[data-test="retry"]');
  await vi.waitFor(() => expect(table(el)).not.toBeNull());
  expect(el.shadowRoot!.querySelector('[data-test="load-error"]')).toBeNull();
});

// ---------------------------------------------------------------------------
// The editor

it("opens an editor with the section's details, its wider use above its members, and its members", async () => {
  const el = await mount();
  await openEditor(el, "s-drinks");
  const name = field(el, "internalName");
  expect(name.required).toBe(true);
  expect(name.value).toBe("Drinks");
  expect(field(el, "names-es").value).toBe("Bebidas frías");
  expect(field(el, "names-en").value).toBe("Something to drink");
  expect(field(el, "names-es").required).toBe(false);
  expect(inModal(el, "editor", "dashboard-image-upload")).not.toBeNull();
  // The colour is not a palette one, so the custom picker holds it and "No colour" is not chosen.
  expect(inModal<HTMLInputElement>(el, "editor", 'input[type="color"]')!.value).toBe("#aabbcc");
  expect(inModal(el, "editor", '.swatch[data-color=""]')!.getAttribute("aria-checked")).toBe(
    "false",
  );
  const usedIn = await vi.waitFor(() => {
    const found = inModal(el, "editor", '[data-test="editor-used-in"]')!;
    expect(found.textContent).toContain("Dinner Menu");
    return found;
  });
  expect(usedIn.textContent!.trim()).toBe(
    t("sections.used_in_note").replace("{list}", "Dinner Menu, Lunch Menu, Favourites"),
  );
  const list = memberList(el);
  // The note comes before the member list, so a shared edit shows its wider use first.
  expect(usedIn.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(list.members.map((member) => member.id)).toEqual(["m-lager", "m-beer", "m-lemonade"]);
  expect(list.products.map((each) => each.name)).toEqual([
    "Lager",
    "Lemonade",
    "Burger",
    "Old soup",
  ]);
  expect(list.sections.map((each) => each.internalName)).toContain("Favourites");
  // Drinks itself, and Favourites, which holds it, would each make a loop.
  expect([...list.excludeSectionIds].sort()).toEqual(["s-drinks", "s-fav"]);
});

it("excludes every section that holds this one, however deep", async () => {
  // Favourites holds Beer directly as well as through Drinks.
  const shared = sections();
  shared.find((row) => row.id === "s-fav")!.members.push(sectionMember("m-fav-beer", 2, "s-beer"));
  const el = await mount(api({ listSections: vi.fn().mockResolvedValue(shared) }));
  await openEditor(el, "s-beer");
  expect([...memberList(el).excludeSectionIds].sort()).toEqual(["s-beer", "s-drinks", "s-fav"]);
});

it("says a section is not used anywhere yet, and says so when its use cannot be read", async () => {
  const client = api({
    getSectionUsages: vi
      .fn()
      .mockResolvedValueOnce({ menus: [], sections: [] })
      .mockRejectedValueOnce(new Error("down")),
  });
  const el = await mount(client);
  await openEditor(el, "s-specials");
  await vi.waitFor(() =>
    expect(inModal(el, "editor", '[data-test="editor-used-in"]')!.textContent!.trim()).toBe(
      t("sections.used_nowhere"),
    ),
  );
  click(el, '[data-test="editor-cancel"]');
  await openEditor(el, "s-drinks");
  await vi.waitFor(() =>
    expect(inModal(el, "editor", '[data-test="editor-used-in"]')!.textContent!.trim()).toBe(
      t("sections.usages_error"),
    ),
  );
});

it("ignores a usages answer that arrives after the editor moved on to another section", async () => {
  const slow = deferred<SectionUsages>();
  const client = api({
    getSectionUsages: vi
      .fn()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce({ menus: [], sections: [] }),
  });
  const el = await mount(client);
  await openEditor(el, "s-drinks");
  click(el, '[data-test="editor-cancel"]');
  await openEditor(el, "s-specials");
  await vi.waitFor(() =>
    expect(inModal(el, "editor", '[data-test="editor-used-in"]')!.textContent!.trim()).toBe(
      t("sections.used_nowhere"),
    ),
  );
  slow.resolve(usages()["s-drinks"]!);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(inModal(el, "editor", '[data-test="editor-used-in"]')!.textContent!.trim()).toBe(
    t("sections.used_nowhere"),
  );
});

it("saves the details, sending only the customer names that have text, and closes", async () => {
  const client = api();
  const el = await mount(client);
  await openEditor(el, "s-drinks");
  await type(field(el, "internalName"), "  Drinks bar ");
  await type(field(el, "names-en"), "  ");
  inModal<HTMLElement>(el, "editor", '.swatch[data-color=""]')!.click();
  await el.updateComplete;
  const loads = client.listSections.mock.calls.length;
  click(el, '[data-test="editor-save"]');
  await vi.waitFor(() => expect(modal(el, "editor").open).toBe(false));
  expect(client.updateSection).toHaveBeenCalledWith("s-drinks", {
    internalName: "Drinks bar",
    names: { es: "Bebidas frías" },
    image: null,
    color: null,
  });
  await vi.waitFor(() => expect(client.listSections.mock.calls.length).toBeGreaterThan(loads));
});

it("saves on Enter in a field", async () => {
  const client = api();
  const el = await mount(client);
  await openEditor(el, "s-drinks");
  await field(el, "internalName").updateComplete;
  field(el, "internalName")
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  await vi.waitFor(() => expect(client.updateSection).toHaveBeenCalledOnce());
});

it("refuses a blank internal name beside the field and in the summary, without saving", async () => {
  const client = api();
  const el = await mount(client);
  await openEditor(el, "s-drinks");
  await type(field(el, "internalName"), "   ");
  click(el, '[data-test="editor-save"]');
  await el.updateComplete;
  expect(field(el, "internalName").error).toBe(t("sections.internal_name_required"));
  expect(await summary(el, "editor")).toEqual([t("sections.internal_name_required")]);
  expect(client.updateSection).not.toHaveBeenCalled();
  expect(modal(el, "editor").open).toBe(true);
  // Typing again clears the complaint.
  await type(field(el, "internalName"), "Drinks");
  await el.updateComplete;
  expect(field(el, "internalName").error).toBe("");
});

it("puts a server refusal beside the field it names, keeping the typed values", async () => {
  const client = api({
    updateSection: vi
      .fn()
      .mockRejectedValueOnce({
        code: "menu_section.translation_required",
        params: { field: "names", language: "es" },
      })
      .mockRejectedValueOnce({ code: "menu_section.invalid", params: { field: "internalName" } })
      .mockRejectedValueOnce({ code: "menu_section.invalid", params: { field: "color" } })
      .mockRejectedValueOnce({ code: "server.internal" }),
  });
  const el = await mount(client);
  await openEditor(el, "s-drinks");
  await type(field(el, "names-es"), "");
  click(el, '[data-test="editor-save"]');
  await vi.waitFor(() =>
    expect(field(el, "names-es").error).toBe(codeMessage("menu_section.translation_required")),
  );
  expect(await summary(el, "editor")).toEqual([codeMessage("menu_section.translation_required")]);
  expect(field(el, "names-en").value).toBe("Something to drink");

  click(el, '[data-test="editor-save"]');
  await vi.waitFor(() =>
    expect(field(el, "internalName").error).toBe(codeMessage("menu_section.invalid")),
  );
  expect(field(el, "names-es").error).toBe("");

  click(el, '[data-test="editor-save"]');
  await vi.waitFor(() =>
    expect(inModal(el, "editor", "#section-color-error")!.textContent!.trim()).toBe(
      codeMessage("menu_section.invalid"),
    ),
  );

  click(el, '[data-test="editor-save"]');
  await vi.waitFor(async () =>
    expect(await summary(el, "editor")).toEqual([codeMessage("server.internal")]),
  );
  expect(modal(el, "editor").open).toBe(true);
});

it("treats a failed refresh after a successful save as a load failure, not a failed save", async () => {
  const client = api({
    listSections: vi.fn().mockResolvedValueOnce(sections()).mockRejectedValue(new Error("down")),
  });
  const el = await mount(client);
  await openEditor(el, "s-drinks");
  click(el, '[data-test="editor-save"]');
  await vi.waitFor(() => expect(modal(el, "editor").open).toBe(false));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector('[data-test="load-error"]')).not.toBeNull(),
  );
});

it("creates a section and keeps the editor open on it, so its members can be added", async () => {
  const client = api();
  const el = await mount(client);
  click(el, '[data-test="add-section"]');
  await vi.waitFor(() => expect(modal(el, "editor").open).toBe(true));
  expect(modal(el, "editor").heading).toBe(t("sections.create"));
  expect(field(el, "internalName").value).toBe("");
  expect(field(el, "names-es").value).toBe("");
  expect(memberList(el)).toBeNull();
  expect(inModal(el, "editor", '[data-test="members-after-create"]')).not.toBeNull();
  await type(field(el, "internalName"), "Brunch");
  click(el, '[data-test="editor-save"]');
  await vi.waitFor(() => expect(memberList(el)).not.toBeNull());
  expect(client.createSection).toHaveBeenCalledWith({
    internalName: "Brunch",
    names: {},
    image: null,
    color: null,
  });
  expect(modal(el, "editor").heading).toBe(t("sections.edit"));
  expect(memberList(el).members).toEqual([]);
  expect(memberList(el).excludeSectionIds).toEqual(["s-new"]);
  expect(inModal(el, "editor", '[data-test="editor-used-in"]')!.textContent!.trim()).toBe(
    t("sections.used_nowhere"),
  );
  // Saving again updates the new section rather than creating a second one.
  click(el, '[data-test="editor-save"]');
  await vi.waitFor(() => expect(client.updateSection).toHaveBeenCalledOnce());
  expect(client.updateSection.mock.calls[0]![0]).toBe("s-new");
  expect(client.createSection).toHaveBeenCalledOnce();
});

it("closes on Cancel and on the modal's own close, but not while a save is in flight", async () => {
  const save = deferred<LibrarySection>();
  const client = api({ updateSection: vi.fn().mockReturnValue(save.promise) });
  const el = await mount(client);
  await openEditor(el, "s-drinks");
  const idle = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  modal(el, "editor").dispatchEvent(idle);
  expect(idle.defaultPrevented).toBe(false);
  emit(modal(el, "editor"), "wt-close", {});
  await el.updateComplete;
  expect(modal(el, "editor").open).toBe(false);

  await openEditor(el, "s-drinks");
  click(el, '[data-test="editor-save"]');
  await el.updateComplete;
  emit(modal(el, "editor"), "wt-close", {});
  click(el, '[data-test="editor-cancel"]');
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  modal(el, "editor").dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(true);
  await el.updateComplete;
  expect(modal(el, "editor").open).toBe(true);
  // A second press while the first is in flight sends nothing more.
  click(el, '[data-test="editor-save"]');
  expect(client.updateSection).toHaveBeenCalledOnce();
  save.resolve(sections()[0]!);
  await vi.waitFor(() => expect(modal(el, "editor").open).toBe(false));
});

it("keeps the editor open while the image picker is open", async () => {
  const el = await mount();
  await openEditor(el, "s-drinks");
  const upload = inModal(el, "editor", "dashboard-image-upload")!;
  emit(upload, "image-picker-state", { open: true });
  await el.updateComplete;
  emit(modal(el, "editor"), "wt-close", {});
  await el.updateComplete;
  expect(modal(el, "editor").open).toBe(true);
  emit(upload, "image-changed", { image: "img-1" });
  emit(upload, "image-picker-state", { open: false });
  await el.updateComplete;
  expect(
    inModal<HTMLElement & { image: string | null }>(el, "editor", "dashboard-image-upload")!.image,
  ).toBe("img-1");
});

it("saves a removed image as none", async () => {
  const withImage = sections();
  withImage[1]!.image = "img-beer";
  const client = api({ listSections: vi.fn().mockResolvedValue(withImage) });
  const el = await mount(client);
  await openEditor(el, "s-beer");
  const upload = inModal<HTMLElement & { image: string | null }>(
    el,
    "editor",
    "dashboard-image-upload",
  )!;
  expect(upload.image).toBe("img-beer");
  emit(upload, "image-changed", { image: null });
  await el.updateComplete;
  click(el, '[data-test="editor-save"]');
  await vi.waitFor(() => expect(client.updateSection).toHaveBeenCalledOnce());
  expect(client.updateSection.mock.calls[0]![1]).toMatchObject({ image: null });
});

it("sets a custom colour from the colour input", async () => {
  const client = api();
  const el = await mount(client);
  await openEditor(el, "s-beer");
  const input = inModal<HTMLInputElement>(el, "editor", 'input[type="color"]')!;
  input.value = "#123456";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await el.updateComplete;
  click(el, '[data-test="editor-save"]');
  await vi.waitFor(() => expect(client.updateSection).toHaveBeenCalledOnce());
  expect(client.updateSection.mock.calls[0]![1]).toMatchObject({ color: "#123456" });
});

// ---------------------------------------------------------------------------
// Members

it("adds a member and shows the list the server then holds", async () => {
  const client = api({
    listSectionMembers: vi
      .fn()
      .mockResolvedValue([...sections()[0]!.members, productMember("m-new", 3, "p-burger")]),
  });
  const el = await mount(client);
  await openEditor(el, "s-drinks");
  emit(memberList(el), "wt-member-add", { ref: { kind: "product", productId: "p-burger" } });
  await vi.waitFor(() => expect(memberList(el).members).toHaveLength(4));
  expect(client.addSectionMember).toHaveBeenCalledWith("s-drinks", {
    kind: "product",
    productId: "p-burger",
  });
  expect(client.listSectionMembers).toHaveBeenCalledWith("s-drinks");
});

it("shows a refused nesting beside the member list and in the form's summary", async () => {
  const client = api({
    addSectionMember: vi.fn().mockRejectedValue({
      code: "menu_section.member_cycle",
      params: { sectionId: "s-beer", childSectionId: "s-fav" },
    }),
  });
  const el = await mount(client);
  await openEditor(el, "s-beer");
  emit(memberList(el), "wt-member-add", { ref: { kind: "section", sectionId: "s-fav" } });
  const message = codeMessage("menu_section.member_cycle");
  await vi.waitFor(() =>
    expect(inModal(el, "editor", '[data-test="member-error"]')!.textContent!.trim()).toBe(message),
  );
  expect(await summary(el, "editor")).toEqual([message]);
  const error = inModal(el, "editor", '[data-test="member-error"]')!;
  expect(
    error.compareDocumentPosition(memberList(el)) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(memberList(el).members.map((member) => member.id)).toEqual(["m-lager-2"]);
  // The next member action clears it.
  emit(memberList(el), "wt-member-remove", { memberId: "m-lager-2" });
  await vi.waitFor(() => expect(inModal(el, "editor", '[data-test="member-error"]')).toBeNull());
});

it("removes a member", async () => {
  const client = api({ listSectionMembers: vi.fn().mockResolvedValue([]) });
  const el = await mount(client);
  await openEditor(el, "s-beer");
  emit(memberList(el), "wt-member-remove", { memberId: "m-lager-2" });
  await vi.waitFor(() => expect(memberList(el).members).toEqual([]));
  expect(client.removeSectionMember).toHaveBeenCalledWith("s-beer", "m-lager-2");
});

it("says the list could not be reloaded when the write succeeded but the reload failed", async () => {
  const client = api({ listSectionMembers: vi.fn().mockRejectedValue(new Error("down")) });
  const el = await mount(client);
  await openEditor(el, "s-beer");
  emit(memberList(el), "wt-member-remove", { memberId: "m-lager-2" });
  await vi.waitFor(() =>
    expect(inModal(el, "editor", '[data-test="members-reload-error"]')).not.toBeNull(),
  );
  expect(inModal(el, "editor", '[data-test="member-error"]')).toBeNull();
});

it("saves a keyboard move and keeps focus on the moved row, which stays usable while it saves", async () => {
  const saving = deferred<SectionMember[]>();
  const client = api({ moveSectionMember: vi.fn().mockReturnValue(saving.promise) });
  const el = await mount(client);
  await openEditor(el, "s-drinks");
  const list = memberList(el);
  const handle = () =>
    list.shadowRoot!.querySelector<HTMLButtonElement>('[data-test="drag-m-lager"]')!;
  handle().focus();
  handle().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await list.updateComplete;
  await vi.waitFor(() =>
    expect(client.moveSectionMember).toHaveBeenCalledWith("s-drinks", "m-lager", 1),
  );
  await el.updateComplete;
  await list.updateComplete;
  expect(handle().disabled).toBe(false);
  expect(list.shadowRoot!.activeElement).toBe(handle());

  saving.resolve([
    sectionMember("m-beer", 0, "s-beer"),
    productMember("m-lager", 1, "p-lager"),
    productMember("m-lemonade", 2, "p-lemonade"),
  ]);
  await vi.waitFor(() => expect(list.members.map((member) => member.position)).toEqual([0, 1, 2]));
  await vi.waitFor(() =>
    expect(list.members.map((member) => member.id)).toEqual(["m-beer", "m-lager", "m-lemonade"]),
  );
  await list.updateComplete;
  expect(list.shadowRoot!.activeElement).toBe(handle());
});

it("sends moves one after another and shows the answer only once the last has saved", async () => {
  const first = deferred<SectionMember[]>();
  const second = deferred<SectionMember[]>();
  const client = api({
    moveSectionMember: vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise),
  });
  const el = await mount(client);
  await openEditor(el, "s-drinks");
  const list = memberList(el);
  emit(list, "wt-member-move", { memberId: "m-lager", to: 1 });
  emit(list, "wt-member-move", { memberId: "m-lager", to: 2 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledOnce());
  const before = list.members;
  first.resolve([
    sectionMember("m-beer", 0, "s-beer"),
    productMember("m-lager", 1, "p-lager"),
    productMember("m-lemonade", 2, "p-lemonade"),
  ]);
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledTimes(2));
  expect(client.moveSectionMember.mock.calls[1]).toEqual(["s-drinks", "m-lager", 2]);
  // The first answer is already out of date, so the list is left as the widget shows it.
  expect(list.members).toBe(before);
  second.resolve([
    sectionMember("m-beer", 0, "s-beer"),
    productMember("m-lemonade", 1, "p-lemonade"),
    productMember("m-lager", 2, "p-lager"),
  ]);
  await vi.waitFor(() =>
    expect(list.members.map((member) => member.id)).toEqual(["m-beer", "m-lemonade", "m-lager"]),
  );
});

it("saves a pointer drag as one move, however many rows it crossed", async () => {
  const client = api({
    moveSectionMember: vi
      .fn()
      .mockResolvedValue([
        sectionMember("m-beer", 0, "s-beer"),
        productMember("m-lemonade", 1, "p-lemonade"),
        productMember("m-lager", 2, "p-lager"),
      ]),
  });
  const el = await mount(client);
  await openEditor(el, "s-drinks");
  const list = memberList(el);
  await list.updateComplete;
  list
    .shadowRoot!.querySelector('[data-test="drag-m-lager"]')!
    .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 3 }));
  for (const over of ["m-beer", "m-lemonade"]) {
    const box = list
      .shadowRoot!.querySelector(`tr[data-member="${over}"]`)!
      .getBoundingClientRect();
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 3,
        clientY: box.top + box.height / 2,
      }),
    );
    await list.updateComplete;
  }
  expect(client.moveSectionMember).not.toHaveBeenCalled();
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 3 }));
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledOnce());
  expect(client.moveSectionMember).toHaveBeenCalledWith("s-drinks", "m-lager", 2);
});

it("after a refused move, drops the moves queued behind it and shows the list the server holds", async () => {
  const first = deferred<SectionMember[]>();
  const client = api({
    moveSectionMember: vi.fn().mockReturnValueOnce(first.promise),
  });
  const el = await mount(client);
  await openEditor(el, "s-drinks");
  const list = memberList(el);
  emit(list, "wt-member-move", { memberId: "m-lager", to: 1 });
  emit(list, "wt-member-move", { memberId: "m-lager", to: 2 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledOnce());
  first.reject({ code: "menu_section.not_found", params: { sectionId: "s-drinks" } });
  await vi.waitFor(() =>
    expect(inModal(el, "editor", '[data-test="member-error"]')!.textContent!.trim()).toBe(
      codeMessage("menu_section.not_found"),
    ),
  );
  expect(client.listSectionMembers).toHaveBeenCalledWith("s-drinks");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(client.moveSectionMember).toHaveBeenCalledOnce();
  // A later move is sent again.
  client.moveSectionMember.mockResolvedValueOnce(sections()[0]!.members);
  emit(list, "wt-member-move", { memberId: "m-lager", to: 1 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledTimes(2));
});

it("does not apply a move's answer to a different section opened meanwhile", async () => {
  const saving = deferred<SectionMember[]>();
  const client = api({ moveSectionMember: vi.fn().mockReturnValue(saving.promise) });
  const el = await mount(client);
  await openEditor(el, "s-drinks");
  emit(memberList(el), "wt-member-move", { memberId: "m-lager", to: 1 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledOnce());
  click(el, '[data-test="editor-cancel"]');
  await openEditor(el, "s-beer");
  saving.resolve(sections()[0]!.members);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(memberList(el).members.map((member) => member.id)).toEqual(["m-lager-2"]);
});

it("reloads the list after closing an editor whose members changed", async () => {
  const client = api({ listSectionMembers: vi.fn().mockResolvedValue([]) });
  const el = await mount(client);
  await openEditor(el, "s-beer");
  const loads = client.listSections.mock.calls.length;
  click(el, '[data-test="editor-cancel"]');
  await el.updateComplete;
  expect(client.listSections.mock.calls.length).toBe(loads);
  await openEditor(el, "s-beer");
  emit(memberList(el), "wt-member-remove", { memberId: "m-lager-2" });
  await vi.waitFor(() => expect(memberList(el).members).toEqual([]));
  click(el, '[data-test="editor-cancel"]');
  await vi.waitFor(() => expect(client.listSections.mock.calls.length).toBe(loads + 1));
});

it("opens a nested section from the member list in the same editor", async () => {
  const client = api();
  const el = await mount(client);
  await openEditor(el, "s-drinks");
  emit(memberList(el), "wt-member-open", { sectionId: "s-beer" });
  await vi.waitFor(() => expect(field(el, "internalName").value).toBe("Beer"));
  expect(memberList(el).members.map((member) => member.id)).toEqual(["m-lager-2"]);
  expect(client.getSectionUsages).toHaveBeenLastCalledWith("s-beer");
  // A section the library no longer lists is not opened.
  emit(memberList(el), "wt-member-open", { sectionId: "s-gone" });
  await el.updateComplete;
  expect(field(el, "internalName").value).toBe("Beer");
});

it("changes nothing when a refused move answers for a section no longer open", async () => {
  const saving = deferred<SectionMember[]>();
  const client = api({ moveSectionMember: vi.fn().mockReturnValue(saving.promise) });
  const el = await mount(client);
  await openEditor(el, "s-drinks");
  emit(memberList(el), "wt-member-move", { memberId: "m-lager", to: 1 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledOnce());
  click(el, '[data-test="editor-cancel"]');
  await openEditor(el, "s-beer");
  saving.reject({ code: "menu_section.not_found" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(inModal(el, "editor", '[data-test="member-error"]')).toBeNull();
  expect(client.listSectionMembers).not.toHaveBeenCalled();
  expect(memberList(el).members.map((member) => member.id)).toEqual(["m-lager-2"]);
});

// ---------------------------------------------------------------------------
// Add products

it("adds several products through the Add products view and returns to the details", async () => {
  const client = api({
    listSectionMembers: vi
      .fn()
      .mockResolvedValue([...sections()[1]!.members, productMember("m-burger", 1, "p-burger")]),
  });
  const el = await mount(client);
  await openEditor(el, "s-beer");
  click(el, '[data-test="open-add-products"]');
  await el.updateComplete;
  const picker = inModal<SectionAddProducts>(el, "editor", "dashboard-section-add-products")!;
  expect(modal(el, "editor").heading).toBe(
    t("sections.add_products_heading").replace("{name}", "Beer"),
  );
  expect(memberList(el)).toBeNull();
  // Only Active products are offered; the ones held directly are marked, and there is no menu here.
  expect(picker.products.map((each) => each.id)).toEqual(["p-lager", "p-lemonade", "p-burger"]);
  expect(picker.inSection).toEqual(["p-lager"]);
  expect(picker.onMenu).toBeNull();
  expect(picker.categories).toEqual(categories);
  emit(picker, "wt-add-products", { productIds: ["p-burger", "p-lemonade"] });
  await vi.waitFor(() => expect(memberList(el)).not.toBeNull());
  expect(client.addSectionProducts).toHaveBeenCalledWith("s-beer", ["p-burger", "p-lemonade"]);
  expect(memberList(el).members.map((member) => member.id)).toEqual(["m-lager-2", "m-burger"]);
});

it("keeps the Add products view, with an error, when adding fails; Back returns to the details", async () => {
  const client = api({
    addSectionProducts: vi.fn().mockRejectedValue({ code: "menu_section.membership_invalid" }),
  });
  const el = await mount(client);
  await openEditor(el, "s-beer");
  click(el, '[data-test="open-add-products"]');
  await el.updateComplete;
  const picker = inModal(el, "editor", "dashboard-section-add-products")!;
  emit(picker, "wt-add-products", { productIds: ["p-burger"] });
  await vi.waitFor(() =>
    expect(inModal(el, "editor", '[data-test="member-error"]')!.textContent!.trim()).toBe(
      codeMessage("menu_section.membership_invalid"),
    ),
  );
  expect(inModal(el, "editor", "dashboard-section-add-products")).toBe(picker);
  click(el, '[data-test="add-products-back"]');
  await el.updateComplete;
  expect(inModal(el, "editor", "dashboard-section-add-products")).toBeNull();
  expect(memberList(el)).not.toBeNull();
});

// ---------------------------------------------------------------------------
// Duplicate and delete

it("duplicates a section under '<name> (copy)', with every immediate member ticked", async () => {
  const client = api();
  const el = await mount(client);
  await inTable(el, "duplicate-s-drinks");
  await vi.waitFor(() => expect(modal(el, "duplicate").open).toBe(true));
  const name = inModal<HTMLElementTagNameMap["wt-input"]>(
    el,
    "duplicate",
    'wt-input[name="internalName"]',
  )!;
  expect(name.value).toBe(t("sections.copy_name").replace("{name}", "Drinks"));
  expect(name.required).toBe(true);
  const boxes = [
    ...modal(el, "duplicate").querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ];
  expect(boxes.map((box) => [box.value, box.checked])).toEqual([
    ["m-lager", true],
    ["m-beer", true],
    ["m-lemonade", true],
  ]);
  expect(modal(el, "duplicate").textContent).toContain("Beer");
  boxes[1]!.click();
  await el.updateComplete;
  const loads = client.listSections.mock.calls.length;
  click(el, '[data-test="duplicate-save"]');
  await vi.waitFor(() => expect(modal(el, "duplicate").open).toBe(false));
  expect(client.duplicateSection).toHaveBeenCalledWith("s-drinks", {
    internalName: t("sections.copy_name").replace("{name}", "Drinks"),
    memberIds: ["m-lager", "m-lemonade"],
  });
  await vi.waitFor(() => expect(client.listSections.mock.calls.length).toBeGreaterThan(loads));
});

it("refuses a blank copy name, and shows a server refusal, in the duplicate form", async () => {
  const client = api({
    duplicateSection: vi
      .fn()
      .mockRejectedValue({ code: "menu_section.membership_invalid", params: {} }),
  });
  const el = await mount(client);
  await inTable(el, "duplicate-s-beer");
  const name = inModal<HTMLElementTagNameMap["wt-input"]>(
    el,
    "duplicate",
    'wt-input[name="internalName"]',
  )!;
  await type(name, " ");
  await el.updateComplete;
  click(el, '[data-test="duplicate-save"]');
  await el.updateComplete;
  expect(name.error).toBe(t("sections.internal_name_required"));
  expect(await summary(el, "duplicate")).toEqual([t("sections.internal_name_required")]);
  expect(client.duplicateSection).not.toHaveBeenCalled();
  await type(name, "Beer two");
  await el.updateComplete;
  expect(name.error).toBe("");
  await name.updateComplete;
  name
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  await vi.waitFor(async () =>
    expect(await summary(el, "duplicate")).toEqual([
      codeMessage("menu_section.membership_invalid"),
    ]),
  );
  expect(modal(el, "duplicate").open).toBe(true);
  emit(modal(el, "duplicate"), "wt-close", {});
  await el.updateComplete;
  expect(modal(el, "duplicate").open).toBe(false);
});

it("puts a refused copy name beside the name field", async () => {
  const client = api({
    duplicateSection: vi
      .fn()
      .mockRejectedValue({ code: "menu_section.invalid", params: { field: "internalName" } }),
  });
  const el = await mount(client);
  await inTable(el, "duplicate-s-beer");
  click(el, '[data-test="duplicate-save"]');
  const name = inModal<HTMLElementTagNameMap["wt-input"]>(
    el,
    "duplicate",
    'wt-input[name="internalName"]',
  )!;
  await vi.waitFor(() => expect(name.error).toBe(codeMessage("menu_section.invalid")));
  click(el, '[data-test="duplicate-cancel"]');
  await el.updateComplete;
  expect(modal(el, "duplicate").open).toBe(false);
});

it("can tick a member again, names one it no longer knows, and holds the form while copying", async () => {
  const copying = deferred<LibrarySection>();
  const listed = sections();
  listed.find((row) => row.id === "s-beer")!.members.push(productMember("m-gone", 1, "p-gone"));
  const client = api({
    listSections: vi.fn().mockResolvedValue(listed),
    duplicateSection: vi.fn().mockReturnValue(copying.promise),
  });
  const el = await mount(client);
  await inTable(el, "duplicate-s-beer");
  const labels = [...modal(el, "duplicate").querySelectorAll("label.pick")].map((label) =>
    label.textContent!.replace(/\s+/g, " ").trim(),
  );
  expect(labels).toEqual([
    `Lager ${t("members.kind_product")}`,
    `${t("members.missing")} ${t("members.kind_product")}`,
  ]);
  const box = modal(el, "duplicate").querySelector<HTMLInputElement>('input[value="m-gone"]')!;
  box.click();
  await el.updateComplete;
  box.click();
  await el.updateComplete;
  expect(box.checked).toBe(true);
  const idle = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  modal(el, "duplicate").dispatchEvent(idle);
  expect(idle.defaultPrevented).toBe(false);
  click(el, '[data-test="duplicate-save"]');
  await el.updateComplete;
  click(el, '[data-test="duplicate-save"]');
  emit(modal(el, "duplicate"), "wt-close", {});
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  modal(el, "duplicate").dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(true);
  await el.updateComplete;
  expect(modal(el, "duplicate").open).toBe(true);
  expect(client.duplicateSection).toHaveBeenCalledOnce();
  expect(client.duplicateSection.mock.calls[0]![1]).toEqual({
    internalName: t("sections.copy_name").replace("{name}", "Beer"),
    memberIds: ["m-lager-2", "m-gone"],
  });
  copying.resolve(listed[1]!);
  await vi.waitFor(() => expect(modal(el, "duplicate").open).toBe(false));
});

it("lists only the menus, or only the sections, when the section is used in just one kind", async () => {
  const el = await mount();
  await inTable(el, "delete-s-fav");
  await vi.waitFor(() =>
    expect(inModal(el, "delete", '[data-test="delete-menus"]')!.textContent).toContain(
      "Dinner Menu",
    ),
  );
  expect(inModal(el, "delete", '[data-test="delete-sections"]')).toBeNull();
  const idle = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  modal(el, "delete").dispatchEvent(idle);
  expect(idle.defaultPrevented).toBe(false);
  click(el, '[data-test="delete-cancel"]');
  await inTable(el, "delete-s-sides");
  await vi.waitFor(() =>
    expect(inModal(el, "delete", '[data-test="delete-sections"]')!.textContent).toContain(
      "Specials",
    ),
  );
  expect(inModal(el, "delete", '[data-test="delete-menus"]')).toBeNull();
});

it("lists the menus and sections a section is used in before deleting it", async () => {
  const client = api();
  const el = await mount(client);
  await inTable(el, "delete-s-drinks");
  await vi.waitFor(() => expect(modal(el, "delete").open).toBe(true));
  expect(modal(el, "delete").heading).toBe(t("sections.delete_named").replace("{name}", "Drinks"));
  await vi.waitFor(() =>
    expect(inModal(el, "delete", '[data-test="delete-menus"]')!.textContent).toContain(
      "Lunch Menu",
    ),
  );
  expect(inModal(el, "delete", '[data-test="delete-menus"]')!.textContent).toContain("Dinner Menu");
  expect(inModal(el, "delete", '[data-test="delete-sections"]')!.textContent).toContain(
    "Favourites",
  );
  const loads = client.listSections.mock.calls.length;
  click(el, '[data-test="confirm-delete"]');
  await vi.waitFor(() => expect(modal(el, "delete").open).toBe(false));
  expect(client.deleteSection).toHaveBeenCalledWith("s-drinks");
  await vi.waitFor(() => expect(client.listSections.mock.calls.length).toBeGreaterThan(loads));
});

it("says an unused section is not used, and keeps the dialog open with the reason when deleting fails", async () => {
  const client = api({
    deleteSection: vi.fn().mockRejectedValue({ code: "menu_section.not_found" }),
  });
  const el = await mount(client);
  await inTable(el, "delete-s-specials");
  await vi.waitFor(() =>
    expect(inModal(el, "delete", '[data-test="delete-unused"]')).not.toBeNull(),
  );
  expect(inModal(el, "delete", '[data-test="delete-menus"]')).toBeNull();
  click(el, '[data-test="confirm-delete"]');
  await vi.waitFor(() =>
    expect(inModal(el, "delete", '[data-test="delete-error"]')!.textContent!.trim()).toBe(
      codeMessage("menu_section.not_found"),
    ),
  );
  expect(modal(el, "delete").open).toBe(true);
  click(el, '[data-test="delete-cancel"]');
  await el.updateComplete;
  expect(modal(el, "delete").open).toBe(false);
});

it("will not delete blind when where the section is used cannot be read", async () => {
  const client = api({ getSectionUsages: vi.fn().mockRejectedValue(new Error("down")) });
  const el = await mount(client);
  await inTable(el, "delete-s-drinks");
  await vi.waitFor(() =>
    expect(inModal(el, "delete", '[data-test="delete-usages-error"]')).not.toBeNull(),
  );
  const confirm = inModal<HTMLElementTagNameMap["wt-button"]>(
    el,
    "delete",
    '[data-test="confirm-delete"]',
  )!;
  expect(confirm.disabled).toBe(true);
  confirm.click();
  expect(client.deleteSection).not.toHaveBeenCalled();
  emit(modal(el, "delete"), "wt-close", {});
  await el.updateComplete;
  expect(modal(el, "delete").open).toBe(false);
});

it("holds the delete dialog open while the delete is in flight", async () => {
  const pending = deferred<void>();
  const client = api({ deleteSection: vi.fn().mockReturnValue(pending.promise) });
  const el = await mount(client);
  await inTable(el, "delete-s-specials");
  await vi.waitFor(() =>
    expect(inModal(el, "delete", '[data-test="delete-unused"]')).not.toBeNull(),
  );
  click(el, '[data-test="confirm-delete"]');
  click(el, '[data-test="confirm-delete"]');
  emit(modal(el, "delete"), "wt-close", {});
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  modal(el, "delete").dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(true);
  await el.updateComplete;
  expect(modal(el, "delete").open).toBe(true);
  expect(client.deleteSection).toHaveBeenCalledOnce();
  pending.resolve();
  await vi.waitFor(() => expect(modal(el, "delete").open).toBe(false));
});

it("offers Edit from each row's actions", async () => {
  const el = await mount();
  await inTable(el, "edit-s-beer");
  await vi.waitFor(() => expect(modal(el, "editor").open).toBe(true));
  expect(field(el, "internalName").value).toBe("Beer");
});
