import { afterEach, describe, expect, it, vi } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import type { CustomerMenuPreview, MenuStatus, PublicGuestMenu } from "@waitron/shared";
import { DashboardApi } from "../api/client.js";
import type { MenuStructure } from "../api/menu-api.js";
import { useLocale } from "../testing/locale-setup.js";
import {
  cleanupWidgets,
  expectNoA11yViolations,
  menuDocument,
  mountWidget,
  type Theme,
} from "../widgets/test-helpers.js";
import { MenusScreen } from "./menus-screen.js";

useLocale("en");
afterEach(cleanupWidgets);

const address = "/menus/menu/lunch/view/customer-menu";
const path = "/management-api/menus/lunch/customer-preview";
const noResults = "No dishes match your search.";
const photoReference = `${"a".repeat(64)}.webp`;
const languages = { defaultLanguage: "en", languages: ["en", "es"] };
const status: MenuStatus = {
  state: "changed",
  clashes: 0,
  version: 1,
  hash: "a".repeat(64),
  publishedAt: "2026-11-26T17:00:00.000Z",
};
const structure: MenuStructure = {
  rootSectionId: "root",
  root: {
    id: "root",
    internalName: "Staff lunch",
    names: {},
    members: [],
    image: null,
    color: null,
  },
  nodes: [],
  includable: [],
  includedBy: [],
  placeableSetMenus: [],
};

function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ready) => {
    resolve = ready;
  });
  return { promise, resolve };
}

function published(
  language = "en",
  name = "Lunch for guests",
): Extract<CustomerMenuPreview, { state: "published" }> {
  const member: PublicGuestMenu["members"][number] = {
    kind: "product",
    name: "Roast pepper",
    description: "Wood-fired with olive oil",
    image: photoReference,
    price: { min: "6.50", max: "8.50" },
    unit: "",
    allergens: { fish: {} },
    dietary: [],
    variants: [
      {
        name: "Large",
        price: "8.50",
        unit: "",
        allergens: { gluten: { kinds: ["wheat"] } },
        dietary: ["vegan"],
      },
    ],
    modifiers: [
      { kind: "options", name: "Cooking", labels: ["Wood-fired", "Roasted"] },
      {
        kind: "extras",
        name: "Sides",
        items: [
          {
            name: "Almond dressing",
            price: "1.00",
            portion: "0.200",
            unit: "kg",
            allergens: { nuts: { kinds: ["almonds"] } },
            dietary: ["vegetarian"],
          },
        ],
      },
    ],
  };
  return {
    state: "published",
    menu: {
      name,
      language,
      languages: languages.languages,
      members: [
        {
          kind: "set_menu",
          name: "Two courses",
          price: "18.50",
          lines: [
            {
              count: 2,
              courses: ["House vegetarian main course", "Classic garden salad"],
              choices: [
                { name: "Side salad", price: "0.00", unit: "", allergens: {}, dietary: [] },
                {
                  name: "Noodles (Large)",
                  price: "2.50",
                  unit: "",
                  allergens: { eggs: {} },
                  dietary: [],
                },
              ],
            },
            { count: 1, courses: ["Dessert"], choices: [] },
          ],
        },
        {
          kind: "section",
          name: "From the oven",
          members: [
            member,
            {
              ...member,
              name: "House bread",
              image: null,
              allergens: null,
              variants: [],
              modifiers: [],
            },
          ],
        },
      ],
    },
  };
}

async function open(
  preview: (url: URL) => Response | Promise<Response>,
  theme: Theme = "light",
  readStatus: () => MenuStatus = () => status,
) {
  const fetcher = new DashboardApi("", async (input) => {
    const url = new URL(input, location.origin);
    if (url.pathname === path) return preview(url);
    const currentStatus = readStatus();
    const draft = {
      status: currentStatus,
      live: null,
      document: menuDocument([], {}),
      setMenuProblems: [],
      clashes: [],
      changes: [],
      warnings: [],
      hash: "b".repeat(64),
    };
    const routes: Record<string, unknown> = {
      "/api/content-languages": languages,
      "/management-api/menus": [
        { id: "lunch", name: "Staff lunch", active: true, kind: "menu", setPrice: null },
      ],
      "/management-api/products": [],
      "/management-api/categories": [],
      "/management-api/menu-settings": { defaultProductVatClass: "general", defaultColor: null },
      "/management-api/menus/lunch/structure": structure,
      "/management-api/menus/lunch/status": currentStatus,
      "/management-api/menus/lunch/preview": draft,
      "/management-api/menus/lunch/read": {
        structure: { status: 200, body: structure },
        status: { status: 200, body: currentStatus },
        preview: { status: 200, body: draft },
      },
      "/management-api/menus/lunch/publications": {
        timeZone: "Europe/Madrid",
        live: null,
        editions: [],
      },
    };
    return url.pathname in routes
      ? Response.json(routes[url.pathname])
      : new Response(null, { status: 404 });
  });
  history.replaceState(null, "", address);
  return mountWidget<MenusScreen>("dashboard-menus-screen", { api: fetcher }, theme);
}

function customerPage(el: MenusScreen) {
  return el.shadowRoot
    ?.querySelector("dashboard-menu-online-preview")
    ?.shadowRoot?.querySelector("dashboard-customer-menu-page");
}

function publishedSections() {
  const answer = published();
  if (answer.state !== "published") throw new Error("Expected a published menu");
  const oven = answer.menu.members[1]!;
  if (oven.kind !== "section") throw new Error("Expected the oven section");
  const [pepper, bread] = oven.members;
  oven.members = [bread!, { kind: "section", name: "Vegetables", members: [pepper!] }];
  answer.menu.members.push(
    ...["From the oven", "Small plates to share", "From the garden", "Desserts and coffee"].map(
      (name): PublicGuestMenu["members"][number] => ({
        kind: "section",
        name,
        members: [{ ...bread!, name: `Bread for ${name}` }],
      }),
    ),
  );
  return answer;
}

describe("the customer menu Online preview", () => {
  it("opens on its own address and links an unpublished menu to Preview", async () => {
    await open(() => Response.json({ state: "unpublished" }));
    await expect
      .element(page.getByRole("tab", { name: "Customer menu", selected: true }))
      .toBeVisible();
    await expect.element(page.getByText("Customers cannot open this page yet.")).toBeVisible();
    await expect.element(page.getByText("This menu has never been published.")).toBeVisible();
    const link = page.getByRole("link", { name: "Go to Preview" });
    await expect.element(link).toHaveAttribute("href", "/menus/menu/lunch/view/preview");
    const pushed = vi.spyOn(history, "pushState");
    try {
      await link.click();
      await expect
        .element(page.getByRole("tab", { name: "Preview", exact: true, selected: true }))
        .toBeVisible();
      expect(new URL(String(pushed.mock.calls.at(-1)?.[2]), location.origin).pathname).toBe(
        "/menus/menu/lunch/view/preview",
      );
    } finally {
      pushed.mockRestore();
    }
  });

  it("puts dish allergens and diets under their own headings", async () => {
    const preview = published();
    const section = preview.menu.members[1]!;
    if (section.kind !== "section") throw new Error("Expected the oven section");
    const dish = section.members[0]!;
    if (dish.kind !== "product") throw new Error("Expected a dish");
    dish.allergens = { fish: {}, eggs: {} };
    dish.dietary = ["halal"];
    await open(() => Response.json(preview));
    await page.getByRole("button", { name: dish.name, exact: true }).click();

    const allergens = page.getByRole("heading", { name: "Allergens", exact: true });
    const diets = page.getByRole("heading", { name: "Dietary declarations", exact: true });
    const allergenLine = allergens.element().nextElementSibling!;
    expect
      .soft(Array.from(allergenLine.children, (entry) => entry.textContent?.trim()))
      .toEqual(["Eggs", "Fish", "Almond dressing: Almonds"]);
    const [first, second] = Array.from(allergenLine.children);
    const icon = first!.querySelector("wt-icon")!.getBoundingClientRect();
    const label = document.createRange();
    label.selectNode(first!.lastChild!);
    const labelStart = label.getBoundingClientRect().left;
    const betweenEntries =
      second!.getBoundingClientRect().left - first!.getBoundingClientRect().right;
    expect.soft(betweenEntries).toBeGreaterThan(1.8 * (labelStart - icon.right));
    await expect.element(diets, { timeout: 1000 }).toBeVisible();
    expect(diets.element().nextElementSibling?.textContent?.trim()).toBe("Halal");
  });

  it("shows an extra's allergen beside its name and again in Allergens", async () => {
    await open(() => Response.json(published()));
    await page.getByRole("button", { name: "Roast pepper", exact: true }).click();
    const sides = page.getByRole("heading", { name: "Sides" }).element().nextElementSibling!;
    const allergen = page.getByRole("img", { name: "Nuts (Almonds)", exact: true });
    await expect.element(allergen, { timeout: 1000 }).toBeVisible();
    const extraName = allergen.element().closest("li")!.firstElementChild!;
    expect(extraName.textContent).toContain("Almond dressing");
    expect(extraName.contains(allergen.element())).toBe(true);
    const summaryEntry = page.getByText("Almond dressing: Almonds", { exact: true });
    await expect.element(summaryEntry).toBeVisible();
    await expect
      .element(summaryEntry.getByRole("img", { name: "Nuts", exact: true }), { timeout: 1000 })
      .toBeVisible();
    expect(sides.textContent).toContain("Vegetarian");
  });

  it("writes out multiple servings and keeps explicit measured amounts", async () => {
    const preview = published("es");
    const section = preview.menu.members[1]!;
    if (section.kind !== "section") throw new Error("Expected the oven section");
    const dish = section.members[0]!;
    if (dish.kind !== "product") throw new Error("Expected a dish");
    const sides = dish.modifiers[1]!;
    if (sides.kind !== "extras") throw new Error("Expected extras");
    const extra = sides.items[0]!;
    sides.items = [
      { ...extra, name: "Bread", portion: "1.000", unit: "rac", servingUnit: "Ración" },
      { ...extra, name: "Salad", portion: "2.000", unit: "rac", servingUnit: "Ración" },
      { ...extra, portion: "1.000" },
      { ...extra, name: "Oil", portion: "0.250", unit: "l" },
    ];

    await open(() => Response.json(preview));
    await page.getByRole("button", { name: dish.name, exact: true }).click();
    const names = page.getByRole("heading", { name: sides.name }).element().nextElementSibling!;
    expect(Array.from(names.children, (row) => row.firstElementChild?.textContent?.trim())).toEqual(
      ["Bread", "Salad · 2 × Ración", "Almond dressing · 1 kg", "Oil · 0,25 l"],
    );
  });

  it("shows the set-menu title's return focus ring only after keyboard use", async () => {
    const { el } = await open(() => Response.json(published()), "dark");
    const cardTitle = page.getByRole("button", { name: "Two courses", exact: true });
    const back = page.getByRole("button", { name: "Back to menu" });
    await expect.element(cardTitle).toBeVisible();
    const customer = customerPage(el)!;
    customer.setAttribute("data-theme", "dark");
    await cardTitle.click();
    await back.click();
    await expect.element(cardTitle).toBeVisible();
    const button = cardTitle.element();
    expect(customer.shadowRoot!.activeElement).toBe(button);
    expect.soft(getComputedStyle(button).outlineStyle).toBe("none");

    await userEvent.keyboard("{Enter}");
    await expect.element(back).toBeVisible();
    await userEvent.tab({ shift: true });
    await userEvent.keyboard("{Enter}");
    await expect.element(cardTitle, { timeout: 1000 }).toBeVisible();
    expect(customer.shadowRoot!.activeElement).toBe(button);
    expect(getComputedStyle(button).outlineStyle).toBe("solid");
  });

  it.each(["House bread", "Two courses"])(
    "lines up Menu with the photo-free %s heading",
    async (entry) => {
      await open(() => Response.json(published()));
      await page.getByRole("button", { name: entry, exact: true }).click();

      const title = page.getByRole("heading", { name: entry, exact: true }).element();
      const menu = page.getByRole("button", { name: "Back to menu" }).element();
      const chevron = menu.querySelector("wt-icon")!.shadowRoot!.querySelector("path")!;
      const chevronLeft = chevron.getBoundingClientRect().left;
      expect
        .soft(Math.abs(chevronLeft - title.getBoundingClientRect().left))
        .toBeLessThanOrEqual(3);
      expect(chevronLeft - menu.getBoundingClientRect().left).toBeGreaterThan(8);
    },
  );

  it("shows a phone list and a computer grid with dish declarations and a set-menu summary", async () => {
    await page.viewport(1200, 800);
    await open(() => Response.json(published()));
    await expect.element(page.getByRole("heading", { name: "Lunch for guests" })).toBeVisible();
    await expect.element(page.getByText("This preview shows the published menu.")).toBeVisible();
    await expect.element(page.getByText("Two courses")).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "Allergen key" })).toBeVisible();
    await expect
      .element(
        page.getByText(
          "Icons show declared allergens. No icon does not mean allergen-free. Ask staff about allergens.",
          { exact: true },
        ),
      )
      .not.toBeInTheDocument();
    await expect.element(page.getByRole("img", { name: "Fish" })).toBeVisible();
    const courseSummary = "2 × House vegetarian main course or Classic garden salad, Dessert";
    await expect.element(page.getByText(courseSummary, { exact: true })).toBeVisible();
    const setPrice = page.getByText("€18.50", { exact: true }).element();
    const summary = page.getByText(courseSummary, { exact: true }).element();
    expect(Number(getComputedStyle(setPrice).fontWeight)).toBeGreaterThan(
      Number(getComputedStyle(summary).fontWeight),
    );
    await expect.element(page.getByText("Large", { exact: true })).not.toBeInTheDocument();
    await expect
      .element(page.getByText("Almond dressing", { exact: false }))
      .not.toBeInTheDocument();
    const pepper = page.getByText("Roast pepper", { exact: true }).element();
    const bread = page.getByText("House bread", { exact: true }).element();
    const breadDeclarations = bread.closest(".dish")!.querySelector(".declarations")!;
    expect(breadDeclarations.textContent?.trim()).toBe("");
    expect(bread.getBoundingClientRect().left).toBeGreaterThan(pepper.getBoundingClientRect().left);
    await page.getByRole("radio", { name: "Phone" }).click();
    await vi.waitFor(() => {
      expect(bread.getBoundingClientRect().left).toBe(pepper.getBoundingClientRect().left);
      expect(bread.getBoundingClientRect().top).toBeGreaterThan(pepper.getBoundingClientRect().top);
    });
    try {
      await page.viewport(360, 800);
      const priceBox = setPrice.getBoundingClientRect();
      const summaryBox = summary.getBoundingClientRect();
      expect(priceBox.left).toBeGreaterThanOrEqual(summaryBox.right);
      expect(priceBox.top).toBeLessThan(summaryBox.bottom);
    } finally {
      await page.viewport(1200, 800);
    }
  });

  it.each([
    ["Phone", "Phone", 700],
    ["Computer", "Computer", 700],
    ["Phone", "Computer", 700],
    ["Phone", "Phone", 540],
  ] as const)(
    "returns to the same dish from %s to %s at %i px high",
    async (size, returnSize, height) => {
      const viewport = [innerWidth, innerHeight] as const;
      try {
        await page.viewport(390, 800);
        const answer = published();
        const oven = answer.menu.members[1]!;
        if (oven.kind !== "section") throw new Error("Expected the oven section");
        const pepper = oven.members[0]!;
        if (pepper.kind !== "product") throw new Error("Expected a dish");
        oven.members = Array.from({ length: 26 }, (_, i) => ({
          ...pepper,
          image: null,
          description: `Dish number ${i + 1}`,
        }));
        const { el, host } = await open(() => Response.json(answer));
        host.style.cssText += "height: 700px; container-type: size; overflow-y: auto;";
        await page.getByRole("radio", { name: size }).click();
        const search = page.getByRole("searchbox", { name: "Search dishes" });
        await search.fill("roast");
        const searchInput = search.element();
        const dish = page.getByRole("button", { name: "Roast pepper", exact: true }).nth(20);
        await expect.element(dish, { timeout: 1000 }).toBeVisible();
        const customer = customerPage(el)!;
        const scroller = size === "Phone" ? host : customer.parentElement!;
        const button = dish.element();
        const dishAtCentre = () => {
          const { left, top, width, height } = button.getBoundingClientRect();
          return customer.shadowRoot!.elementFromPoint(left + width / 2, top + height / 2);
        };
        button.scrollIntoView({ block: "center", inline: "center" });
        button.focus({ preventScroll: true });
        if (height < 700)
          scroller.scrollTop +=
            button.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom + 20;
        const top = scroller.scrollTop;
        const left = scroller.scrollLeft;
        expect(top).toBeGreaterThan(0);
        if (size === "Computer") expect(left).toBeGreaterThan(0);
        expect(dishAtCentre() === button).toBe(true);
        await userEvent.keyboard("{Enter}");
        const heading = page.getByRole("heading", { name: "Roast pepper", exact: true });
        await expect.element(heading).toBeVisible();
        expect(customer.shadowRoot!.activeElement).toBe(heading.element());
        expect(heading.element().parentElement?.querySelector("p.description")?.textContent).toBe(
          "Dish number 21",
        );
        expect(searchInput).not.toBeVisible();
        expect(scroller.scrollTop).toBeLessThan(top);
        host.style.height = `${height}px`;
        if (size !== returnSize) await page.getByRole("radio", { name: returnSize }).click();
        await page.getByRole("button", { name: "Back to menu" }).click();
        await expect.element(search).toHaveValue("roast");
        if (size === returnSize && height === 700) {
          expect(scroller.scrollTop).toBe(top);
          expect(scroller.scrollLeft).toBe(left);
        }
        expect(dishAtCentre() === button).toBe(true);
        expect(customer.shadowRoot!.activeElement).toBe(button);
        expect(location.pathname + location.hash).toBe(address);
      } finally {
        await page.viewport(...viewport);
      }
    },
  );

  it("searches displayed dish and set-menu names without losing focus or the allergen key", async () => {
    await open(() => Response.json(publishedSections()));
    const search = page.getByRole("searchbox", { name: "Search dishes" });
    await expect.element(search, { timeout: 1000 }).toBeVisible();
    await search.fill("  ROAST  ");
    await expect.element(page.getByText("Roast pepper", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "Vegetables" })).toBeVisible();
    await expect.element(page.getByText("House bread", { exact: true })).not.toBeInTheDocument();
    await expect.element(page.getByRole("link", { name: "From the oven" })).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "From the garden" }))
      .not.toBeInTheDocument();
    expect((search.element().getRootNode() as ShadowRoot).activeElement).toBe(search.element());
    await search.fill("courses");
    await expect.element(page.getByText("Two courses", { exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("navigation", { name: "Menu sections" }))
      .not.toBeInTheDocument();
    await search.fill("olive oil");
    await expect
      .element(page.getByText(noResults, { exact: true }), { timeout: 1000 })
      .toHaveRole("status");
    await expect.element(page.getByRole("heading", { name: "Allergen key" })).toBeVisible();
    await search.fill("");
    await expect.element(page.getByText("House bread", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Two courses", { exact: true })).toBeVisible();
  });

  it.each([
    [390, "Phone"],
    [1200, "Computer"],
  ] as const)(
    "puts the empty search status in the section strip's place at %i px in %s",
    async (width, size) => {
      const viewport = [innerWidth, innerHeight] as const;
      try {
        await page.viewport(width, 800);
        const { el } = await open(() => Response.json(publishedSections()));
        await page.getByRole("radio", { name: size }).click();
        const search = page.getByRole("searchbox", { name: "Search dishes" });
        await search.fill("missing");
        const message = customerPage(el)!.shadowRoot!.querySelector("article [role='status']")!;
        await vi.waitFor(() => expect(message.textContent?.trim()).toMatch(/^No dishes /));
        const text = document.createRange();
        text.selectNodeContents(message);
        const gap =
          text.getBoundingClientRect().top - search.element().getBoundingClientRect().bottom;
        expect(gap).toBeGreaterThanOrEqual(20);
        expect(gap).toBeLessThanOrEqual(28);
        await expect
          .element(page.getByRole("navigation", { name: "Menu sections" }))
          .not.toBeInTheDocument();
      } finally {
        await page.viewport(...viewport);
      }
    },
  );

  it.each([
    [390, "Phone", "dashboard"],
    [390, "Computer", "canvas"],
    [1200, "Computer", "dashboard"],
    [1200, "Computer", "document"],
  ] as const)(
    "jumps to sections and tracks scrolling at %i px in %s using the %s scroll area",
    async (width, size, surface) => {
      const viewport = [innerWidth, innerHeight] as const;
      try {
        await page.viewport(width, 800);
        const { el, host } = await open(() => Response.json(publishedSections()));
        if (surface !== "document") {
          host.style.cssText += "height: 700px; container-type: size; overflow-y: auto;";
        }
        const choice = page.getByRole("radio", { name: size });
        await expect.element(choice).toBeVisible();
        if (choice.element().getAttribute("aria-checked") !== "true") await choice.click();
        const first = page.getByRole("link", { name: "From the oven", exact: true }).first();
        await expect.element(first, { timeout: 1000 }).toHaveAttribute("aria-current", "location");
        const last = page.getByRole("link", { name: "Desserts and coffee" });
        const customer = customerPage(el)!;
        const canvas = customer.parentElement!;
        const doc = document.scrollingElement!;
        const scroller = { canvas, dashboard: host, document: doc }[surface];
        const strip = first.element().closest("nav")!;
        const second = page.getByRole("link", { name: "From the oven", exact: true }).nth(1);
        const heading = page.getByRole("heading", { name: "From the oven", exact: true }).nth(1);
        second.element().focus();
        const outerTop = host.scrollTop;
        const docTop = doc.scrollTop;
        await userEvent.keyboard("{Enter}");
        expect(customer.shadowRoot!.activeElement).toBe(heading.element());
        expect(scroller.scrollTop).toBeGreaterThan(0);
        if (surface !== "dashboard") expect(host.scrollTop).toBe(outerTop);
        if (surface !== "canvas") expect(canvas.scrollTop).toBe(0);
        if (surface !== "document") expect(doc.scrollTop).toBe(docTop);
        expect(location.pathname + location.hash).toBe(address);
        const gap =
          heading.element().getBoundingClientRect().top - strip.getBoundingClientRect().bottom;
        expect(
          Math.abs(gap - parseFloat(getComputedStyle(strip).marginBlockEnd)),
        ).toBeLessThanOrEqual(1);
        await expect.element(second, { timeout: 1000 }).toHaveAttribute("aria-current", "location");

        scroller.scrollTop = scroller.scrollHeight;
        await expect.element(last, { timeout: 1000 }).toHaveAttribute("aria-current", "location");
        if (width === 390 && size === "Phone")
          expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth);
        const rail = strip.getBoundingClientRect();
        const active = last.element().getBoundingClientRect();
        expect(active.left).toBeGreaterThanOrEqual(rail.left - 1);
        expect(active.right).toBeLessThanOrEqual(rail.left + strip.clientWidth + 1);
        scroller.scrollTop = 0;
        await expect.element(first).toHaveAttribute("aria-current", "location");
        const garden = page.getByRole("link", { name: "From the garden" }).element();
        garden.focus({ preventScroll: true });
        await userEvent.keyboard("{Enter}");
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        expect.soft(garden).toHaveAttribute("aria-current", "location");
        scroller.scrollTop = 0;
        await expect.element(first).toHaveAttribute("aria-current", "location");
      } finally {
        await page.viewport(...viewport);
      }
    },
  );

  it("keeps the current underline distinct with forced colours", async () => {
    const session = cdp();
    await session.send("Emulation.setEmulatedMedia", {
      features: [{ name: "forced-colors", value: "active" }],
    });
    try {
      await open(() => Response.json(publishedSections()));
      const links = page.getByRole("link", { name: "From the oven", exact: true });
      await expect.element(links.first()).toHaveAttribute("aria-current", "location");
      expect(getComputedStyle(links.first().element()).borderBottomColor).not.toBe(
        getComputedStyle(links.nth(1).element()).borderBottomColor,
      );
    } finally {
      await session.send("Emulation.setEmulatedMedia", { features: [] });
    }
  });

  it("follows the Computer canvas when it becomes one pixel too narrow", async () => {
    const viewport = [innerWidth, innerHeight] as const;
    try {
      await page.viewport(1200, 800);
      const { el, host } = await open(() => Response.json(publishedSections()));
      host.style.cssText += "height: 700px; container-type: size; overflow-y: auto;";
      const first = page.getByRole("link", { name: "From the oven", exact: true }).first();
      await expect.element(first).toHaveAttribute("aria-current", "location");
      const canvas = customerPage(el)!.parentElement!;
      const preview = (canvas.getRootNode() as ShadowRoot).host as HTMLElement;
      preview.style.inlineSize = "720px";
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      expect(getComputedStyle(canvas).overflowY).toBe("visible");
      preview.style.inlineSize = "719px";
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      expect(getComputedStyle(canvas).overflowY).toBe("auto");
      canvas.scrollTop = canvas.scrollHeight;
      await expect
        .element(page.getByRole("link", { name: "Desserts and coffee" }), { timeout: 1000 })
        .toHaveAttribute("aria-current", "location");
      expect(host.scrollTop).toBe(0);
    } finally {
      await page.viewport(...viewport);
    }
  });

  it("keeps the last chosen language when the previous request arrives late", async () => {
    const late = gate<Response>();
    const started = gate<void>();
    await open((url) => {
      const language = url.searchParams.get("language");
      if (language === "en") {
        started.resolve();
        return late.promise;
      }
      return Response.json(
        language === "es" ? published("es", "Spanish lunch") : published("en", "First lunch"),
      );
    });
    await expect.element(page.getByRole("heading", { name: "First lunch" })).toBeVisible();
    await page.getByRole("searchbox", { name: "Search dishes" }).fill("missing");
    await expect.element(page.getByText(noResults, { exact: true })).toBeVisible();
    const language = page.getByRole("combobox", { name: "Language" });
    await language.click();
    await page.getByRole("option", { name: "Spanish" }).click();
    await expect.element(page.getByRole("heading", { name: "Spanish lunch" })).toBeVisible();
    await language.click();
    await page.getByRole("option", { name: "English" }).click();
    await started.promise;
    await language.click();
    await page.getByRole("option", { name: "Spanish" }).click();
    await expect.element(page.getByRole("heading", { name: "Spanish lunch" })).toBeVisible();
    await expect.element(page.getByRole("searchbox", { name: "Buscar platos" })).toHaveValue("");
    expect(page.getByText("6,50 €–8,50 €", { exact: true }).first().element()).toBeVisible();
    late.resolve(Response.json(published("en", "Late lunch")));
    await new Promise(requestAnimationFrame);
    await expect.element(page.getByRole("heading", { name: "Spanish lunch" })).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "Late lunch" })).not.toBeInTheDocument();
  });

  it("shows the current crop and replacement behind a published photo reference", async () => {
    const cropped = "/media/current-crop.webp";
    const network = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        images: {
          [photoReference]: {
            id: "photo",
            revision: 2,
            source: "/media/replacement.webp",
            square: "/media/square-crop.webp",
            till: "/media/till-crop.webp",
            display: cropped,
          },
        },
      }),
    );
    try {
      const { el } = await open(() => Response.json(published()));
      await expect.element(page.getByRole("heading", { name: "Lunch for guests" })).toBeVisible();
      await vi.waitFor(() =>
        expect(customerPage(el)?.shadowRoot?.querySelector("img")?.getAttribute("src")).toBe(
          cropped,
        ),
      );
    } finally {
      network.mockRestore();
    }
  });

  it("updates the open preview when a menu gets its first or next published edition", async () => {
    let edition: MenuStatus = { state: "unpublished", clashes: 0 };
    const readPreview = vi.fn(() =>
      Response.json(
        edition.state === "unpublished"
          ? { state: "unpublished" }
          : published("en", `Published lunch ${edition.version}`),
      ),
    );
    const { el } = await open(readPreview, "light", () => edition);
    await expect.element(page.getByText("This menu has never been published.")).toBeVisible();
    await expect.element(page.getByText("Unpublished", { exact: true })).toBeVisible();
    for (const version of [1, 2]) {
      edition = { ...status, state: "current", version };
      el.api.liveData.invalidate([{ type: "menu_releases" }]);
      await expect
        .element(page.getByText(`Live: version ${version}`, { exact: false }))
        .toBeVisible();
      await vi.waitFor(() =>
        expect(
          page.getByRole("heading", { name: `Published lunch ${version}` }).element(),
        ).toBeVisible(),
      );
      await expect
        .element(page.getByText("This preview shows the published menu."))
        .not.toBeInTheDocument();
    }
    edition = { ...status, state: "changed", version: 2 };
    el.api.liveData.invalidate([{ type: "menus" }]);
    await expect.element(page.getByText("This preview shows the published menu.")).toBeVisible();
    expect(readPreview).toHaveBeenCalledTimes(3);
  });

  it.each(["light", "dark"] as const)(
    "keeps every preview state accessible in %s",
    async (theme) => {
      const first = gate<Response>();
      const preview = vi
        .fn<() => Response | Promise<Response>>()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(Response.json({ state: "unpublished" }))
        .mockReturnValue(Response.json(published()));
      const { el, host } = await open(preview, theme);
      await expect.element(page.getByText("Loading the published menu…")).toBeVisible();
      await expectNoA11yViolations(host);
      first.resolve(Response.json({ error: { code: "menu.not_found" } }, { status: 404 }));
      const retry = page.getByRole("button", { name: "Try again", exact: true });
      await expect.element(retry).toBeVisible();
      await expectNoA11yViolations(host);
      await retry.click();
      await expect.element(page.getByText("This menu has never been published.")).toBeVisible();
      await expectNoA11yViolations(host);
      await page.getByRole("link", { name: "Go to Preview" }).click();
      await page.getByRole("tab", { name: "Customer menu" }).click();
      await expect.element(page.getByRole("heading", { name: "Lunch for guests" })).toBeVisible();
      const customer = customerPage(el)!;
      const pageTheme = theme === "light" ? "dark" : "light";
      customer.setAttribute("data-theme", pageTheme);
      const canvas = customer.shadowRoot!.querySelector<HTMLElement>("article")!;
      await vi.waitFor(() =>
        expect(getComputedStyle(canvas).color).toBe(
          pageTheme === "dark" ? "rgb(236, 238, 242)" : "rgb(35, 31, 32)",
        ),
      );
      await expectNoA11yViolations(host);
      await page.getByRole("button", { name: "Roast pepper", exact: true }).click();
      const dish = customer.shadowRoot!.querySelector("[data-detail]")!;
      const detailText = () => dish.textContent?.replace(/\s+/g, " ").trim();
      expect(detailText()).toContain("Wood-fired with olive oil");
      expect(detailText()).toContain("Large €8.50 Cereals containing gluten (Wheat), Vegan");
      expect(detailText()).toContain("Almond dressing · 0.2 kg €1.00 Vegetarian");
      const cooking = page.getByRole("heading", { name: "Cooking", exact: true }).element();
      expect.soft(cooking.nextElementSibling?.textContent?.trim()).toBe("Wood-fired · Roasted");
      expect
        .soft(getComputedStyle(cooking).color)
        .toBe(getComputedStyle(dish.querySelector("h2")!).color);
      const allergens = page.getByRole("heading", { name: "Allergens", exact: true });
      await expect.element(allergens, { timeout: 1000 }).toBeVisible();
      expect(
        Array.from(allergens.element().nextElementSibling!.children, (entry) =>
          entry.textContent?.trim(),
        ),
      ).toEqual(["Fish", "Almond dressing: Almonds"]);
      const photo = dish.querySelector("img")!;
      const name = dish.querySelector("h2")!.getBoundingClientRect();
      const image = photo.getBoundingClientRect();
      const back = page.getByRole("button", { name: "Back to menu" });
      const pill = back.element().getBoundingClientRect();
      expect(photo).toBeVisible();
      expect.soft(image.bottom).toBeLessThanOrEqual(name.top);
      expect.soft(image.width).toBeCloseTo(canvas.clientWidth, 0);
      expect.soft(pill.top).toBeGreaterThan(image.top);
      expect.soft(pill.bottom).toBeLessThan(image.bottom);
      expect.soft(dish.querySelector("strong")?.textContent).toBe("€6.50–€8.50");
      await expectNoA11yViolations(host);
      await back.click();
      await page.getByRole("button", { name: "Two courses", exact: true }).click();
      await expect.element(page.getByText("€18.50 per person", { exact: true })).toBeVisible();
      await expect
        .element(
          page.getByRole("heading", {
            name: "2 × House vegetarian main course or Classic garden salad",
          }),
        )
        .toBeVisible();
      const included = page.getByText("Side salad", { exact: true });
      await expect.element(included).toBeVisible();
      expect(included.element().closest("li")!.textContent?.trim()).toBe("Side salad");
      const surcharge = page.getByText("+ €2.50", { exact: true });
      await expect.element(surcharge).toBeVisible();
      const row = surcharge.element().closest("li")!;
      expect(row.textContent?.replace(/\s+/g, " ").trim()).toBe("Noodles (Large) + €2.50 Eggs");
      expect(getComputedStyle(row).borderBottomWidth).toBe("1px");
      expect(surcharge.element().getBoundingClientRect().right).toBeCloseTo(
        row.getBoundingClientRect().right,
        0,
      );
      const dessert = page.getByRole("heading", { name: "Dessert", exact: true });
      await expect.element(dessert).toBeVisible();
      expect(dessert.element().nextElementSibling).toBeNull();
      await expectNoA11yViolations(host);
      await page.getByRole("button", { name: "Back to menu" }).click();
      const search = page.getByRole("searchbox", { name: "Search dishes" });
      await search.fill("pepper");
      await expect.element(page.getByText("Roast pepper", { exact: true })).toBeVisible();
      await expectNoA11yViolations(host);
      await search.fill("missing");
      await expect.element(page.getByText(noResults, { exact: true })).toBeVisible();
      await expectNoA11yViolations(host);
    },
  );
});
