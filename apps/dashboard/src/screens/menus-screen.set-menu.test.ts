import {
  currentContentLanguages,
  NavigationGuard,
  setContentLanguages,
  setHelpMode,
  type NavigationLeave,
} from "@waitron/ui";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type {
  DashboardApi,
  MenuPreview,
  MenuStructure,
  MenuSummary,
  SetMenuDetails,
} from "../api/client.js";
import { useLocale } from "../testing/locale-setup.js";
import {
  cleanupWidgets,
  expectNoA11yViolations,
  menuDocument,
  mountWidget,
} from "../widgets/test-helpers.js";
import { MenusScreen } from "./menus-screen.js";

useLocale("en-GB");
afterEach(cleanupWidgets);

const dailyPath = "/menus/menu/daily/view/set-menu";
const lunchPath = "/menus/menu/lunch/view/preview";
const menu: MenuSummary = {
  id: "lunch",
  name: "Lunch",
  active: true,
  kind: "menu",
  setPrice: null,
  setVatClass: null,
};
const daily: MenuSummary = {
  id: "daily",
  name: "Daily menu",
  active: true,
  kind: "set_menu",
  setPrice: "14.00",
  setVatClass: "reduced",
};
const details: SetMenuDetails = {
  id: "daily",
  name: "Daily menu",
  names: { en: "Today's menu", es: "Daily lunch for guests" },
  price: "14.00",
  vatClass: "reduced",
  takeawayVatClass: null,
  dishes: [],
  lines: [],
  courses: [],
  problems: [{ kind: "no_dishes" }, { kind: "no_lines" }],
  heldBy: [menu],
};
const status = { state: "unpublished", clashes: 0 } as const;
const preview: MenuPreview = {
  setMenuProblems: [{ menuId: daily.id, name: daily.name, problems: details.problems }],
  live: null,
  clashes: [],
  hash: "a".repeat(64),
  changes: [],
  warnings: [],
  status,
  document: { ...menuDocument([], {}), menuId: menu.id },
};

function api() {
  return {
    listMenus: vi.fn().mockResolvedValue([menu, daily]),
    listLibraryProducts: vi.fn().mockResolvedValue([]),
    listCategories: vi.fn().mockResolvedValue([]),
    getMenuSettings: vi.fn().mockResolvedValue({
      defaultProductVatClass: "reduced",
      defaultColor: null,
      takeawayVat: true,
    }),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "en", languages: ["en", "es"] }),
    getMenuStatuses: vi.fn().mockResolvedValue({ lunch: status }),
    createMenu: vi.fn().mockResolvedValue(daily),
    addSectionMember: vi.fn().mockResolvedValue({ id: "placed" }),
    removeSectionMember: vi.fn().mockResolvedValue(undefined),
    moveSectionMembersInto: vi.fn().mockResolvedValue(undefined),
    getMenuStructure: vi.fn<DashboardApi["getMenuStructure"]>().mockResolvedValue({
      rootSectionId: "root",
      root: { id: "root", internalName: "Lunch", names: {}, image: null, color: null, members: [] },
      includable: [],
      includedBy: [],
      placeableSetMenus: [{ id: daily.id, name: daily.name }],
      nodes: [],
    }),
    async getMenuRead(menuId: string) {
      return {
        structure: { status: 200, body: await this.getMenuStructure(menuId) },
        status: { status: 200, body: status },
      };
    },
    getMenuStatus: vi.fn().mockResolvedValue(status),
    getMenuPrices: vi.fn().mockResolvedValue([]),
    getMenuPreview: vi.fn().mockResolvedValue(preview),
    getMenuPublications: vi
      .fn()
      .mockResolvedValue({ timeZone: "Europe/Madrid", live: null, editions: [] }),
    readSetMenu: vi.fn().mockResolvedValue(details),
    updateMenuDetails: vi.fn().mockResolvedValue(undefined),
    saveSetMenuLines: vi.fn(),
  };
}

async function mount(path = "/menus", client = api(), theme?: "light" | "dark") {
  history.replaceState(null, "", path);
  return (
    await mountWidget<MenusScreen>(
      "dashboard-menus-screen",
      {
        api: client as unknown as DashboardApi,
      },
      theme,
    )
  ).el;
}

it("shows the set menu kind and price without a publication status in the list", async () => {
  const el = await mount();
  const root = el.shadowRoot!;
  await vi.waitFor(() => {
    const table = root.querySelector("wt-data-table");
    const row = table?.shadowRoot?.querySelector('[data-test="open-daily"]')?.closest("tr");
    expect(row?.textContent).toContain("Set menu");
    expect(row?.textContent).toContain("€14.00");
    expect(row?.querySelector('[data-test="status-daily"]')).toBeNull();
  });
});

it("replaces an old Prices address with the set menu's only tab", async () => {
  const client = api();
  const route = vi.spyOn(history, "replaceState");
  try {
    const el = await mount("/menus/menu/daily/view/prices", client);
    await vi.waitFor(() => {
      expect(el.shadowRoot!.querySelector("wt-tabs")?.items.map(({ key }) => key)).toEqual([
        "set-menu",
      ]);
      expect(
        route.mock.calls.map(([, , address]) => new URL(address!, location.origin).pathname),
      ).toContain(dailyPath);
    });
    await expect
      .element(page.getByText("Price per set menu", { exact: false }).first())
      .toBeVisible();
    expect(page.getByRole("button", { name: "Publish", exact: true }).elements()).toHaveLength(0);
  } finally {
    route.mockRestore();
  }
});

it("links to the full menu that publishes the set menu", async () => {
  const client = api();
  await mount(dailyPath, client);
  const link = page.getByRole("link", { name: "Lunch", exact: true });
  await vi.waitFor(() => expect(link.element().getAttribute("href")).toBe(lunchPath));
  expect(client.getMenuStructure).not.toHaveBeenCalled();
});

it("links a publication problem to the set-menu editor", async () => {
  await mount(lunchPath);
  await vi.waitFor(() =>
    expect(
      page.getByRole("link", { name: "Daily menu has 2 problems" }).element().getAttribute("href"),
    ).toBe(dailyPath),
  );
});

it("links a changed set menu to its editor from the full menu's Preview", async () => {
  const client = api();
  client.getMenuPreview.mockResolvedValue({
    ...preview,
    setMenuProblems: [],
    changes: [
      {
        id: "changed",
        kind: "set_menu_changed",
        setMenu: { id: daily.id, name: daily.name },
        fields: ["price"],
        source: "set_menu",
        targets: { before: [], after: [] },
      },
    ],
  } satisfies MenuPreview);
  await mount(lunchPath, client);
  await vi.waitFor(() => {
    expect(
      page
        .getByRole("link", { name: "Edit Daily menu", exact: true })
        .element()
        .getAttribute("href"),
    ).toBe(dailyPath);
  });
});

const starterLine = { id: "first", count: 1, courseIds: ["starters"] };
const courses = [
  { id: "starters", name: "Starters" },
  { id: "desserts", name: "Desserts" },
];
const dessertProblem = {
  kind: "dish_not_included",
  productId: "bottle",
  parentName: "Wine",
  name: "Bottle",
  courseId: "desserts",
  courseName: "Desserts",
} as const;
const draftWithLines: SetMenuDetails = {
  ...details,
  lines: [starterLine],
  courses,
  problems: [dessertProblem],
  dishes: [
    {
      menuItemId: "wine-item",
      name: "Wine",
      productId: "wine",
      surcharge: null,
      courseId: "desserts",
      productCourseId: "desserts",
      courseOverrideId: null,
      soldByMeasure: false,
      variants: [
        { id: "bottle", name: "Bottle", included: true, surcharge: null, courseId: "desserts" },
      ],
    },
  ],
};
function lineForm(el: MenusScreen) {
  return el
    .shadowRoot!.querySelector("dashboard-set-menu-editor")
    ?.shadowRoot?.querySelector("dashboard-set-menu-lines-form")?.shadowRoot;
}
async function mountLines(client = api()) {
  client.readSetMenu.mockResolvedValue(draftWithLines);
  const el = await mount(dailyPath, client);
  await vi.waitFor(() => expect(lineForm(el)).toBeDefined());
  return { el, root: lineForm(el)!, client };
}

it("shows how to cover a variant's missing course and links to its product", async () => {
  const client = api();
  client.readSetMenu.mockResolvedValue(draftWithLines);
  await mount(dailyPath, client);
  await vi.waitFor(() => {
    expect(
      page
        .getByText(
          "Bottle (Wine) counts as Desserts, which no line includes. Add Desserts to a line, or leave Bottle out.",
        )
        .element(),
    ).toBeDefined();
    expect(page.getByRole("link", { name: "Edit Wine" }).element().getAttribute("href")).toBe(
      "/products/product/wine",
    );
  });
});

it("adds a second course to a line, saves both and clears the resolved problem", async () => {
  const { root, client } = await mountLines();
  const price = page.getByRole("textbox", { name: "Price per set menu" });
  await price.fill("15.00");
  const saved = [{ id: "saved", count: 1, courseIds: ["starters", "desserts"] }];
  client.saveSetMenuLines.mockResolvedValue({ lines: saved });
  client.readSetMenu.mockResolvedValue({ ...draftWithLines, lines: saved, problems: [] });
  const add = root.querySelector('wt-combobox[name="course"]')!;
  expect(add).toBeDefined();
  add.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "desserts" }, bubbles: true, composed: true }),
  );
  await expect.element(page.getByText("or", { exact: true })).toBeVisible();
  const save = root.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="save"]')!;
  save.click();
  await vi.waitFor(() => {
    expect(client.saveSetMenuLines).toHaveBeenCalledExactlyOnceWith("daily", [
      { count: 1, courseIds: ["starters", "desserts"] },
    ]);
    expect(page.getByRole("link", { name: "Edit Wine" }).elements()).toHaveLength(0);
    expect(save.disabled).toBe(true);
  });
  await expect.element(price).toHaveValue("15.00");
});

it("marks a number outside 1–99 and blocks it from saving", async () => {
  const { root, client } = await mountLines();
  const count = root.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="count"]')!;
  await userEvent.fill(page.elementLocator(count.shadowRoot!.querySelector("input")!), "100");
  const save = root.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="save"]')!;
  save.click();
  await vi.waitFor(() => {
    expect(count.error).toContain("1 to 99");
    expect(save.disabled).toBe(true);
  });
  expect(client.saveSetMenuLines).not.toHaveBeenCalled();
});

it.each([
  ["no_dishes", { kind: "no_dishes" }, "Add a dish to this set menu."],
  ["no_lines", { kind: "no_lines" }, "Add a line to say what one set menu includes."],
  [
    "line_without_course",
    { kind: "line_without_course", lineId: "first" },
    "Saved line 1 needs a course.",
  ],
  [
    "line_unfillable",
    { kind: "line_unfillable", lineId: "first" },
    "No dish counts towards saved line 1.",
  ],
  [
    "dish_without_course",
    { kind: "dish_without_course", productId: "wine", name: "Wine", parentName: null },
    "Wine has no course.",
  ],
  [
    "dish_sold_by_measure",
    { kind: "dish_sold_by_measure", productId: "wine", name: "Wine" },
    "Wine is now sold by weight or measure.",
  ],
] as const)("gives staff a next step for %s", async (_kind, problem, wording) => {
  const client = api();
  client.readSetMenu.mockResolvedValue({ ...draftWithLines, problems: [problem] });
  const el = await mount(dailyPath, client);
  await vi.waitFor(() => {
    expect(
      el.shadowRoot!.querySelector("dashboard-set-menu-editor")?.shadowRoot?.textContent,
    ).toContain(wording);
  });
});

it.each(["light", "dark"] as const)(
  "shows the editor and its inclusion line accessibly in %s",
  async (theme) => {
    const client = api();
    client.readSetMenu.mockResolvedValue(draftWithLines);
    const el = await mount(dailyPath, client, theme);
    await vi.waitFor(() =>
      expect(lineForm(el)?.querySelector('wt-input[name="count"]')).toBeTruthy(),
    );
    await expectNoA11yViolations(el.parentElement!);
  },
);

it("starts an ordinary menu's structure read while the menus list is still loading", async () => {
  const client = api();
  let finishList!: (menus: MenuSummary[]) => void;
  client.listMenus.mockReturnValue(
    new Promise<MenuSummary[]>((resolve) => {
      finishList = resolve;
    }),
  );
  try {
    const screen = await mount("/menus/menu/lunch/view/structure", client);
    expect(screen.shadowRoot?.querySelector("wt-tabs")?.value).toBe("structure");
    await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledWith("lunch"));
  } finally {
    finishList([menu, daily]);
  }
});

it("adds fields for a content language that becomes available while a draft is open", async () => {
  const previous = currentContentLanguages();
  onTestFinished(() => setContentLanguages(previous));
  const client = api();
  client.getContentLanguages.mockResolvedValue({ defaultLanguage: "en", languages: ["en"] });
  const screen = await mount(dailyPath, client);
  const fields = () =>
    screen
      .shadowRoot!.querySelector("dashboard-set-menu-editor")
      ?.shadowRoot?.querySelector("dashboard-set-menu-terms-form")?.shadowRoot;
  await vi.waitFor(() => {
    expect(fields()?.querySelector('[name="names-en"]')).toBeTruthy();
    expect(fields()?.querySelector('[name="names-es"]')).toBeNull();
  });
  const price = page.getByRole("textbox", { name: "Price per set menu" });
  await price.fill("15.00");
  setContentLanguages({ defaultLanguage: "en", languages: ["en", "es"] });
  await vi.waitFor(() => expect(fields()?.querySelector('[name="names-es"]')).toBeTruthy());
  await expect.element(price).toHaveValue("15.00");
});

it("shows a read failure after saving lines without showing the previous problems as current", async () => {
  const { root, client } = await mountLines();
  const count = root.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="count"]')!;
  await userEvent.fill(page.elementLocator(count.shadowRoot!.querySelector("input")!), "2");
  client.saveSetMenuLines.mockResolvedValue({ lines: [{ ...starterLine, count: 2 }] });
  client.readSetMenu.mockRejectedValue(new Error("Connection lost"));
  root.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="save"]')!.click();
  const failure = page.getByRole("alert").filter({ hasText: "The set menu could not be loaded." });
  await expect.element(failure).toBeVisible();
  expect(page.getByRole("link", { name: "Edit Wine" }).elements()).toHaveLength(0);
  expect(count.value).toBe("2");

  let answer!: (value: SetMenuDetails) => void;
  client.readSetMenu.mockReturnValue(
    new Promise<SetMenuDetails>((resolve) => {
      answer = resolve;
    }),
  );
  const retry = page.getByRole("button", { name: "Try again" });
  try {
    await retry.click();
    await vi.waitFor(() => expect(retry.element().getAttribute("aria-busy")).toBe("true"));
    expect(page.getByRole("link", { name: "Edit Wine" }).elements()).toHaveLength(0);
  } finally {
    answer({ ...draftWithLines, lines: [{ ...starterLine, count: 2 }], problems: [] });
  }
  await expect.element(failure).not.toBeInTheDocument();
});

it("recovers the ordinary Prices tab after the menus list is retried", async () => {
  const client = api();
  client.listMenus.mockRejectedValueOnce(new Error("Connection lost"));
  const screen = await mount("/menus/menu/lunch/view/prices", client);
  const retry = () => screen.shadowRoot!.querySelector<HTMLElement>('[data-test="retry"]');
  await vi.waitFor(() => expect(retry()).toBeTruthy());
  retry()!.click();
  await vi.waitFor(() => {
    expect(retry()).toBeNull();
    expect(screen.shadowRoot!.querySelector("wt-tabs")?.value).toBe("prices");
    expect(screen.shadowRoot!.querySelector("dashboard-menu-prices-table")?.loading).toBe(false);
    expect(client.listMenus).toHaveBeenCalledTimes(2);
  });
});

it("keeps the unsaved price when Back is refused and returns to the list when allowed", async () => {
  const screen = await mount(dailyPath);
  const price = page.getByRole("textbox", { name: "Price per set menu" });
  await price.fill("15.00");
  const request = vi
    .fn<NavigationLeave["request"]>(async (proceed) => {
      await proceed();
      return "proceeded";
    })
    .mockResolvedValueOnce("kept");
  const guard = new NavigationGuard(window, { isDirty: () => true, request });
  onTestFinished(() => guard.dispose());
  const back = page.elementLocator(screen.shadowRoot!.querySelector('[data-test="back"]')!);
  await userEvent.click(back);
  expect(request).toHaveBeenCalledOnce();
  expect(new URL(guard.href).pathname).toBe(dailyPath);
  await expect.element(price).toHaveValue("15.00");
  await userEvent.click(back);
  await vi.waitFor(() => {
    expect(new URL(guard.href).pathname).toBe("/menus");
    expect(screen.shadowRoot!.querySelector("dashboard-set-menu-editor")).toBeNull();
  });
});

it("offers Menu and Set menu when adding a menu", async () => {
  await mount();
  await page.getByRole("button", { name: "Add menu", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Menu", exact: true })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Set menu", exact: true })).toBeVisible();
});

it("dismisses the menu kind choice with Cancel and returns to Add menu", async () => {
  await mount();
  const add = page.getByRole("button", { name: "Add menu", exact: true });
  await add.click();
  const cancel = page.getByRole("button", { name: "Cancel", exact: true });
  await vi.waitFor(() => expect(cancel.elements()).toHaveLength(1));
  await cancel.click();
  await vi.waitFor(() => expect(add.element().matches(":focus")).toBe(true));
  expect(page.getByRole("button", { name: "Set menu", exact: true }).elements()).toHaveLength(0);
});

async function fillNewSetMenu(name: string) {
  await page.getByRole("button", { name: "Add menu", exact: true }).click();
  await page.getByRole("button", { name: "Set menu", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: false }).first().fill(name);
  await page.getByRole("textbox", { name: "Price per set menu", exact: false }).fill("14.00");
  return page;
}

it("opens the new set menu's editor after saving its terms", async () => {
  const client = api();
  client.listMenus.mockResolvedValueOnce([menu]);
  client.readSetMenu.mockResolvedValue({ ...details, heldBy: [] });
  await mount("/menus", client);
  const form = await fillNewSetMenu("Daily menu");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect.element(page.getByRole("tab", { name: "Set menu", exact: true })).toBeVisible();
  expect(location.pathname).toBe(dailyPath);
  expect(client.createMenu).toHaveBeenCalledExactlyOnceWith("Daily menu", {
    kind: "set_menu",
    names: {},
    setPrice: "14.00",
    setVatClass: "reduced",
    setTakeawayVatClass: null,
  });
});

it("keeps the creation form editable and names a duplicate beside the name field", async () => {
  const client = api();
  client.createMenu.mockRejectedValueOnce({ code: "menu.name_taken", params: { field: "name" } });
  await mount("/menus", client);
  const form = await fillNewSetMenu("Lunch");
  const save = form.getByRole("button", { name: "Save", exact: true });
  await save.click();
  await expect
    .element(form.getByRole("textbox", { name: /^Name/ }).first())
    .toHaveAccessibleDescription("Another menu already has this name. Enter a different name.");
  await expect.element(save).toBeEnabled();
  expect(location.pathname).toBe("/menus");
});

const placement = { memberId: "placed", ref: { kind: "set_menu", menuId: "daily" } } as const;

function withSectionAndPlacement(structure: MenuStructure): MenuStructure {
  const section = { kind: "section", sectionId: "starters" } as const;
  return {
    ...structure,
    root: {
      ...structure.root,
      members: [
        { id: "placed", ref: placement.ref, position: 0 },
        { id: "first", ref: section, position: 1 },
      ],
    },
    nodes: [placement, { memberId: "first", ref: section, internalName: "Starters", children: [] }],
    includable: [{ id: "dinner", name: "Dinner", rootSectionId: "dinner-root" }],
  };
}

it("offers a set menu in another list even when the root already holds it", async () => {
  const client = api();
  const structure = await client.getMenuStructure("lunch");
  client.getMenuStructure.mockResolvedValue(withSectionAndPlacement(structure));
  await mount("/menus/menu/lunch/view/structure", client);
  const rootActions = page.getByRole("button", { name: "Actions: Lunch" });
  await rootActions.click();
  await expect
    .element(page.getByRole("button", { name: "Include a menu", exact: true }))
    .toBeVisible();
  expect(page.getByRole("button", { name: "Set menu…", exact: true }).elements()).toHaveLength(0);
  await rootActions.click();
  await page.getByRole("button", { name: "Actions: Starters" }).click();
  await page.getByRole("button", { name: "Set menu…", exact: true }).click();
  await page.getByRole("combobox", { name: /Set menu/ }).click();
  await page.getByRole("option", { name: "Daily menu" }).click();
  expect(client.addSectionMember).toHaveBeenCalledExactlyOnceWith("starters", placement.ref);
});

it("shows a placed set menu's price and opens its editor from the structure row", async () => {
  const client = api();
  const structure = await client.getMenuStructure("lunch");
  client.getMenuStructure.mockResolvedValue(withSectionAndPlacement(structure));
  await mount("/menus/menu/lunch/view/structure", client);
  const name = page.getByRole("link", { name: "Daily menu", exact: true });
  await expect.element(name).toBeVisible();
  const row = name.element().closest("tr");
  expect(row?.textContent).toContain("€14.00");
  expect(row?.textContent).toContain("Set menu");
  await name.click();
  await expect.element(page.getByRole("tab", { name: "Set menu", exact: true })).toBeVisible();
  expect(location.pathname).toBe(dailyPath);
});

it("moves a set-menu placement into a section without editing the set menu", async () => {
  const client = api();
  const structure = await client.getMenuStructure("lunch");
  client.getMenuStructure.mockResolvedValue(withSectionAndPlacement(structure));
  await mount("/menus/menu/lunch/view/structure", client);
  await page.getByRole("button", { name: "Actions: Daily menu" }).click();
  await page.getByRole("button", { name: "Move to section…" }).click();
  await page.getByRole("combobox", { name: /Destination/ }).click();
  await page.getByRole("option", { name: "Starters" }).click();
  await page.getByRole("button", { name: "Move", exact: true }).click();
  expect(client.moveSectionMembersInto).toHaveBeenCalledExactlyOnceWith("starters", [
    { listId: "root", memberId: "placed" },
  ]);
});

it("removes the placement while leaving the set menu available to add", async () => {
  const client = api();
  const structure = await client.getMenuStructure("lunch");
  client.getMenuStructure.mockResolvedValue(withSectionAndPlacement(structure));
  client.removeSectionMember.mockImplementationOnce(async () => {
    client.getMenuStructure.mockResolvedValue(structure);
  });
  await mount("/menus/menu/lunch/view/structure", client);
  await page.getByRole("button", { name: "Actions: Daily menu" }).click();
  await page.getByRole("button", { name: "Remove from this menu" }).click();
  await expect.element(page.getByRole("button", { name: "Set menu…", exact: true })).toBeVisible();
  expect(client.removeSectionMember).toHaveBeenCalledExactlyOnceWith("root", "placed");
  expect(page.getByRole("link", { name: "Daily menu", exact: true }).elements()).toHaveLength(0);
});

it("keeps set menus out of Include menu while offering ordinary menus", async () => {
  const client = api();
  const structure = await client.getMenuStructure("lunch");
  client.getMenuStructure.mockResolvedValue(withSectionAndPlacement(structure));
  await mount("/menus/menu/lunch/view/structure", client);
  await page.getByRole("button", { name: "Actions: Lunch" }).click();
  await page.getByRole("button", { name: "Include a menu", exact: true }).click();
  await page.getByRole("combobox", { name: /Include a menu/ }).click();
  await expect.element(page.getByRole("option", { name: "Dinner" })).toBeVisible();
  expect(page.getByRole("option", { name: "Daily menu" }).elements()).toHaveLength(0);
});

it("shows the set menu guide from the editor in Help mode", async () => {
  onTestFinished(() => setHelpMode(false));
  await mount(dailyPath);
  const help = page.getByRole("button", { name: "Help with set menus" });
  expect(help.elements()).toHaveLength(0);
  setHelpMode(true);
  await help.click();
  const link = page.getByRole("link", { name: "Set menus guide" });
  await expect.element(link).toBeVisible();
  expect(link.element().getAttribute("href")).toMatch(/\/products#set-menus$/);
});
