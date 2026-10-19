import { afterEach, describe, expect, it } from "vitest";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, mountWidget, servedMenus } from "../widgets/test-helpers.js";
import { t } from "../i18n/t.js";
import "./till-counter-screen.js";
import type { TillCounterScreen } from "./till-counter-screen.js";
import type { TillMenuBrowser } from "../widgets/menu-browser.js";
import type { DietProfile, TillProduct, TillZoneMenu } from "../api/client.js";
afterEach(cleanupWidgets);

function dish(key: string, name: string, menuId: string, extra: Partial<TillProduct> = {}) {
  return {
    id: `p-${key}`,
    productId: `p-${key}`,
    menuItemId: `mi-${menuId}-${key}`,
    catalogueId: menuId,
    available: true,
    name,
    unitPrice: "2.00",
    vatClass: "general",
    category: null,
    allergens: null,
    ...extra,
  } satisfies TillProduct;
}

const vegan: DietProfile = { vegan: "yes", vegetarian: "yes", contains: [] };
const meaty: DietProfile = { vegan: "no", vegetarian: "no", contains: ["meat"] };

const salad = dish("salad", "Salad", "lunch", { diet: vegan });
const steak = dish("steak", "Steak", "lunch", { diet: meaty });
const wine = dish("wine", "Wine", "drinks", { diet: vegan });
const beer = dish("beer", "Beer", "drinks", { diet: vegan });

/** With `chosen`, the menu's shortcuts are both its dishes; without, it has none. */
function served(id: string, products: TillProduct[], chosen: boolean, isDefault = false) {
  // The meat dish sits alone in its own section, so a lens that hides it empties the section.
  const [first, second] = products.map((each) => ({
    id: each.menuItemId!,
    menuId: id,
    productId: each.productId!,
  }));
  const menu = { id, name: id, isDefault, versionId: `${id}-v1` };
  return servedMenus([menu], [first!, { ...second!, section: `${id} mains` }], {
    shortcuts: chosen,
  })[0]! satisfies TillZoneMenu;
}

const lunchMenu = served("lunch", [salad, steak], true, true);
const drinksMenu = served("drinks", [wine, beer], false);

async function mountBrowser(props: Partial<TillCounterScreen> = {}) {
  const { el } = await mountWidget<TillCounterScreen>("till-counter-screen", {
    store: new WorkingOrderStore(),
    menus: [lunchMenu, drinksMenu],
    products: [salad, steak, wine, beer],
    selectedMenuId: "lunch",
    ...props,
  });
  const browser = () => el.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!;
  await browser().updateComplete;
  return { el, browser };
}

function shownNames(browser: TillMenuBrowser, region: string): string[] {
  return [
    ...browser.shadowRoot!.querySelectorAll(`[data-region="${region}"] wt-button[data-kind] .name`),
  ].map((name) => name.textContent!.trim());
}

describe("fixed Counter menu browser", () => {
  it("hides products in a closed zone even while the department's period runs", async () => {
    const { el } = await mountWidget<TillCounterScreen>("till-counter-screen", {
      store: new WorkingOrderStore(),
      menus: [lunchMenu],
      products: [salad, steak],
      selectedMenuId: "lunch",
      service: {
        open: true,
        zoneOpen: false,
        periodName: "Lunch",
        periodOccurrenceKey: '["department","2026-10-12","Lunch","08:00"]',
        keepOpen: null,
        zoneKeepOpen: null,
      },
    });
    expect(el.shadowRoot!.querySelector("till-menu-browser")).toBeNull();
    el.service = {
      open: true,
      zoneOpen: true,
      periodName: "Lunch",
      periodOccurrenceKey: '["department","2026-10-12","Lunch","08:00"]',
      keepOpen: null,
      zoneKeepOpen: null,
    };
    await el.updateComplete;
    const browser = el.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!;
    expect(browser).not.toBeNull();
    await browser.updateComplete;
    expect(shownNames(browser, "shortcuts")).toEqual(["Salad", "Steak"]);
  });

  it("shows the selected menu, only that menu's products, and hands it the store", async () => {
    const store = new WorkingOrderStore();
    const { browser } = await mountBrowser({ store });
    expect(browser().menu).toBe(lunchMenu);
    expect(browser().products).toEqual([salad, steak]);
    expect(browser().store).toBe(store);
    expect(shownNames(browser(), "shortcuts")).toEqual(["Salad", "Steak"]);
  });

  it("switching menus shows the other menu with its own Device Home Page", async () => {
    const { el, browser } = await mountBrowser();
    el.selectedMenuId = "drinks";
    await el.updateComplete;
    await browser().updateComplete;
    expect(browser().menu).toBe(drinksMenu);
    expect(browser().products).toEqual([wine, beer]);
    // Drinks' Device Home Page holds no shortcuts.
    expect(shownNames(browser(), "shortcuts")).toEqual([]);
    expect(shownNames(browser(), "structure")).toEqual(["Wine", "drinks mains"]);
  });

  it("shows the zone's default menu when the selected one is not among the menus", async () => {
    // Listed second, so the first menu is not mistaken for the default.
    const { browser } = await mountBrowser({
      menus: [drinksMenu, lunchMenu],
      selectedMenuId: "gone",
    });
    expect(browser().menu).toBe(lunchMenu);
    expect(browser().products).toEqual([salad, steak]);
  });

  it("uses the menu's display for each device kind", async () => {
    const menu = {
      ...lunchMenu,
      home: {
        ...lunchMenu.home,
        till: { ...lunchMenu.home.till, columns: 8 },
        handheld: { ...lunchMenu.home.handheld, columns: 2 },
      },
    };
    const { el, browser } = await mountBrowser({ menus: [menu, drinksMenu] });
    const columns = () =>
      getComputedStyle(browser().shadowRoot!.querySelector(".grid")!)
        .getPropertyValue("--columns")
        .trim();
    expect(columns()).toBe("8");
    expect(browser().handheld).toBe(false);
    el.handheld = true;
    await el.updateComplete;
    await browser().updateComplete;
    expect(columns()).toBe("2");
    expect(browser().handheld).toBe(true);
  });

  it("hides a product the diet lens rejects, and greys in place a section it leaves with nothing", async () => {
    const { browser } = await mountBrowser({ selectedFilters: { diets: ["vegan"], exclude: {} } });
    expect(browser().products).toEqual([salad]);
    expect(browser().unfilteredProducts).toEqual([salad, steak]);
    expect(shownNames(browser(), "structure")).toEqual(["Salad", "lunch mains"]);
    const mains = browser().shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      '[data-region="structure"] wt-button[data-kind="section"]',
    )!;
    expect(mains.disabled).toBe(true);
    expect(mains.hasAttribute("data-filtered")).toBe(true);
    expect(browser().shadowRoot!.textContent).not.toContain("Steak");
  });

  it("hands the browser the same products, filtered and unfiltered, while nothing it reads changes", async () => {
    const { el, browser } = await mountBrowser();
    const first = browser().products;
    const firstUnfiltered = browser().unfilteredProducts;
    el.busy = true;
    await el.updateComplete;
    expect(browser().products).toBe(first);
    expect(firstUnfiltered).toBeDefined();
    expect(browser().unfilteredProducts).toBe(firstUnfiltered);
  });

  describe("search across the served menus", () => {
    async function search(browser: TillMenuBrowser, text: string): Promise<void> {
      const input = browser
        .shadowRoot!.querySelector("wt-input")!
        .shadowRoot!.querySelector("input")!;
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      await browser.updateComplete;
    }

    function groups(browser: TillMenuBrowser) {
      return [
        ...browser.shadowRoot!.querySelectorAll<HTMLElement>(
          '[data-region="results"] section[data-menu]',
        ),
      ].map((group) => ({
        menu: group.dataset.menu,
        heading: group.querySelector("h3")!.textContent!.trim(),
        names: [...group.querySelectorAll("wt-button[data-kind] .name")].map((name) =>
          name.textContent!.trim(),
        ),
      }));
    }

    it("shows another served menu's matches in a group of their own", async () => {
      const { browser } = await mountBrowser();
      await search(browser(), "e");
      expect(groups(browser())).toEqual([
        {
          menu: "lunch",
          heading: t("menu.results_this_menu").replace("{menu}", () => "lunch"),
          names: ["Steak"],
        },
        { menu: "drinks", heading: "drinks", names: ["Beer", "Wine"] },
      ]);
    });

    it("leaves a product the diet lens rejects out of another menu's group", async () => {
      // Drinks shown, so Lunch, which holds the one meat dish, is the other menu.
      const { el, browser } = await mountBrowser({ selectedMenuId: "drinks" });
      await search(browser(), "a");
      expect(groups(browser()).find((group) => group.menu === "lunch")?.names).toEqual([
        "Salad",
        "Steak",
        "lunch mains",
      ]);
      el.selectedFilters = { diets: ["vegan"], exclude: {} };
      await el.updateComplete;
      await browser().updateComplete;
      expect(groups(browser()).find((group) => group.menu === "lunch")?.names).toEqual([
        "Salad",
        "lunch mains",
      ]);
      const disabled = browser().shadowRoot!.querySelector<HTMLElement>(
        '[data-menu="lunch"] wt-button[data-filtered]',
      )!;
      expect(disabled.shadowRoot!.querySelector("button")!.disabled).toBe(true);
    });
  });
});

it("A461 Counter forwards unfiltered served offers through both menu diet results", async () => {
  const meatyBeer = { ...beer, diet: meaty };
  const { browser } = await mountBrowser({
    selectedFilters: { diets: ["vegan"], exclude: {} },
    products: [salad, steak, wine, meatyBeer],
  });
  const source = browser() as TillMenuBrowser & { unfilteredServedProducts: TillProduct[] };
  expect(source.servedProducts).toEqual([salad, wine]);
  expect(source.unfilteredServedProducts).toEqual([salad, steak, wine, meatyBeer]);
});

describe("the pay card's Cash and Card while the basket's pay controls are held", () => {
  async function mountHeld(busy: boolean) {
    const store = new WorkingOrderStore();
    store.addProduct(dish("cafe", "Café", "lunch"), "1");
    const { el } = await mountWidget<TillCounterScreen>("till-counter-screen", {
      store,
      payHeld: true,
      busy,
      menus: servedMenus([{ id: "lunch", name: "Lunch", versionId: "v1", isDefault: true }], []),
    });
    const pay = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "till-tender-pay",
    )!;
    await pay.updateComplete;
    return ["pay", "pay-card"].map((name) =>
      pay.shadowRoot!.querySelector(`.${name}`)!.getAttribute("variant"),
    );
  }

  it("draws them grey with a line rung up", async () => {
    expect(await mountHeld(false)).toEqual(["secondary", "secondary"]);
  });

  it("keeps them blue while a payment is being sent", async () => {
    expect(await mountHeld(true)).toEqual(["primary", "primary"]);
  });
});
