import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { DashboardApi, MenuPreview, MenuSummary, SetMenuDetails } from "../api/client.js";
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
  names: { en: "Today's menu", es: "Menú del día" },
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
    getMenuSettings: vi
      .fn()
      .mockResolvedValue({
        defaultProductVatClass: "general",
        defaultColor: null,
        takeawayVat: true,
      }),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "en", languages: ["en", "es"] }),
    getMenuStatuses: vi.fn().mockResolvedValue({ lunch: status }),
    getMenuStructure: vi.fn().mockResolvedValue({
      rootSectionId: "root",
      root: { id: "root", internalName: "Lunch", names: {}, image: null, color: null, members: [] },
      includable: [],
      includedBy: [],
      nodes: [],
    }),
    getMenuStatus: vi.fn().mockResolvedValue(status),
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
    expect(client.getMenuStructure).not.toHaveBeenCalled();
    await expect
      .element(page.getByText("Price per set menu", { exact: false }).first())
      .toBeVisible();
    expect(page.getByRole("button", { name: "Publish", exact: true }).elements()).toHaveLength(0);
  } finally {
    route.mockRestore();
  }
});

it("links to the full menu that publishes the set menu", async () => {
  await mount(dailyPath);
  const link = page.getByRole("link", { name: "Lunch", exact: true });
  await vi.waitFor(() => expect(link.element().getAttribute("href")).toBe(lunchPath));
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
    "Line 1 needs a course.",
  ],
  [
    "line_unfillable",
    { kind: "line_unfillable", lineId: "first" },
    "No dish counts towards line 1.",
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
