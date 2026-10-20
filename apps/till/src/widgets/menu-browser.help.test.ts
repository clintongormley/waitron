import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "lit";
import { setHelpMode } from "@waitron/ui";
import type { WtHelpTooltip } from "@waitron/ui";
import { HOME_DISPLAY_DEFAULTS } from "@waitron/catalogue/src/device-home.js";
import type { TillProduct, TillZoneMenu } from "../api/client.js";
import { helpEn, helpEs } from "../i18n/help-strings.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { TillMenuBrowser } from "./menu-browser.js";
import "./menu-browser.js";
import { helpBadge } from "./help-badge.js";

const locale = currentLocale();
afterEach(() => {
  setHelpMode(false);
  cleanupWidgets();
  setLocale(locale);
});

const dish: TillProduct = {
  id: "dish",
  productId: "dish",
  menuItemId: "offer",
  menuVersionId: "version",
  name: "Staff soup",
  customerName: { en: "Customer soup" },
  kitchenName: "Kitchen soup",
  unitPrice: "3.00",
  vatClass: "general",
  category: null,
  allergens: null,
};
const menu: TillZoneMenu = {
  id: "menu",
  name: "Lunch",
  versionId: "version",
  isDefault: true,
  orderable: true,
  sendable: true,
  audience: "customer",
  structure: { members: [{ kind: "product", productId: "dish", menuItemId: "offer" }] },
  home: {
    shortcuts: [],
    till: HOME_DISPLAY_DEFAULTS.till,
    handheld: HOME_DISPLAY_DEFAULTS.handheld,
  },
};

async function mount(lang = "en") {
  setLocale(lang);
  const store = new WorkingOrderStore();
  const { el } = await mountWidget<TillMenuBrowser>("till-menu-browser", {
    menu,
    products: [dish],
    store,
  });
  const search = el.shadowRoot!.querySelector<HTMLElement>('[data-region="search"] wt-input')!;
  return { el, store, search };
}

const badgeOf = (search: HTMLElement) =>
  search.querySelector<WtHelpTooltip>('wt-help-tooltip[slot="help"]');

describe("the dishes' help on the menu browser", () => {
  it("with help on the search field has a badge", async () => {
    setHelpMode(true);
    const { search } = await mount();
    const badge = badgeOf(search)!;
    await badge.updateComplete;
    expect(badge.mode).toBe("help-mode");
    expect(badge.getAttribute("aria-label")).toBe(
      helpEn["help.badge_label"].replace("{part}", t("menu.search")),
    );
    expect(badge.textContent).toBe(helpEn["help.menu.dishes"]);
    expect(badge.getBoundingClientRect().width).toBeGreaterThan(0);
  });

  it("with help off it has none and takes no room", async () => {
    const { search } = await mount();
    const badge = badgeOf(search)!;
    await badge.updateComplete;
    expect(badge.getBoundingClientRect().width).toBe(0);
    const row = search.shadowRoot!.querySelector<HTMLElement>(".row")!;
    const field = search.shadowRoot!.querySelector<HTMLElement>(".field")!;
    expect(field.getBoundingClientRect().width).toBe(row.getBoundingClientRect().width);
  });

  it.each([
    { lang: "en", text: helpEn, href: "/help/en/products#nutrition-at-the-till" },
    { lang: "es", text: helpEs, href: "/help/es/products#nutrition-at-the-till" },
  ])(
    "its box links to /help/en/products#nutrition-at-the-till, and in Spanish to /help/es/… ($lang)",
    async ({ lang, text, href }) => {
      setHelpMode(true);
      const { search } = await mount(lang);
      const badge = badgeOf(search)!;
      await badge.updateComplete;
      expect(badge.textContent).toBe(text["help.menu.dishes"]);
      await userEvent.click(badge.shadowRoot!.querySelector("button")!);
      const link = badge.shadowRoot!.querySelector<HTMLAnchorElement>('[part="guide"]')!;
      expect(link.getAttribute("href")).toBe(href);
      expect(link.textContent).toBe(text["help.guide_link"]);
    },
  );

  it("a tap on a dish still adds it with help on", async () => {
    setHelpMode(true);
    const { el, store } = await mount();
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>('[data-kind="product"]')!);
    expect(store.lines).toHaveLength(1);
  });

  it("a badge given no guide and no slot draws no link and takes the default slot", async () => {
    setHelpMode(true);
    setLocale("en");
    const host = document.createElement("div");
    document.body.append(host);
    try {
      render(helpBadge("help.menu.dishes", "Search"), host);
      const badge = host.querySelector<WtHelpTooltip>("wt-help-tooltip")!;
      await badge.updateComplete;
      expect(badge.hasAttribute("slot")).toBe(false);
      expect(badge.hasAttribute("guide-href")).toBe(false);
      expect(badge.hasAttribute("guide-label")).toBe(false);
      await userEvent.click(badge.shadowRoot!.querySelector("button")!);
      expect(badge.shadowRoot!.querySelector('[part="guide"]')).toBeNull();
    } finally {
      host.remove();
    }
  });
});
