import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { DEFAULT_HOME_ORDER, type DocumentMember } from "@waitron/shared";
import { EACH_UNIT_ID } from "@waitron/menu/src/unit-validation.js";
import { daily } from "../../test/set-menu-widgets.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget, type Theme } from "./test-helpers.js";
import "./menu-browser.js";
import type { TillMenuBrowser } from "./menu-browser.js";
import type { TillProduct, TillZoneMenu } from "../api/menu-api.js";

function product(key: string, name: string, extra: Partial<TillProduct> = {}): TillProduct {
  return {
    id: `p-${key}`,
    productId: `p-${key}`,
    menuItemId: `mi-${key}`,
    available: true,
    name,
    pricingUnit: "each",
    unitPrice: "1.50",
    unit: {
      staffName: "Each",
      staffAbbreviation: "ea",
      id: EACH_UNIT_ID,
      name: { en: "Each" },
      abbreviation: { en: "ea" },
      precision: 0,
      hardwareUnit: null,
    },
    category: null,
    allergens: null,
    ...extra,
  };
}

const member = (key: string): DocumentMember => ({
  kind: "product",
  menuItemId: `mi-${key}`,
  productId: `p-${key}`,
});

const section = (key: string, name: string, offered: string): DocumentMember => ({
  kind: "section",
  sectionId: `sec-${key}`,
  internalName: `${key}-internal`,
  names: { en: name },
  image: null,
  color: "#edabab",
  members: [member(offered)],
});

const dishes = {
  plain: product("plain", "Bravas"),
  counted: product("counted", "Croquettes", { color: "#256bb1" }),
  plainCounted: product("plaincounted", "Omelette"),
  soldOut: product("gone", "Squid", { available: false }),
  paintedSoldOut: product("pgone", "Prawns", { available: false, color: "#edabab" }),
  hidden: product("cheese", "Manchego"),
};

const menu: TillZoneMenu = {
  id: "menu-lunch",
  name: "Lunch",
  isDefault: true,
  orderable: true,
  endedPeriodName: null,
  audience: "customer",
  versionId: "v1",
  structure: {
    members: [
      member("plain"),
      member("counted"),
      member("plaincounted"),
      member("gone"),
      member("pgone"),
      section("starters", "Starters", "plain"),
      section("cheeses", "Cheeses", "cheese"),
      { kind: "set_menu", menuId: daily.menuId, name: daily.name },
    ],
  },
  home: { shortcuts: [], order: DEFAULT_HOME_ORDER },
};

afterEach(() => cleanupWidgets());

describe.each(["light", "dark"] as const)("menu tiles (%s)", (theme: Theme) => {
  it.each([390, 1280])(
    "a plain, counted, sold-out, filtered, section and set-menu tile have no violations at %i px",
    async (width) => {
      await page.viewport(width, 900);
      const { plain, counted, plainCounted, soldOut, paintedSoldOut, hidden } = dishes;
      const shown = [plain, counted, plainCounted, soldOut, paintedSoldOut];
      const { el, host } = await mountWidget<TillMenuBrowser>(
        "till-menu-browser",
        {
          menu,
          products: shown,
          unfilteredProducts: [...shown, hidden],
          setMenuCopies: [{ copy: daily, versionId: "lunch" }],
          inOrder: new Map([
            [counted.id, 2],
            [plainCounted.id, 12],
          ]),
          store: new WorkingOrderStore(),
        },
        theme,
      );
      const tiles = [...el.shadowRoot!.querySelectorAll<HTMLElement>("wt-button.tile")];
      const state = (name: string) =>
        tiles.find((tile) => tile.querySelector(".name")!.textContent!.trim() === name)!;
      expect(state("Croquettes").querySelector("[data-in-order-count]")).not.toBeNull();
      expect(state("Omelette").querySelector("[data-in-order-count]")).not.toBeNull();
      expect(state("Squid").hasAttribute("data-sold-out")).toBe(true);
      expect(state("Prawns").hasAttribute("data-painted")).toBe(true);
      expect(state("Cheeses").hasAttribute("data-filtered")).toBe(true);
      expect(state("Starters").dataset.kind).toBe("section");
      expect(state("Daily menu").dataset.kind).toBe("set_menu");
      await expectNoA11yViolations(host);
    },
  );
});
