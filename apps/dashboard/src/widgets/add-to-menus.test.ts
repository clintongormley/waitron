import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { page } from "vitest/browser";
import type { CatalogueSummary, MenuStructure } from "../api/client.js";
import { t } from "../i18n/t.js";
import { AddToMenus, placementMenus, type PlacementMenu } from "./add-to-menus.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "./test-helpers.js";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";

afterEach(cleanupWidgets);

const menus: CatalogueSummary[] = [
  { id: "m-lunch", name: "Lunch Menu", active: true, version: 1 },
  { id: "m-dinner", name: "Dinner Menu", active: true, version: 1 },
];

const beer = (memberId: string) => ({
  memberId,
  ref: { kind: "section" as const, sectionId: "s-beer" },
  internalName: "Beer",
  names: {},
  image: null,
  color: null,
  ownerMenuId: "menu-lunch",
  children: [
    { memberId: `${memberId}-lager`, ref: { kind: "product" as const, productId: "p-lager" } },
  ],
});
const drinks = (memberId: string) => ({
  memberId,
  ref: { kind: "section" as const, sectionId: "s-drinks" },
  internalName: "Drinks",
  names: {},
  image: null,
  color: null,
  ownerMenuId: "menu-lunch",
  children: [beer(`${memberId}-beer`)],
});

// Drinks sits on both menus, and twice on Lunch (at the top and inside Favourites).
const structures: MenuStructure[] = [
  {
    rootSectionId: "root-lunch",
    root: {
      id: "root-lunch",
      internalName: "Lunch Menu",
      names: {},
      image: null,
      color: null,
      members: [],
    },
    includable: [],
    includedBy: [{ id: "m-dinner", name: "Dinner Menu" }],
    nodes: [
      { memberId: "l1", ref: { kind: "product", productId: "p-bread" } },
      {
        memberId: "l2",
        ref: { kind: "section", sectionId: "s-starters" },
        internalName: "Starters",
        names: {},
        image: null,
        color: null,
        ownerMenuId: "menu-lunch",
        children: [],
      },
      drinks("l3"),
      {
        memberId: "l4",
        ref: { kind: "section", sectionId: "s-favourites" },
        internalName: "Favourites",
        names: {},
        image: null,
        color: null,
        ownerMenuId: "menu-lunch",
        children: [
          {
            memberId: "dessert",
            ref: { kind: "section", sectionId: "s-desserts" },
            internalName: "Desserts",
            names: { en: "Sweet dishes" },
            children: [],
          },
        ],
      },
    ],
  },
  {
    rootSectionId: "root-dinner",
    root: {
      id: "root-dinner",
      internalName: "Dinner Menu",
      names: {},
      image: null,
      color: null,
      members: [],
    },
    includable: [],
    includedBy: [],
    nodes: [
      {
        ...drinks("d1"),
        includedMenuId: "m-lunch",
        ref: { kind: "section", sectionId: "root-lunch" },
        internalName: "Lunch Menu",
      },
    ],
  },
];

const placements: PlacementMenu[] = placementMenus(menus, structures);

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

async function bottomOf(el: AddToMenus): Promise<string> {
  const actions = root(el).querySelector("wt-form-actions")!;
  return (await formMessageOf(actions))?.textContent?.trim() ?? "";
}

async function tick(el: AddToMenus, box: HTMLInputElement): Promise<void> {
  box.click();
  await el.updateComplete;
}

it("shows also-on menus beside the top-level destination too", async () => {
  const el = await mount();
  const box = boxes(el, "m-lunch", "root-lunch")[0]!;
  expect(box.closest("label")!.querySelector('[data-test="shared"]')?.textContent?.trim()).toBe(
    t("add_to_menus.shared").replace("{menus}", "Dinner Menu"),
  );
});

describe("placementMenus", () => {
  it("gives each menu its top level and its sections as a tree of internal names", () => {
    const [lunch, dinner] = placements;
    expect(lunch!.rootSectionId).toBe("root-lunch");
    expect(lunch!.sections.map(({ name }) => name)).toEqual(["Starters", "Drinks", "Favourites"]);
    expect(lunch!.sections[1]!.children.map(({ name }) => name)).toEqual(["Beer"]);
    expect(lunch!.sections[2]!.children[0]!.id).toBe("s-desserts");
    expect(dinner!.sections).toEqual([]);
  });

  it("names the other menus a section is also on, and none for a section on one menu", () => {
    const [lunch, dinner] = placements;
    expect(lunch!.sections[0]!.sharedWith).toEqual(["Dinner Menu"]);
    expect(lunch!.sections[1]!.sharedWith).toEqual(["Dinner Menu"]);
    expect(lunch!.sections[1]!.children[0]!.sharedWith).toEqual(["Dinner Menu"]);
    expect(lunch!.sections[2]!.sharedWith).toEqual(["Dinner Menu"]);
    expect(dinner!.sections).toEqual([]);
  });

  it("leaves out a menu with no structure, and marks a section the loaded list lacks", () => {
    const [lunch, ...rest] = placementMenus(menus, [
      {
        ...structures[0]!,
        nodes: [{ memberId: "missing", ref: { kind: "section", sectionId: "gone" }, children: [] }],
      },
    ]);
    expect(rest).toEqual([]);
    expect(lunch!.sections[0]!.name).toBe(t("members.missing"));
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
      "s-desserts",
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
    expect(row("m-lunch", "s-starters").textContent).toContain(shared);
    expect(boxes(el, "m-dinner").map((box) => box.value)).toEqual(["root-dinner"]);
  });

  it("offers a menu's owned sections once and omits included sections", async () => {
    const el = await mount();
    await tick(el, boxes(el, "m-lunch", "s-drinks")[0]!);
    expect(boxes(el, "m-lunch", "s-drinks").map((box) => box.checked)).toEqual([true]);
    expect(boxes(el, "m-lunch", "s-starters")[0]!.checked).toBe(false);
  });

  it("asks for each chosen place once, in the order they are shown", async () => {
    const el = await mount();
    const submit = vi.fn();
    el.addEventListener("wt-submit", submit);
    await tick(el, boxes(el, "m-dinner", "root-dinner")[0]!);
    await tick(el, boxes(el, "m-lunch", "s-beer")[0]!);
    await tick(el, boxes(el, "m-lunch", "s-drinks")[0]!);
    button(el, "add-to-menus")!.click();
    expect(submit).toHaveBeenCalledOnce();
    const event = submit.mock.calls[0]![0] as CustomEvent<{ sectionIds: string[] }>;
    expect(event.detail.sectionIds).toEqual(["s-drinks", "s-beer", "root-dinner"]);
    expect(event.bubbles && event.composed).toBe(true);
  });

  it("explains, beside the places and above Add, that nothing is chosen once a sent choice is unticked", async () => {
    const el = await mount();
    const submit = vi.fn();
    el.addEventListener("wt-submit", submit);
    await tick(el, boxes(el, "m-lunch", "s-starters")[0]!);
    button(el, "add-to-menus")!.click();
    await tick(el, boxes(el, "m-lunch", "s-starters")[0]!);
    button(el, "add-to-menus")!.click();
    await el.updateComplete;
    expect(submit).toHaveBeenCalledOnce();
    expect(button(el, "none-chosen")!.textContent!.trim()).toBe(t("add_to_menus.none_chosen"));
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(root(el).querySelector("wt-form-error-summary")).toBeNull();
  });

  it("says nothing about errors before the first press of Add, which is quiet again once a tick is undone", async () => {
    const el = await mount();
    await tick(el, boxes(el, "m-lunch", "s-starters")[0]!);
    await tick(el, boxes(el, "m-lunch", "s-starters")[0]!);
    expect(button(el, "none-chosen")).toBeNull();
    expect(await bottomOf(el)).toBe("");
    expect(button(el, "add-to-menus")!.hasAttribute("disabled")).toBe(true);
    expect(button(el, "add-to-menus")!.getAttribute("variant")).toBe("secondary");
    await tick(el, boxes(el, "m-lunch", "s-starters")[0]!);
    expect(button(el, "add-to-menus")!.hasAttribute("disabled")).toBe(false);
  });

  it("once a sent choice is unticked, marks every place and disables Add", async () => {
    const el = await mount();
    await tick(el, boxes(el, "m-lunch", "s-starters")[0]!);
    button(el, "add-to-menus")!.click();
    await tick(el, boxes(el, "m-lunch", "s-starters")[0]!);
    const first = boxes(el, "m-lunch")[0]!;
    expect(first.getAttribute("aria-invalid")).toBe("true");
    expect(boxes(el, "m-dinner")[0]!.getAttribute("aria-invalid")).toBe("true");
    expect(button(el, "add-to-menus")!.hasAttribute("disabled")).toBe(true);
  });

  it("asks for nothing when every ticked place is one it no longer lists", async () => {
    const el = await mount();
    const submit = vi.fn();
    el.addEventListener("wt-submit", submit);
    el.failures = [{ sectionId: "s-gone", reason: "Try again." }];
    await el.updateComplete;
    expect(button(el, "add-to-menus")!.hasAttribute("disabled")).toBe(false);
    button(el, "add-to-menus")!.click();
    await el.updateComplete;
    expect(submit).not.toHaveBeenCalled();
  });

  it("re-checks every choice after a press, and Add works again once one is chosen", async () => {
    const el = await mount();
    await tick(el, boxes(el, "m-lunch", "s-drinks")[0]!);
    button(el, "add-to-menus")!.click();
    await tick(el, boxes(el, "m-lunch", "s-drinks")[0]!);
    expect(button(el, "none-chosen")).not.toBeNull();

    await tick(el, boxes(el, "m-lunch", "s-starters")[0]!);
    expect(button(el, "none-chosen")).toBeNull();
    expect(await bottomOf(el)).toBe("");
    expect(button(el, "add-to-menus")!.hasAttribute("disabled")).toBe(false);

    await tick(el, boxes(el, "m-lunch", "s-starters")[0]!);
    expect(button(el, "none-chosen")!.textContent!.trim()).toBe(t("add_to_menus.none_chosen"));
    expect(button(el, "add-to-menus")!.hasAttribute("disabled")).toBe(true);
  });

  it("leaves Add working when places refused the product, since nothing chosen is wrong", async () => {
    const el = await mount();
    await tick(el, boxes(el, "m-lunch", "s-drinks")[0]!);
    el.failures = [{ sectionId: "s-drinks", reason: "Try again." }];
    await el.updateComplete;
    expect(button(el, "add-to-menus")!.hasAttribute("disabled")).toBe(false);
  });

  it("starts again when reopened: no message, Add quiet, and working after a tick", async () => {
    const el = await mount();
    await tick(el, boxes(el, "m-lunch", "s-starters")[0]!);
    button(el, "add-to-menus")!.click();
    await tick(el, boxes(el, "m-lunch", "s-starters")[0]!);
    expect(button(el, "none-chosen")).not.toBeNull();
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await el.updateComplete;
    expect(button(el, "none-chosen")).toBeNull();
    expect(await bottomOf(el)).toBe("");
    expect(button(el, "add-to-menus")!.hasAttribute("disabled")).toBe(true);
    await tick(el, boxes(el, "m-lunch", "s-starters")[0]!);
    expect(button(el, "none-chosen")).toBeNull();
    expect(await bottomOf(el)).toBe("");
    expect(button(el, "add-to-menus")!.hasAttribute("disabled")).toBe(false);
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

  it("names a refused place it no longer lists as no longer available", async () => {
    const el = await mount();
    el.failures = [{ sectionId: "s-gone", reason: "Try again." }];
    await el.updateComplete;
    expect(button(el, "placement-error")!.textContent).toContain(
      `${t("members.missing")}: Try again.`,
    );
  });

  it("marks adding as the main action once a place is ticked, and skipping as the other", async () => {
    const el = await mount();
    await tick(el, boxes(el, "m-lunch", "s-starters")[0]!);
    expect(button(el, "add-to-menus")!.getAttribute("variant")).toBe("primary");
    expect(button(el, "skip")!.getAttribute("variant")).toBe("secondary");
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

  it("explains menu sharing only when a menu is included elsewhere", async () => {
    const shared = await mount();
    expect(root(shared).textContent).toContain(t("add_to_menus.shared_note"));
    const alone = await mount({
      menus: placementMenus(menus.slice(0, 1), [{ ...structures[0]!, includedBy: [] }]),
    });
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

describe("dashboard-add-to-menus on a phone", () => {
  const twelve: PlacementMenu[] = Array.from({ length: 12 }, (_, menu) => ({
    id: `m-${menu}`,
    name: `Menu ${menu}`,
    rootSectionId: `root-${menu}`,
    sections: Array.from({ length: 10 }, (_, section) => ({
      id: `s-${menu}-${section}`,
      name: `Section ${menu}.${section}`,
      sharedWith: [],
      children: [],
    })),
  }));

  it("keeps Add to menus and Skip inside the window at 390×700 with 12 menus of 10 sections, and still when scrolled to the end", async () => {
    const before = [window.innerWidth, window.innerHeight] as const;
    await page.viewport(390, 700);
    onTestFinished(() => page.viewport(...before));
    const el = await mount({ menus: twelve });
    const body = root(el)
      .querySelector("wt-modal")!
      .shadowRoot!.querySelector<HTMLElement>(".body")!;
    const buttons = { "Add to menus": button(el, "add-to-menus")!, Skip: button(el, "skip")! };
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);

    const placed = () =>
      Object.entries(buttons).map(([label, target]) => {
        const box = target.getBoundingClientRect();
        expect(box.height, `${label} is drawn`).toBeGreaterThan(0);
        expect(box.top, `${label}: top in the window`).toBeGreaterThanOrEqual(0);
        expect(box.bottom, `${label}: bottom in the window`).toBeLessThanOrEqual(700);
        expect(box.left, `${label}: left in the window`).toBeGreaterThanOrEqual(0);
        expect(box.right, `${label}: right in the window`).toBeLessThanOrEqual(390);
        return [box.top, box.left];
      });
    const unscrolled = placed();
    body.scrollTop = body.scrollHeight;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(body.scrollTop).toBeGreaterThan(0);
    expect(placed()).toEqual(unscrolled);
  });
});
