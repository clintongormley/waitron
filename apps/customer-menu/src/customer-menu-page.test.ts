import type { PublicGuestMenu } from "@waitron/shared";
import { expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { published, publishedSections } from "../test/published-menu.js";
import "./customer-menu-page.js";

const noResults = "No dishes match your search.";
const photo = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'/%3E";

async function openMenu(
  menu: PublicGuestMenu,
  theme: "light" | "dark" = "light",
  standalone = false,
  canvas?: HTMLElement,
) {
  const host = document.createElement("main");
  host.id = "renderer-test";
  const customer = document.createElement("customer-menu-page");
  customer.menu = menu;
  customer.theme = theme;
  customer.standalone = standalone;
  customer.photoSource = () => photo;
  if (canvas) {
    canvas.attachShadow({ mode: "open" }).append(customer);
    host.append(canvas);
  } else {
    host.append(customer);
  }
  document.body.append(host);
  await customer.updateComplete;
  return { customer, host };
}

const viewport = [innerWidth, innerHeight] as const;
afterEach(async () => {
  document.getElementById("renderer-test")?.remove();
  if (innerWidth !== viewport[0] || innerHeight !== viewport[1]) await page.viewport(...viewport);
});

describe("Customer menu page", () => {
  it("centres the standalone menu on computer screens and keeps its page edge unframed", async () => {
    await page.viewport(1440, 900);
    const { customer } = await openMenu(published().menu, "light", true);
    const article = customer.shadowRoot!.querySelector("article")!;
    const frame = article.getBoundingClientRect();
    const header = article.querySelector("header")!.getBoundingClientRect();
    expect.soft(getComputedStyle(article).borderTopWidth).toBe("0px");
    expect.soft(getComputedStyle(article).borderTopLeftRadius).toBe("0px");
    expect.soft(header.width).toBeGreaterThanOrEqual(1000);
    expect.soft(header.width).toBeLessThanOrEqual(1100);
    expect.soft(header.left - frame.left).toBeCloseTo(frame.right - header.right, 0);
    const search = article.querySelector("wt-input")!.shadowRoot!.querySelector(".field")!;
    expect.soft(getComputedStyle(search).boxShadow).toBe("none");
    const dish = page.getByRole("button", { name: "Roast pepper", exact: true }).element();
    expect.soft(getComputedStyle(dish).color).toBe(getComputedStyle(article).color);
    const image = article.querySelector("img")!;
    expect.soft(getComputedStyle(image).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  });

  it.each(["light", "dark"] as const)(
    "filters the published menu and marks choices in %s",
    async (theme) => {
      await page.viewport(1200, 800);
      const preview = published();
      const [setMenu, oven] = preview.menu.members;
      if (setMenu?.kind !== "set_menu" || oven?.kind !== "section")
        throw new Error("Expected the set menu and oven section");
      const [pepper, bread] = oven.members;
      if (pepper?.kind !== "product" || bread?.kind !== "product")
        throw new Error("Expected two dishes");
      pepper.dietary = ["vegan"];
      pepper.allergens = {};
      pepper.variants.push({ name: "Small", price: "6.50", unit: "", allergens: {}, dietary: [] });
      bread.dietary = ["vegan"];
      bread.allergens = {};
      const sides = pepper.modifiers[1]!;
      if (sides.kind !== "extras") throw new Error("Expected an extras list");
      bread.modifiers = [
        { ...sides, items: [{ ...sides.items[0]!, allergens: null, preselected: true }] },
      ];
      setMenu.lines[0]!.choices[0]!.allergens = null;
      oven.members = [pepper];
      preview.menu.members.push({ kind: "section", name: "Bakery", members: [bread] });
      const { host } = await openMenu(preview.menu, theme);
      const filters = page.getByRole("button", { name: "Allergies and diets" });
      const dialog = page.getByRole("dialog", { name: "Allergies and diets" });
      const allergens = page.getByRole("combobox", { name: "Exclude allergens" });
      const diet = page.getByRole("combobox", { name: "Diet" });
      const close = page.getByRole("button", { name: "Close", exact: true });
      const search = page.getByRole("searchbox", { name: "Search dishes" });
      const dish = page.getByRole("button", { name: "Roast pepper", exact: true });
      const set = page.getByRole("button", { name: "Two courses", exact: true });
      const back = page.getByRole("button", { name: "Back to menu" });

      await expect.element(filters, { timeout: 1500 }).toBeVisible();
      (filters.element() as HTMLElement).focus();
      await userEvent.keyboard("{Enter}");
      await expect.element(dialog).toBeVisible();
      await expectNoA11yViolations(host);
      const allergensControl = allergens.element();
      expect((allergensControl.getRootNode() as ShadowRoot).activeElement).toBe(allergensControl);
      await userEvent.keyboard("{Enter}{Home}{ArrowDown}{Enter}");
      await expect
        .element(page.getByRole("option", { name: "Cereals containing gluten", selected: true }), {
          timeout: 1500,
        })
        .toBeVisible();
      await page.getByRole("option", { name: "Nuts", exact: true }).click();
      await page.getByRole("option", { name: "Eggs" }).click();
      await userEvent.keyboard("{Escape}");
      await diet.click();
      await page.getByRole("option", { name: "Vegetarian", exact: true }).click();
      await close.click();

      const filtersControl = filters.element();
      expect((filtersControl.getRootNode() as ShadowRoot).activeElement).toBe(filtersControl);
      await expect.element(dish).toBeVisible();
      await expect.element(set).toBeVisible();
      await expect.element(page.getByRole("link", { name: "Bakery" })).not.toBeInTheDocument();
      await expect.element(page.getByRole("status")).toHaveTextContent(/^$/);
      const caution = page.getByText("Check the choices for allergens.");
      await expect.element(caution).toBeVisible();
      const price = dish.element().closest(".dish")!.querySelector(".price")!;
      expect(caution.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(
        price.getBoundingClientRect().bottom,
      );
      await expectNoA11yViolations(host);

      await dish.click();
      for (const name of ["Large", "Almond dressing · 0.2 kg"]) {
        expect(page.getByText(name, { exact: true }).element().closest("li")).toHaveTextContent(
          "Contains a selected allergen",
        );
      }
      expect(page.getByText("Large", { exact: true }).element().closest("li")).toHaveTextContent(
        "Cereals containing gluten (Wheat)",
      );
      await expectNoA11yViolations(host);
      await back.click();
      const dishControl = dish.element();
      expect((dishControl.getRootNode() as ShadowRoot).activeElement).toBe(dishControl);

      const setNote = "Ask staff about the choices in this set menu.";
      expect(set.element().closest(".set-menu")).toHaveTextContent(setNote);
      await set.click();
      const setTitle = page.getByRole("heading", { name: "Two courses", exact: true });
      await expect.element(setTitle, { timeout: 1500 }).toBeVisible();
      expect(setTitle.element().parentElement).toHaveTextContent(setNote);
      expect(
        page.getByText("Noodles (Large)", { exact: true }).element().closest("li"),
      ).toHaveTextContent("Contains a selected allergen");
      expect(
        page.getByText("Side salad", { exact: true }).element().closest("li"),
      ).toHaveTextContent("Allergens not reviewed");
      await expectNoA11yViolations(host);
      await back.click();

      await filters.click();
      await diet.click();
      await page.getByRole("option", { name: "Halal", exact: true }).click();
      await close.click();
      const empty = page.getByRole("status").filter({ hasText: "No dishes match these filters." });
      await expect.element(empty).toBeVisible();
      await expect.element(empty).toHaveTextContent(/^No dishes match these filters\.$/);
      expect(parseFloat(getComputedStyle(empty.element()).marginBlockStart)).toBeGreaterThan(0);
      await expect.element(set).toBeVisible();

      await search.fill("two courses");
      await expect.element(set).toBeVisible();
      await expect
        .element(page.getByText("No dishes match your search and filters."))
        .toBeVisible();
      const filterStatus = page.getByRole("status").filter({
        hasText: "No dishes match your search and filters.",
      });
      await expect
        .element(filterStatus)
        .toHaveTextContent(/^No dishes match your search and filters\.$/);
      await expectNoA11yViolations(host);

      await filters.click();
      await page.getByRole("button", { name: "Clear filters" }).click();
      await close.click();
      await expect.element(search).toHaveValue("two courses");
      await search.fill("");
      await expect.element(page.getByRole("button", { name: "House bread" })).toBeVisible();
    },
    30_000,
  );

  it("puts dish allergens and diets under their own headings", async () => {
    const preview = published();
    const section = preview.menu.members[1]!;
    if (section.kind !== "section") throw new Error("Expected the oven section");
    const dish = section.members[0]!;
    if (dish.kind !== "product") throw new Error("Expected a dish");
    dish.allergens = { fish: {}, eggs: {} };
    dish.dietary = ["halal"];
    await openMenu(preview.menu);
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
    expect.soft(betweenEntries).toBeGreaterThanOrEqual(14);
    expect.soft(betweenEntries).toBeLessThanOrEqual(18);
    expect.soft(betweenEntries).toBeGreaterThan(1.8 * (labelStart - icon.right));
    await expect.element(diets, { timeout: 1000 }).toBeVisible();
    expect(diets.element().nextElementSibling?.textContent?.trim()).toBe("Halal");
  });

  it("shows an extra's allergen beside its name and again in Allergens", async () => {
    await openMenu(published().menu);
    await page.getByRole("button", { name: "Roast pepper", exact: true }).click();
    const sides = page.getByRole("heading", { name: "Sides" }).element().nextElementSibling!;
    const allergen = page.getByRole("img", { name: "Nuts (Almonds)", exact: true });
    await expect.element(allergen, { timeout: 1000 }).toBeVisible();
    const extraName = allergen.element().closest("li")!.firstElementChild!;
    expect(extraName.textContent).toContain("Almond dressing");
    expect(extraName.contains(allergen.element())).toBe(true);
    const summaryEntry = page.getByText("Almond dressing: Almonds", { exact: true });
    await expect.element(summaryEntry).toBeVisible();
    const summaryIcon = summaryEntry.getByRole("img", { name: "Nuts", exact: true });
    await expect.element(summaryIcon, { timeout: 1000 }).toBeVisible();
    const muted = getComputedStyle(summaryEntry.element()).color;
    const extraGlyph = allergen.element().shadowRoot!.querySelector("path")!;
    const summaryGlyph = summaryIcon.element().shadowRoot!.querySelector("path")!;
    expect.soft(getComputedStyle(extraGlyph).fill).toBe(muted);
    expect.soft(getComputedStyle(summaryGlyph).fill).toBe(muted);
    expect.soft(muted).not.toBe(getComputedStyle(extraName).color);
    const baseline = document.createElement("span");
    baseline.style.cssText = "display:inline-block;width:0;height:0";
    allergen.element().parentElement!.before(baseline);
    const glyph = extraGlyph.getBoundingClientRect();
    const line = baseline.getBoundingClientRect();
    expect.soft(Math.abs(glyph.bottom - line.bottom)).toBeLessThanOrEqual(1.5);
    const name = Array.from(extraName.childNodes).find((node) =>
      node.textContent?.includes("Almond dressing"),
    )!;
    const nameRange = document.createRange();
    nameRange.selectNodeContents(name);
    const gap = glyph.left - nameRange.getBoundingClientRect().right;
    expect.soft(gap).toBeGreaterThanOrEqual(8);
    expect(gap).toBeLessThanOrEqual(12);
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
      { ...extra, name: "Bread", portion: "1.000", unit: "ptn", servingUnit: "Portion" },
      { ...extra, name: "Salad", portion: "2.000", unit: "ptn", servingUnit: "Portion" },
      { ...extra, portion: "1.000" },
      { ...extra, name: "Oil", portion: "0.250", unit: "l" },
    ];

    await openMenu(preview.menu);
    await page.getByRole("button", { name: dish.name, exact: true }).click();
    const names = page.getByRole("heading", { name: sides.name }).element().nextElementSibling!;
    expect(Array.from(names.children, (row) => row.firstElementChild?.textContent?.trim())).toEqual(
      ["Bread", "Salad · 2 × Portion", "Almond dressing · 1 kg", "Oil · 0,25 l"],
    );
  });

  it("shows set-menu focus rings when opened or closed with the keyboard", async () => {
    const { customer } = await openMenu(published().menu, "dark");
    const cardTitle = page.getByRole("button", { name: "Two courses", exact: true });
    const detailTitle = page.getByRole("heading", { name: "Two courses", exact: true });
    const back = page.getByRole("button", { name: "Back to menu" });
    await expect.element(cardTitle).toBeVisible();
    await cardTitle.click();
    await back.click();
    await expect.element(cardTitle).toBeVisible();
    const button = cardTitle.element();
    expect(customer.shadowRoot!.activeElement).toBe(button);
    expect.soft(getComputedStyle(button).outlineStyle).toBe("none");

    await userEvent.keyboard("{Enter}");
    await expect.element(detailTitle).toBeVisible();
    expect(customer.shadowRoot!.activeElement).toBe(detailTitle.element());
    expect(getComputedStyle(detailTitle.element()).outlineStyle).toBe("solid");
    await userEvent.tab({ shift: true });
    await userEvent.keyboard("{Enter}");
    await expect.element(cardTitle, { timeout: 1000 }).toBeVisible();
    expect(customer.shadowRoot!.activeElement).toBe(button);
    expect(getComputedStyle(button).outlineStyle).toBe("solid");

    await cardTitle.click();
    await expect.element(detailTitle).toBeVisible();
    expect(customer.shadowRoot!.activeElement).toBe(detailTitle.element());
    expect(getComputedStyle(detailTitle.element()).outlineStyle).toBe("none");
  });

  it.each(["House bread", "Two courses"])(
    "keeps Menu aligned and close to the photo-free %s heading",
    async (entry) => {
      await openMenu(published().menu);
      await page.getByRole("button", { name: entry, exact: true }).click();

      const title = page.getByRole("heading", { name: entry, exact: true }).element();
      const menu = page.getByRole("button", { name: "Back to menu" }).element();
      const chevron = menu.querySelector("wt-icon")!.shadowRoot!.querySelector("path")!;
      const chevronLeft = chevron.getBoundingClientRect().left;
      expect
        .soft(Math.abs(chevronLeft - title.getBoundingClientRect().left))
        .toBeLessThanOrEqual(3);
      expect(chevronLeft - menu.getBoundingClientRect().left).toBeGreaterThan(8);

      await document.fonts.ready;
      const menuText = document.createRange();
      menuText.selectNodeContents(menu.querySelector("slot")!.assignedNodes()[0]!);
      const titleText = document.createRange();
      titleText.selectNodeContents(title);
      const gap = titleText.getBoundingClientRect().top - menuText.getBoundingClientRect().bottom;
      expect.soft(gap).toBeGreaterThanOrEqual(10);
      expect(gap).toBeLessThanOrEqual(25);
    },
  );

  it("paints allergen and diet icons in the same muted colour as the dish description", async () => {
    const preview = published();
    const section = preview.menu.members[1]!;
    if (section.kind !== "section") throw new Error("Expected a section");
    const pepper = section.members[0]!;
    if (pepper.kind !== "product") throw new Error("Expected a dish");
    pepper.allergens = { gluten: { kinds: ["wheat"] } };
    pepper.dietary = ["vegan"];
    const { customer } = await openMenu(preview.menu);
    const allergen = page.getByRole("img", { name: "Cereals containing gluten (Wheat)" });
    const diet = page.getByRole("img", { name: "Vegan" });
    await expect.element(allergen).toBeVisible();
    await expect.element(diet).toBeVisible();
    const description = page.getByText("Wood-fired with olive oil", { exact: true }).first();
    const muted = getComputedStyle(description.element()).color;
    const dish = page.getByText("Roast pepper", { exact: true }).element();
    expect(muted).not.toBe(getComputedStyle(dish).color);
    expect(getComputedStyle(allergen.element()).color).toBe(muted);
    expect(getComputedStyle(diet.element()).color).toBe(muted);

    await page.getByRole("button", { name: "Roast pepper", exact: true }).click();
    await expect.element(page.getByRole("heading", { name: "Dietary declarations" })).toBeVisible();
    const detail = customer.shadowRoot!.querySelector(".detail")!;
    const detailDiet = detail.querySelector("div.declarations wt-icon[name='diet-vegan']")!;
    expect(getComputedStyle(detailDiet).color).toBe(getComputedStyle(detail).color);
  });

  it("searches displayed dish and set-menu names without losing focus or the allergen key", async () => {
    await openMenu(publishedSections().menu);
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

  it.each(["document", "preview"] as const)(
    "jumps and tracks the active section in the %s scroll area",
    async (surface) => {
      const preview = surface === "preview";
      await page.viewport(preview ? 390 : 1200, 650);
      const canvas = preview ? document.createElement("div") : undefined;
      if (canvas) canvas.style.cssText = "height: 590px; overflow-y: auto";
      const { customer } = await openMenu(publishedSections().menu, "light", !preview, canvas);
      const scroller = canvas ?? document.scrollingElement!;
      const first = page.getByRole("link", { name: "From the oven", exact: true }).first();
      await expect.element(first).toHaveAttribute("aria-current", "location");
      const rail = first.element().closest("nav")!;
      const second = page.getByRole("link", { name: "From the oven", exact: true }).nth(1);
      const heading = page.getByRole("heading", { name: "From the oven", exact: true }).nth(1);
      const address = location.href;
      second.element().focus();
      const docTop = document.scrollingElement!.scrollTop;
      await userEvent.keyboard("{Enter}");
      expect(customer.shadowRoot!.activeElement).toBe(heading.element());
      expect(scroller.scrollTop).toBeGreaterThan(0);
      if (preview) expect(document.scrollingElement!.scrollTop).toBe(docTop);
      expect(location.href).toBe(address);
      const gap =
        heading.element().getBoundingClientRect().top - rail.getBoundingClientRect().bottom;
      expect(Math.abs(gap - parseFloat(getComputedStyle(rail).marginBlockEnd))).toBeLessThanOrEqual(
        1,
      );
      await expect.element(second).toHaveAttribute("aria-current", "location");

      scroller.scrollTop = scroller.scrollHeight;
      const last = page.getByRole("link", { name: "Desserts and coffee" });
      await expect.element(last).toHaveAttribute("aria-current", "location");
      if (preview) expect(rail.scrollWidth).toBeGreaterThan(rail.clientWidth);
      const bounds = rail.getBoundingClientRect();
      const active = last.element().getBoundingClientRect();
      expect(active.left).toBeGreaterThanOrEqual(bounds.left - 1);
      expect(active.right).toBeLessThanOrEqual(bounds.left + rail.clientWidth + 1);

      scroller.scrollTop = 0;
      await expect.element(first).toHaveAttribute("aria-current", "location");
      const garden = page.getByRole("link", { name: "From the garden" });
      garden.element().focus({ preventScroll: true });
      await userEvent.keyboard("{Enter}");
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      expect.soft(garden.element()).toHaveAttribute("aria-current", "location");
      scroller.scrollTop = 0;
      await expect.element(first).toHaveAttribute("aria-current", "location");
    },
  );

  it("returns to a dish without a description in the preview scroll area", async () => {
    await page.viewport(390, 650);
    const { menu } = publishedSections();
    const section = menu.members.at(-1)!;
    if (section.kind !== "section") throw new Error("Expected a section");
    const bread = section.members[0]!;
    if (bread.kind !== "product") throw new Error("Expected a dish");
    bread.description = "";
    const canvas = document.createElement("div");
    canvas.style.cssText = "height: 400px; overflow-y: auto";
    const { customer } = await openMenu(menu, "light", false, canvas);
    const dish = page.getByRole("button", { name: bread.name, exact: true }).element();
    dish.scrollIntoView({ block: "center" });
    dish.focus({ preventScroll: true });
    const top = canvas.scrollTop;
    expect(top).toBeGreaterThan(0);
    await userEvent.keyboard("{Enter}");
    const title = page.getByRole("heading", { name: bread.name, exact: true });
    await expect.element(title).toBeVisible();
    expect(canvas.scrollTop).toBeLessThan(top);
    expect(
      Array.from(title.element().parentElement!.querySelectorAll("p.description")).map(
        (description) => description.textContent?.trim(),
      ),
    ).not.toContain("");
    await page.getByRole("button", { name: "Back to menu" }).click();
    await expect.element(page.getByRole("button", { name: bread.name, exact: true })).toBeVisible();
    expect(canvas.scrollTop).toBe(top);
    expect(customer.shadowRoot!.activeElement).toBe(dish);
  });

  it("keeps the current underline distinct with forced colours", async () => {
    const session = cdp();
    await session.send("Emulation.setEmulatedMedia", {
      features: [{ name: "forced-colors", value: "active" }],
    });
    try {
      await openMenu(publishedSections().menu);
      const links = page.getByRole("link", { name: "From the oven", exact: true });
      await expect.element(links.first()).toHaveAttribute("aria-current", "location");
      expect(getComputedStyle(links.first().element()).borderBottomColor).not.toBe(
        getComputedStyle(links.nth(1).element()).borderBottomColor,
      );
    } finally {
      await session.send("Emulation.setEmulatedMedia", { features: [] });
    }
  });

  it("shows the unit for a price range and prioritises the first dish photo", async () => {
    const answer = published();
    if (answer.state !== "published") throw new Error("Expected a published menu");
    const section = answer.menu.members[1]!;
    if (section.kind !== "section") throw new Error("Expected a section");
    const [first, second] = section.members;
    if (first?.kind !== "product" || second?.kind !== "product")
      throw new Error("Expected two dishes");
    first.unit = "kg";
    second.image = `${"b".repeat(64)}.webp`;

    const { customer } = await openMenu(answer.menu);
    await vi.waitFor(() => {
      const dishes = customer.shadowRoot?.querySelectorAll(".dish");
      expect(dishes).toHaveLength(2);
      expect(dishes![0]!.textContent?.replace(/\s+/g, "")).toContain("€6.50–€8.50/kg");
      const firstPhoto = dishes![0]!.querySelector("img");
      const secondPhoto = dishes![1]!.querySelector("img");
      expect(firstPhoto?.getAttribute("fetchpriority")).toBe("high");
      expect(firstPhoto?.hasAttribute("loading")).toBe(false);
      expect(secondPhoto?.getAttribute("loading")).toBe("lazy");
      expect(secondPhoto?.hasAttribute("fetchpriority")).toBe(false);
    });
  });

  it("shows a single dish price and names an allergen without a subtype", async () => {
    const answer = published();
    if (answer.state !== "published") throw new Error("Expected a published menu");
    const section = answer.menu.members[1]!;
    if (section.kind !== "section") throw new Error("Expected a section");
    const dish = section.members[0]!;
    if (dish.kind !== "product") throw new Error("Expected a dish");
    Object.assign(dish, {
      description: "",
      price: { min: "6.50", max: "6.50" },
      allergens: { milk: {} },
    });

    const { customer } = await openMenu(answer.menu);
    await expect.element(page.getByRole("img", { name: "Milk", exact: true })).toBeVisible();
    const row = customer.shadowRoot!.querySelector(".dish")!;
    expect(row.querySelector(".price")?.textContent?.trim()).toBe("€6.50");
    expect(row.querySelector(".description")).toBeNull();
  });

  it.each(["light", "dark"] as const)(
    "keeps the standalone menu and its details accessible in %s",
    async (theme) => {
      const { customer, host } = await openMenu(published().menu, theme, true);
      const canvas = customer.shadowRoot!.querySelector<HTMLElement>("article")!;
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
        .toBe(getComputedStyle(dish.querySelector("h1")!).color);
      const allergens = page.getByRole("heading", { name: "Allergens", exact: true });
      await expect.element(allergens, { timeout: 1000 }).toBeVisible();
      expect(
        Array.from(allergens.element().nextElementSibling!.children, (entry) =>
          entry.textContent?.trim(),
        ),
      ).toEqual(["Fish", "Almond dressing: Almonds"]);
      const photo = dish.querySelector("img")!;
      const name = dish.querySelector("h1")!.getBoundingClientRect();
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
      const choice = page.getByText("Noodles (Large)", { exact: true });
      await expect
        .element(choice.getByRole("img", { name: "Eggs", exact: true }), { timeout: 1000 })
        .toBeVisible();
      expect(row.textContent?.replace(/\s+/g, " ").trim()).toBe("Noodles (Large) + €2.50");
      expect(getComputedStyle(row).borderBottomWidth).toBe("1px");
      expect(surcharge.element().getBoundingClientRect().right).toBeCloseTo(
        row.getBoundingClientRect().right,
        0,
      );
      const dessert = page.getByRole("heading", { name: "Dessert", exact: true });
      await expect.element(dessert).toBeVisible();
      const setAllergens = page.getByRole("heading", { name: "Allergens", exact: true });
      await expect.element(setAllergens, { timeout: 1000 }).toBeVisible();
      expect(dessert.element().nextElementSibling).toBe(setAllergens.element().parentElement);
      expect(
        Array.from(setAllergens.element().nextElementSibling!.children, (entry) =>
          entry.textContent?.trim(),
        ),
      ).toEqual(["Noodles (Large): Wheat", "Noodles (Large): Eggs"]);
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
