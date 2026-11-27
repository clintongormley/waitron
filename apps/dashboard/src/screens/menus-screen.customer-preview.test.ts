import { photoReference, published, publishedSections } from "@waitron/customer-menu/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { MenuStatus } from "@waitron/shared";
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

async function open(
  preview: (url: URL) => Response | Promise<Response>,
  theme: Theme = "light",
  readStatus: () => MenuStatus = () => status,
  readOnlineSettings: () => Response | Promise<Response> = () =>
    Response.json({ enabled: false, address: null, photos: "large" }),
) {
  const fetcher = new DashboardApi("", async (input) => {
    const url = new URL(input, location.origin);
    if (url.pathname === path) return preview(url);
    if (url.pathname === "/management-api/menus/lunch/customer-online-settings")
      return readOnlineSettings();
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
    ?.shadowRoot?.querySelector("customer-menu-page");
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

  it.each(["light", "dark"] as const)("previews draft photo sizes in %s", async (theme) => {
    const viewport = [innerWidth, innerHeight] as const;
    await page.viewport(1280, 800);
    try {
      const { el, host } = await open(() => Response.json(published()), theme);
      await expect.element(page.getByRole("heading", { name: "Lunch for guests" })).toBeVisible();
      const photo = () => customerPage(el)?.shadowRoot?.querySelector(".dish img");
      const width = () => photo()?.getBoundingClientRect().width ?? 0;
      const large = width();
      expect(large).toBeGreaterThan(0);
      await page.getByRole("radio", { name: "Small", exact: true }).click();
      await vi.waitFor(() => {
        expect(width()).toBeGreaterThan(0);
        expect(width()).toBeLessThan(large);
      });
      await page.getByRole("radio", { name: "None", exact: true }).click();
      await vi.waitFor(() => expect(photo()).toBeNull());
      await page.getByRole("button", { name: "Roast pepper", exact: true }).click();
      expect(customerPage(el)?.shadowRoot?.querySelector(".detail img")).toBeNull();
      await expectNoA11yViolations(host);
    } finally {
      await page.viewport(...viewport);
    }
  });

  it("waits for the saved photo setting before showing the phone preview", async () => {
    const viewport = [innerWidth, innerHeight] as const;
    const settings = gate<Response>();
    const readPreview = vi.spyOn(DashboardApi.prototype, "getCustomerPreview");
    await page.viewport(390, 800);
    try {
      const { el } = await open(
        () => Response.json(published()),
        "light",
        () => status,
        () => settings.promise,
      );
      const title = page.getByRole("heading", { name: "Lunch for guests" });
      await vi.waitFor(() => expect(readPreview).toHaveBeenCalled());
      await readPreview.mock.results[0]?.value;
      await expect.element(page.getByText("Loading Online settings…")).toBeVisible();
      await new Promise(requestAnimationFrame);
      expect(title.query()).toBeNull();
      settings.resolve(Response.json({ enabled: false, address: null, photos: "none" }));
      await expect.element(title).toBeVisible();
      expect(customerPage(el)?.shadowRoot?.querySelector(".dish img")).toBeNull();
    } finally {
      readPreview.mockRestore();
      settings.resolve(Response.json({ enabled: false, address: null, photos: "none" }));
      await page.viewport(...viewport);
    }
  });

  it("offers Retry in the phone preview when loading settings fails", async () => {
    const viewport = [innerWidth, innerHeight] as const;
    await page.viewport(390, 800);
    try {
      const getSettings = vi
        .fn()
        .mockReturnValueOnce(new Response(null, { status: 503 }))
        .mockImplementation(() =>
          Response.json({ enabled: false, address: null, photos: "large" }),
        );
      const { el } = await open(
        () => Response.json(published()),
        "light",
        () => status,
        getSettings,
      );
      await expect
        .element(page.getByText("Could not load the Online settings."), { timeout: 2000 })
        .toBeVisible();
      await expect.element(page.getByRole("button", { name: "Roast pepper" })).toBeVisible();
      expect(customerPage(el)?.shadowRoot?.querySelector(".dish img")).toBeNull();
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      await vi.waitFor(() =>
        expect(customerPage(el)?.shadowRoot?.querySelector(".dish img")).toBeTruthy(),
      );
    } finally {
      await page.viewport(...viewport);
    }
  });

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
    await expect
      .element(
        page.getByRole("region", { name: "Online preview" }).getByText("Large", { exact: true }),
      )
      .not.toBeInTheDocument();
    await expect
      .element(page.getByText("Almond dressing", { exact: false }))
      .not.toBeInTheDocument();
    const pepper = page.getByText("Roast pepper", { exact: true }).element();
    const bread = page.getByText("House bread", { exact: true }).element();
    const breadDeclarations = bread.closest(".dish")!.querySelector(".declarations")!;
    expect(breadDeclarations.textContent?.trim()).toBe("");
    expect(bread.getBoundingClientRect().left).toBeGreaterThan(pepper.getBoundingClientRect().left);
    const dish = pepper.closest(".dish")!;
    const priceLabel = dish.querySelector(".price")!;
    expect(getComputedStyle(priceLabel).fontSize).toBe(getComputedStyle(pepper).fontSize);
    const price = document.createRange();
    price.selectNodeContents(priceLabel);
    const photo = dish.querySelector("img")!;
    const dishPriceBox = price.getBoundingClientRect();
    const nameBox = pepper.getBoundingClientRect();
    expect(dishPriceBox.top).toBeLessThan(nameBox.bottom);
    expect(dishPriceBox.left).toBeGreaterThan(nameBox.right);
    expect(dishPriceBox.right).toBeCloseTo(photo.getBoundingClientRect().right, 0);
    await page.getByRole("radio", { name: "Phone" }).click();
    await vi.waitFor(() => {
      expect(bread.getBoundingClientRect().left).toBe(pepper.getBoundingClientRect().left);
      expect(bread.getBoundingClientRect().top).toBeGreaterThan(pepper.getBoundingClientRect().top);
    });
    expect(price.getBoundingClientRect().top).toBeGreaterThan(
      dish.querySelector(".description")!.getBoundingClientRect().bottom,
    );
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

  it("distinguishes the menu title, main sections and nested sections on the Phone preview", async () => {
    await open(() => Response.json(publishedSections()));
    await page.getByRole("radio", { name: "Phone" }).click();
    const title = page.getByRole("heading", { name: "Lunch for guests", exact: true });
    const parent = page.getByRole("heading", { name: "From the oven", exact: true }).first();
    const nested = page.getByRole("heading", { name: "Vegetables", exact: true });
    await expect.element(nested).toBeVisible();
    const parentSize = parseFloat(getComputedStyle(parent.element()).fontSize);
    const titleRatio = parseFloat(getComputedStyle(title.element()).fontSize) / parentSize;
    expect(titleRatio).toBeGreaterThanOrEqual(1.4);
    expect(titleRatio).toBeLessThanOrEqual(1.5);
    const dish = page.getByText("Roast pepper", { exact: true }).element();
    expect(parentSize).toBeGreaterThanOrEqual(1.35 * parseFloat(getComputedStyle(dish).fontSize));
    expect(parseFloat(getComputedStyle(nested.element()).fontSize)).toBeLessThan(parentSize);
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
  ] as const)(
    "jumps to sections and tracks scrolling at %i px in %s using the %s scroll area",
    async (width, size, surface) => {
      const viewport = [innerWidth, innerHeight] as const;
      try {
        await page.viewport(width, 800);
        const { el, host } = await open(() => Response.json(publishedSections()));
        host.style.cssText += "height: 700px; container-type: size; overflow-y: auto;";
        const choice = page.getByRole("radio", { name: size });
        await expect.element(choice).toBeVisible();
        if (choice.element().getAttribute("aria-checked") !== "true") await choice.click();
        const first = page.getByRole("link", { name: "From the oven", exact: true }).first();
        await expect.element(first, { timeout: 1000 }).toHaveAttribute("aria-current", "location");
        const last = page.getByRole("link", { name: "Desserts and coffee" });
        const customer = customerPage(el)!;
        const canvas = customer.parentElement!;
        const doc = document.scrollingElement!;
        const scroller = surface === "canvas" ? canvas : host;
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
        expect(doc.scrollTop).toBe(docTop);
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

  it("follows the Computer canvas when it becomes one pixel too narrow", async () => {
    const viewport = [innerWidth, innerHeight] as const;
    try {
      await page.viewport(390, 800);
      const { el, host } = await open(() => Response.json(publishedSections()));
      host.style.cssText += "height: 700px; container-type: size; overflow-y: auto;";
      await page.getByRole("radio", { name: "Computer" }).click();
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

  it("fits the Computer menu beside Settings when the wide dashboard has a narrow preview column", async () => {
    const viewport = [innerWidth, innerHeight] as const;
    try {
      await page.viewport(1280, 800);
      const answer = published();
      const section = answer.menu.members[1]!;
      if (section.kind !== "section") throw new Error("Expected a section");
      const bread = section.members[1]!;
      if (bread.kind !== "product") throw new Error("Expected a dish");
      bread.price = { min: "6.50", max: "6.50" };
      const { el } = await open(() => Response.json(answer));
      await expect.element(page.getByRole("searchbox", { name: "Search dishes" })).toBeVisible();
      const customer = customerPage(el)!;
      const canvas = customer.parentElement!;
      const preview = (canvas.getRootNode() as ShadowRoot).host as HTMLElement;
      preview.style.inlineSize = "620px";
      expect(canvas.scrollWidth).toBe(canvas.clientWidth);
      expect(customer.getBoundingClientRect().right).toBeLessThanOrEqual(
        canvas.getBoundingClientRect().right,
      );
      preview.style.inlineSize = "662px";
      const dish = page.getByRole("button", { name: "House bread", exact: true }).element();
      const price = dish.closest(".dish-heading")!.querySelector(".price")!;
      expect(price.getBoundingClientRect().left).toBeGreaterThan(
        dish.getBoundingClientRect().right,
      );
      expect(price.getBoundingClientRect().top).toBeLessThan(dish.getBoundingClientRect().bottom);
      const searchHost = customer.shadowRoot!.querySelector("wt-input[type=search]")!;
      const input = searchHost.shadowRoot!.querySelector("input")!;
      const style = getComputedStyle(input);
      const metrics = document.createElement("canvas").getContext("2d")!;
      metrics.font = style.font;
      const textWidth = metrics.measureText(input.placeholder).width;
      const available =
        input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      expect(available).toBeGreaterThanOrEqual(textWidth);
    } finally {
      await page.viewport(...viewport);
    }
  });

  it("keeps a short price beside a long name and wraps a large range in the narrow Computer preview", async () => {
    await page.viewport(390, 844);
    try {
      const preview = published();
      if (preview.state !== "published") throw new Error("Expected a published menu");
      const section = preview.menu.members[1]!;
      if (section.kind !== "section") throw new Error("Expected a section");
      const dish = section.members[0]!;
      if (dish.kind !== "product") throw new Error("Expected a dish");
      dish.name = "Wood-roasted peppers with confit garlic";
      dish.price = { min: "1234.50", max: "2345.00" };
      dish.unit = "kg";
      section.members.push({
        ...dish,
        name: "Wood-roasted peppers with olive oil",
        price: { min: "6.50", max: "6.50" },
        unit: "",
        allergens: { milk: {} },
      });
      await open(() => Response.json(preview));
      await page.getByRole("radio", { name: "Computer" }).click();
      const name = page.getByText(dish.name, { exact: true }).element();
      const card = name.closest(".dish")!;
      expect(card.closest("article")!.getBoundingClientRect().width).toBe(720);
      const price = document.createRange();
      price.selectNodeContents(card.querySelector(".price")!);
      expect(price.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        name.getBoundingClientRect().bottom,
      );
      expect(price.getBoundingClientRect().right).toBeCloseTo(
        card.querySelector("img")!.getBoundingClientRect().right,
        0,
      );
      const short = page
        .getByText("Wood-roasted peppers with olive oil", { exact: true })
        .element();
      const shortCard = short.closest(".dish")!;
      price.selectNodeContents(shortCard.querySelector(".price")!);
      expect(price.getBoundingClientRect().top).toBeLessThan(short.getClientRects()[0]!.bottom);
      expect(price.getBoundingClientRect().right).toBeCloseTo(
        shortCard.querySelector("img")!.getBoundingClientRect().right,
        0,
      );
    } finally {
      await page.viewport(1280, 768);
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
    },
  );
});
