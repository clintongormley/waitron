import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogueSummary, LibrarySection, MenuStructure } from "../api/client.js";
import { t } from "../i18n/t.js";
import { AddToMenus, placementMenus, type PlacementMenu } from "./add-to-menus.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "./test-helpers.js";

afterEach(cleanupWidgets);

const menus: CatalogueSummary[] = [
  { id: "m-lunch", name: "Lunch Menu", active: true, version: 1 },
  { id: "m-dinner", name: "Dinner Menu", active: true, version: 1 },
];

const beer = (memberId: string) => ({
  memberId,
  ref: { kind: "section" as const, sectionId: "s-beer" },
  children: [
    { memberId: `${memberId}-lager`, ref: { kind: "product" as const, productId: "p-lager" } },
  ],
});
const drinks = (memberId: string) => ({
  memberId,
  ref: { kind: "section" as const, sectionId: "s-drinks" },
  children: [beer(`${memberId}-beer`)],
});

// Drinks sits on both menus, and twice on Lunch (at the top and inside Favourites).
const structures: MenuStructure[] = [
  {
    rootSectionId: "root-lunch",
    nodes: [
      { memberId: "l1", ref: { kind: "product", productId: "p-bread" } },
      { memberId: "l2", ref: { kind: "section", sectionId: "s-starters" }, children: [] },
      drinks("l3"),
      {
        memberId: "l4",
        ref: { kind: "section", sectionId: "s-favourites" },
        children: [drinks("l5")],
      },
    ],
  },
  { rootSectionId: "root-dinner", nodes: [drinks("d1")] },
];

// Each section's customer-facing name differs from its internal one, so a list that read the
// wrong one would show text the assertions below refuse.
const section = (id: string, internalName: string, customer: string): LibrarySection => ({
  id,
  internalName,
  names: { en: customer, es: customer },
  image: null,
  color: null,
  members: [],
});
const sections: LibrarySection[] = [
  section("s-starters", "Starters", "Small plates to begin"),
  section("s-drinks", "Drinks", "Cold drinks"),
  section("s-beer", "Beer", "Beers on tap"),
  section("s-favourites", "Favourites", "House favourites"),
];

const placements: PlacementMenu[] = placementMenus(menus, structures, sections);

async function mount(props: Partial<AddToMenus> = {}): Promise<AddToMenus> {
  const { el } = await mountWidget<AddToMenus>("dashboard-add-to-menus", {
    open: true,
    productName: "Croquetas",
    menus: placements,
    ...props,
  });
  return el;
}

const root = (el: AddToMenus) => el.shadowRoot!;
const menuSet = (el: AddToMenus, menuId: string) =>
  root(el).querySelector<HTMLFieldSetElement>(`fieldset[data-menu="${menuId}"]`)!;
const boxes = (el: AddToMenus, menuId: string, value?: string) => [
  ...menuSet(el, menuId).querySelectorAll<HTMLInputElement>(
    value ? `input[value="${value}"]` : "input[type=checkbox]",
  ),
];
const button = (el: AddToMenus, test: string) =>
  root(el).querySelector<HTMLElement>(`[data-test="${test}"]`);

async function tick(el: AddToMenus, box: HTMLInputElement): Promise<void> {
  box.click();
  await el.updateComplete;
}

describe("placementMenus", () => {
  it("gives each menu its top level and its sections as a tree of internal names", () => {
    const [lunch, dinner] = placements;
    expect(lunch!.rootSectionId).toBe("root-lunch");
    expect(lunch!.sections.map(({ name }) => name)).toEqual(["Starters", "Drinks", "Favourites"]);
    expect(lunch!.sections[1]!.children.map(({ name }) => name)).toEqual(["Beer"]);
    expect(lunch!.sections[2]!.children[0]!.children[0]!.id).toBe("s-beer");
    expect(dinner!.sections.map(({ id }) => id)).toEqual(["s-drinks"]);
  });

  it("names the other menus a section is also on, and none for a section on one menu", () => {
    const [lunch, dinner] = placements;
    expect(lunch!.sections[0]!.sharedWith).toEqual([]);
    expect(lunch!.sections[1]!.sharedWith).toEqual(["Dinner Menu"]);
    expect(lunch!.sections[1]!.children[0]!.sharedWith).toEqual(["Dinner Menu"]);
    expect(lunch!.sections[2]!.sharedWith).toEqual([]);
    expect(dinner!.sections[0]!.sharedWith).toEqual(["Lunch Menu"]);
  });

  it("leaves out a menu with no structure, and marks a section the library list lacks", () => {
    const [lunch, ...rest] = placementMenus(menus, structures.slice(0, 1), sections.slice(1));
    expect(rest).toEqual([]);
    expect(lunch!.sections[0]!.name).toBe(t("editor.missing_choice"));
  });
});

describe("dashboard-add-to-menus", () => {
  it("lists every menu with its top level and each section by its internal name", async () => {
    const el = await mount();
    expect(root(el).querySelector("wt-modal")!.getAttribute("heading")).toBe(
      t("add_to_menus.heading").replace("{name}", "Croquetas"),
    );
    const legends = [...root(el).querySelectorAll("fieldset[data-menu] > legend")].map((legend) =>
      legend.textContent!.trim(),
    );
    expect(legends).toEqual(["Lunch Menu", "Dinner Menu"]);
    expect(boxes(el, "m-lunch").map((box) => box.value)).toEqual([
      "root-lunch",
      "s-starters",
      "s-drinks",
      "s-beer",
      "s-favourites",
      "s-drinks",
      "s-beer",
    ]);
    expect(boxes(el, "m-lunch").every((box) => box.name === "section")).toBe(true);
    const lunchText = menuSet(el, "m-lunch").textContent!;
    expect(lunchText).toContain(t("add_to_menus.top_level"));
    expect(lunchText).toContain("Starters");
    for (const customer of ["Small plates", "Cold drinks", "Beers on tap", "House favourites"])
      expect(root(el).textContent).not.toContain(customer);
  });

  it("says beside a section other menus use that it is shared, and which menus", async () => {
    const el = await mount();
    const row = (menuId: string, value: string) =>
      boxes(el, menuId, value)[0]!.closest("label")!.parentElement!;
    const shared = t("add_to_menus.shared").replace("{menus}", "Dinner Menu");
    expect(
      row("m-lunch", "s-drinks").querySelector("[data-test=shared]")!.textContent!.trim(),
    ).toBe(shared);
    expect(row("m-lunch", "s-starters").querySelector("[data-test=shared]")).toBeNull();
    expect(row("m-dinner", "s-drinks").textContent).toContain("Lunch Menu");
  });

  it("chooses a shared section wherever it appears, because it is one list", async () => {
    const el = await mount();
    await tick(el, boxes(el, "m-dinner", "s-drinks")[0]!);
    expect(boxes(el, "m-lunch", "s-drinks").map((box) => box.checked)).toEqual([true, true]);
    expect(boxes(el, "m-lunch", "s-starters")[0]!.checked).toBe(false);
  });

  it("asks for each chosen place once, in the order they are shown", async () => {
    const el = await mount();
    const submit = vi.fn();
    el.addEventListener("wt-submit", submit);
    await tick(el, boxes(el, "m-dinner", "root-dinner")[0]!);
    await tick(el, boxes(el, "m-dinner", "s-beer")[0]!);
    await tick(el, boxes(el, "m-lunch", "s-drinks")[1]!);
    button(el, "add-to-menus")!.click();
    expect(submit).toHaveBeenCalledOnce();
    const event = submit.mock.calls[0]![0] as CustomEvent<{ sectionIds: string[] }>;
    expect(event.detail.sectionIds).toEqual(["s-drinks", "s-beer", "root-dinner"]);
    expect(event.bubbles && event.composed).toBe(true);
  });

  it("explains, beside the places and in a summary, that nothing was chosen", async () => {
    const el = await mount();
    const submit = vi.fn();
    el.addEventListener("wt-submit", submit);
    button(el, "add-to-menus")!.click();
    await el.updateComplete;
    expect(submit).not.toHaveBeenCalled();
    expect(button(el, "none-chosen")!.textContent!.trim()).toBe(t("add_to_menus.none_chosen"));
    const summary = root(el).querySelector("wt-form-error-summary")!;
    expect(summary.errors).toEqual([t("add_to_menus.none_chosen")]);
  });

  it("skips with a cancel and asks for nothing", async () => {
    const el = await mount();
    const submit = vi.fn();
    const cancel = vi.fn();
    el.addEventListener("wt-submit", submit);
    el.addEventListener("wt-cancel", cancel);
    await tick(el, boxes(el, "m-lunch", "s-starters")[0]!);
    button(el, "skip")!.click();
    expect(cancel).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    expect(button(el, "skip")!.textContent!.trim()).toBe(t("add_to_menus.skip"));
  });

  it("says the product is saved when a place refused it, and keeps only the refused places chosen", async () => {
    const el = await mount();
    await tick(el, boxes(el, "m-lunch", "s-starters")[0]!);
    await tick(el, boxes(el, "m-lunch", "s-drinks")[0]!);
    await tick(el, boxes(el, "m-dinner", "root-dinner")[0]!);
    el.failures = [
      { sectionId: "s-drinks", reason: "The server could not do that." },
      { sectionId: "root-dinner", reason: "Try again." },
    ];
    await el.updateComplete;
    const alert = button(el, "placement-error")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain(t("add_to_menus.failed").replace("{name}", "Croquetas"));
    expect(alert.textContent).toContain("Drinks");
    expect(alert.textContent).toContain("The server could not do that.");
    expect(alert.textContent).toContain(
      t("add_to_menus.place_top_level").replace("{menu}", "Dinner Menu"),
    );
    expect(boxes(el, "m-lunch", "s-starters")[0]!.checked).toBe(false);
    expect(boxes(el, "m-lunch", "s-drinks")[0]!.checked).toBe(true);
    expect(boxes(el, "m-dinner", "root-dinner")[0]!.checked).toBe(true);
    expect(button(el, "skip")!.textContent!.trim()).toBe(t("action.close"));
  });

  it("shows loading, then a load failure that still says the product is saved", async () => {
    const el = await mount({ menus: null });
    expect(button(el, "loading")!.textContent!.trim()).toBe(t("add_to_menus.loading"));
    expect(button(el, "add-to-menus")).toBeNull();
    el.loadError = "The server could not do that.";
    await el.updateComplete;
    const alert = button(el, "load-error")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain(
      t("add_to_menus.load_error").replace("{name}", "Croquetas"),
    );
    expect(alert.textContent).toContain("The server could not do that.");
    expect(button(el, "add-to-menus")).toBeNull();
    expect(button(el, "skip")!.textContent!.trim()).toBe(t("action.close"));
  });

  it("starts with nothing chosen each time it opens", async () => {
    const el = await mount();
    await tick(el, boxes(el, "m-lunch", "s-starters")[0]!);
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await el.updateComplete;
    expect(boxes(el, "m-lunch", "s-starters")[0]!.checked).toBe(false);
  });

  it("explains shared sections only when a menu has one", async () => {
    const shared = await mount();
    expect(root(shared).textContent).toContain(t("add_to_menus.shared_note"));
    const alone = await mount({ menus: placementMenus(menus.slice(0, 1), structures, sections) });
    expect(root(alone).textContent).not.toContain(t("add_to_menus.shared_note"));
  });

  it("treats dismissing the window as a skip", async () => {
    const el = await mount();
    const cancel = vi.fn();
    el.addEventListener("wt-cancel", cancel);
    const modal = root(el).querySelector("wt-modal")!;
    modal.open = false;
    await modal.updateComplete;
    await closeReportsDelivered();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("holds every place still while the requests run", async () => {
    const el = await mount({ busy: true });
    expect(boxes(el, "m-lunch").every((box) => box.disabled)).toBe(true);
    const submit = vi.fn();
    el.addEventListener("wt-submit", submit);
    button(el, "add-to-menus")!.click();
    expect(submit).not.toHaveBeenCalled();
    const cancel = vi.fn();
    el.addEventListener("wt-cancel", cancel);
    button(el, "skip")!.click();
    expect(cancel).not.toHaveBeenCalled();
    const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    root(el).querySelector("wt-modal")!.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
  });
});
