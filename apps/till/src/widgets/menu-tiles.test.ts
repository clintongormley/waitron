import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { DEFAULT_HOME_ORDER, type DocumentMember } from "@waitron/shared";
import { EACH_UNIT_ID } from "@waitron/menu/src/unit-validation.js";
import { daily } from "../../test/set-menu-widgets.js";
import { WorkingOrderStore } from "../state/working-order.js";
import {
  cleanupWidgets,
  loadPhoneFont,
  mountWidget,
  pageAt,
  PHONE_FONT,
  resetPage,
  type Mounted,
} from "./test-helpers.js";
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

const red: DocumentMember = {
  kind: "section",
  sectionId: "sec-red",
  internalName: "red-internal",
  names: { en: "Starters" },
  image: null,
  color: "#b12525",
  members: [member("bravas")],
};

const emptied: DocumentMember = {
  kind: "section",
  sectionId: "sec-emptied",
  internalName: "emptied-internal",
  names: { en: "Cheeses" },
  image: null,
  color: "#256bb1",
  members: [member("manchego")],
};

const bravas = product("bravas", "Bravas");
const croquettes = product("croq", "Croquettes", { color: "#256bb1" });
const gone = product("gone", "Squid", { available: false });
const paintedGone = product("pgone", "Prawns", { available: false, color: "#256bb1" });
const manchego = product("manchego", "Manchego");

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
      red,
      member("bravas"),
      member("croq"),
      member("gone"),
      member("pgone"),
      emptied,
      { kind: "set_menu", menuId: daily.menuId, name: daily.name },
    ],
  },
  home: { shortcuts: [], order: DEFAULT_HOME_ORDER },
};

/** Draws `mounted` in a phone's font, so a check of what fits measures the tiles rather than the
 * machine's own `system-ui`. */
async function inPhoneFont(
  mounted: Promise<Mounted<TillMenuBrowser>>,
): Promise<Mounted<TillMenuBrowser>> {
  const shown = await mounted;
  shown.host.style.setProperty("--wt-font-family", PHONE_FONT);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(getComputedStyle(shown.el).fontFamily).toBe(PHONE_FONT);
  return shown;
}

async function mount(width: number, props: Partial<TillMenuBrowser> = {}) {
  await page.viewport(width, 900);
  return inPhoneFont(
    mountWidget<TillMenuBrowser>("till-menu-browser", {
      menu,
      products: [bravas, croquettes, gone, paintedGone],
      unfilteredProducts: [bravas, croquettes, gone, paintedGone, manchego],
      setMenuCopies: [{ copy: daily, versionId: "lunch" }],
      store: new WorkingOrderStore(),
      ...props,
    }),
  );
}

function tile(el: TillMenuBrowser, name: string): HTMLElement {
  const found = [
    ...el.shadowRoot!.querySelectorAll<HTMLElement>('[data-region="structure"] wt-button.tile'),
  ].find((each) => each.querySelector(".name")!.textContent!.trim() === name);
  if (!found) throw new Error(`no tile named ${name}`);
  return found;
}

const face = (tile: HTMLElement) => tile.shadowRoot!.querySelector("button")!;
const badge = (tile: HTMLElement) => tile.querySelector<HTMLElement>("[data-in-order-count]");

/** What a token resolves to in the tile's own context, read through a probe that uses it. */
function resolved(near: HTMLElement, property: "backgroundColor" | "color", value: string) {
  const probe = document.createElement("span");
  probe.style[property] = value;
  near.parentElement!.appendChild(probe);
  const read = getComputedStyle(probe)[property];
  probe.remove();
  return read;
}

/** After the next paint, so anything worked out from a drawn size is in place. */
const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));

afterEach(() => cleanupWidgets());

let phoneFont: FontFace;
beforeAll(async () => {
  phoneFont = await loadPhoneFont();
});
afterAll(() => {
  document.fonts.delete(phoneFont);
});

const ALL = ["Starters", "Bravas", "Croquettes", "Squid", "Prawns", "Cheeses", "Daily menu"];

describe("menu tiles", () => {
  it.each([
    { width: 390, height: 76 },
    { width: 719, height: 76 },
    { width: 720, height: 84 },
    { width: 1280, height: 84 },
  ])("every tile is $height px tall at $width px", async ({ width, height }) => {
    const { el } = await mount(width);
    for (const name of ALL)
      expect(tile(el, name).getBoundingClientRect().height, name).toBe(height);
  });

  it("draws tiles 8 apart with 8 px corners, the name bold at the medium size and the price small", async () => {
    const { el } = await mount(390);
    const dish = tile(el, "Bravas");
    const grid = getComputedStyle(dish.closest(".grid")!);
    expect(grid.columnGap).toBe("8px");
    expect(grid.rowGap).toBe("8px");
    expect(getComputedStyle(face(dish)).borderTopLeftRadius).toBe("8px");
    const name = getComputedStyle(dish.querySelector(".name")!);
    expect(name.fontSize).toBe("14px");
    expect(name.fontWeight).toBe("600");
    expect(getComputedStyle(dish.querySelector(".price")!).fontSize).toBe("12px");
  });

  it("never paints a section tile, even when its section has a colour", async () => {
    const { el } = await mount(390);
    for (const name of ["Starters", "Cheeses"]) {
      const section = tile(el, name);
      expect(section.hasAttribute("data-painted"), name).toBe(false);
      expect(section.hasAttribute("style"), name).toBe(false);
    }
    const section = tile(el, "Starters");
    const look = getComputedStyle(face(section));
    expect(look.backgroundColor).toBe(
      resolved(section, "backgroundColor", "var(--wt-color-surface)"),
    );
    expect(look.borderTopColor).toBe(resolved(section, "color", "var(--wt-color-border)"));
    expect(look.color).toBe(resolved(section, "color", "var(--wt-color-text)"));
    expect(getComputedStyle(section.querySelector("wt-icon")!).color).toBe(
      resolved(section, "color", "var(--wt-color-text-muted)"),
    );
    // The dish beside it keeps its venue colour.
    expect(getComputedStyle(face(tile(el, "Croquettes"))).backgroundColor).toBe(
      "rgb(37, 107, 177)",
    );
  });

  it.each([390, 1280])(
    "puts the count 6 px outside the tile's top and end edges, clear of the name and inside the grid, at %i px",
    async (width) => {
      const { el } = await mount(width, {
        inOrder: new Map([
          ["p-bravas", 2],
          ["p-croq", 12],
        ]),
      });
      for (const [name, shown] of [
        ["Bravas", "2"],
        ["Croquettes", "12"],
      ] as const) {
        const dish = tile(el, name);
        const count = badge(dish)!;
        expect(count.localName).toBe("wt-count-badge");
        expect(count.shadowRoot!.textContent!.trim(), name).toBe(shown);
        expect(count.getAttribute("tone")).toBe("notice");
        expect(count.getAttribute("aria-hidden")).toBe("true");
        const box = count.getBoundingClientRect();
        const outer = dish.getBoundingClientRect();
        expect(box.width, name).toBeGreaterThan(0);
        expect(box.top, name).toBeCloseTo(outer.top - 6, 1);
        expect(box.right, name).toBeCloseTo(outer.right + 6, 1);
        const lines = document.createRange();
        lines.selectNodeContents(dish.querySelector(".name")!);
        for (const line of lines.getClientRects()) {
          const apart =
            box.right <= line.left ||
            line.right <= box.left ||
            box.bottom <= line.top ||
            line.bottom <= box.top;
          expect(apart, name).toBe(true);
        }
        const grid = dish.closest(".grid")!.getBoundingClientRect();
        expect(box.top, name).toBeGreaterThanOrEqual(grid.top);
        expect(box.right, name).toBeLessThanOrEqual(grid.right);
        const pill = getComputedStyle(count.shadowRoot!.querySelector("[part=badge]")!);
        expect(pill.boxShadow, name).toBe(
          `${resolved(dish, "color", "var(--wt-color-bg)")} 0px 0px 0px 2px`,
        );
      }
    },
  );

  it.each(
    [390, 1280].flatMap((width) =>
      [100, 130].flatMap((scale) => [9, 12, 100].map((count) => ({ width, scale, count }))),
    ),
  )(
    "keeps a long counted name clear of a count of $count and its ring, centred, at $width px and $scale% text",
    async ({ width, scale, count }) => {
      const full = "Grilled octopus with smoked paprika, roasted potatoes and garlic oil";
      try {
        await pageAt(width, 900, scale);
        const { el } = await inPhoneFont(
          mountWidget<TillMenuBrowser>("till-menu-browser", {
            menu: { ...menu, structure: { members: [member("long"), member("bravas")] } },
            products: [product("long", full), bravas],
            store: new WorkingOrderStore(),
            inOrder: new Map([["p-long", count]]),
          }),
        );
        await nextPaint();
        const dish = tile(el, full);
        const name = dish.querySelector<HTMLElement>(".name")!;
        const pill = getComputedStyle(badge(dish)!.shadowRoot!.querySelector("[part=badge]")!);
        const ring = parseFloat(pill.boxShadow.split(" ").at(-1)!);
        expect(ring).toBeGreaterThan(0);
        const box = badge(dish)!.getBoundingClientRect();
        const drawn = new DOMRect(
          box.left - ring,
          box.top - ring,
          box.width + 2 * ring,
          box.height + 2 * ring,
        );
        const own = name.getBoundingClientRect();
        const words = document.createRange();
        words.selectNodeContents(name);
        const shown = [...words.getClientRects()].filter((line) => line.top < own.bottom);
        expect(new Set(shown.map((line) => Math.round(line.top))).size).toBe(2);
        for (const line of shown) {
          const overlap = Math.min(line.right, drawn.right) - Math.max(line.left, drawn.left);
          const apart = overlap <= 0 || drawn.bottom <= line.top || line.bottom <= drawn.top;
          expect(apart, `line overlaps the count by ${overlap.toFixed(1)} px`).toBe(true);
        }
        // However the words wrap, no line can reach past the name's padding.
        const look = getComputedStyle(name);
        const textRight = own.right - parseFloat(look.paddingRight);
        expect(
          textRight <= drawn.left || drawn.bottom <= own.top,
          `the name's text room overlaps the count by ${(textRight - drawn.left).toFixed(1)} px`,
        ).toBe(true);
        const outer = dish.getBoundingClientRect();
        const first = shown[0]!;
        expect(
          Math.abs((first.left + first.right) / 2 - (outer.left + outer.right) / 2),
        ).toBeLessThan(1);
        expect(Math.abs((own.left + own.right) / 2 - (outer.left + outer.right) / 2)).toBeLessThan(
          1,
        );
        const grid = dish.closest(".grid")!.getBoundingClientRect();
        expect(drawn.top).toBeGreaterThanOrEqual(grid.top);
        expect(drawn.right).toBeLessThanOrEqual(grid.right);
        if (scale === 100) expect(outer.height).toBe(width < 720 ? 76 : 84);
      } finally {
        cleanupWidgets();
        await resetPage();
      }
    },
  );

  it.each([
    { width: 390, height: 76 },
    { width: 1280, height: 84 },
  ])(
    "cuts a long name to two lines at $width px, keeping the tile $height px and its whole name for screen readers",
    async ({ width, height }) => {
      const full = "Grilled octopus with smoked paprika, roasted potatoes and garlic oil";
      const long = product("long", full);
      const { el } = await mount(width, {
        menu: { ...menu, structure: { members: [member("long"), member("bravas")] } },
        products: [long, bravas],
        inOrder: new Map([["p-long", 3]]),
      });
      const dish = tile(el, full);
      const name = dish.querySelector<HTMLElement>(".name")!;
      const oneLine = tile(el, "Bravas").querySelector<HTMLElement>(".name")!;
      const lineHeight = oneLine.getBoundingClientRect().height;
      expect(name.getBoundingClientRect().height).toBeLessThanOrEqual(2 * lineHeight + 0.5);
      expect(name.getBoundingClientRect().height).toBeGreaterThan(lineHeight * 1.5);
      expect(name.scrollHeight).toBeGreaterThan(name.clientHeight);
      expect(name.textContent).toBe(full);
      expect(getComputedStyle(name).webkitLineClamp).toBe("2");
      expect(getComputedStyle(dish.querySelector(".price")!).display).not.toBe("none");
      expect(dish.querySelector(".price")!.getBoundingClientRect().height).toBeGreaterThan(0);
      expect(dish.getBoundingClientRect().height).toBe(height);
      await expect
        .element(page.elementLocator(face(dish)))
        .toHaveAccessibleName(`${full} ${dish.querySelector(".price")!.textContent} , 3 unsent`);
    },
  );

  it.each([
    { width: 390, height: 76 },
    { width: 720, height: 84 },
  ])(
    "keeps a counted two-line or long name clear of its count at $width px, the tile staying $height px",
    async ({ width, height }) => {
      const twoLine = product("two", "Mediterranean vegetables");
      const long = product(
        "long",
        "Grilled octopus with smoked paprika, roasted potatoes and garlic oil",
      );
      for (const dish of [twoLine, long]) {
        const { el } = await mount(width, {
          menu: { ...menu, structure: { members: [member(dish.id.slice(2))] } },
          products: [dish],
          inOrder: new Map([[dish.id, 12]]),
        });
        await nextPaint();
        const shown = tile(el, dish.name);
        const box = badge(shown)!.getBoundingClientRect();
        const lines = document.createRange();
        lines.selectNodeContents(shown.querySelector(".name")!);
        for (const line of lines.getClientRects()) {
          const apart =
            box.right <= line.left ||
            line.right <= box.left ||
            box.bottom <= line.top ||
            line.bottom <= box.top;
          expect(apart, dish.name).toBe(true);
        }
        const outer = shown.getBoundingClientRect();
        const reach = outer.right - box.left;
        expect(box.width, dish.name).toBe(24);
        expect(getComputedStyle(shown.querySelector(".name")!).paddingInlineEnd).toBe(`${reach}px`);
        expect(outer.height, dish.name).toBe(height);
        cleanupWidgets();
      }
    },
  );

  it("gives an uncounted long name the tile's whole inner width, its uncut line centred with equal room each side", async () => {
    const full = "Grilled octopus with smoked paprika, roasted potatoes and garlic oil";
    const { el } = await mount(390, {
      menu: { ...menu, structure: { members: [member("long"), member("bravas")] } },
      products: [product("long", full), bravas],
      inOrder: new Map([["p-bravas", 2]]),
    });
    const plain = tile(el, full);
    const name = plain.querySelector<HTMLElement>(".name")!;
    const own = name.getBoundingClientRect();
    const outer = plain.getBoundingClientRect();
    const words = document.createRange();
    words.selectNodeContents(name);
    const shown = [...words.getClientRects()].filter((line) => line.top < own.bottom);
    expect(new Set(shown.map((line) => Math.round(line.top))).size).toBe(2);
    for (const line of shown) {
      expect(line.left).toBeGreaterThanOrEqual(own.left);
      expect(line.right).toBeLessThanOrEqual(own.right);
    }
    // The first line is never cut, so it shows the room the name keeps on each side.
    const first = shown[0]!;
    expect(Math.abs(first.left - own.left - (own.right - first.right))).toBeLessThan(1);
    expect(Math.abs((first.left + first.right) / 2 - (outer.left + outer.right) / 2)).toBeLessThan(
      1,
    );
    expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth);
    const inner = getComputedStyle(face(plain));
    expect(name.getBoundingClientRect().width).toBeCloseTo(
      face(plain).clientWidth - parseFloat(inner.paddingLeft) - parseFloat(inner.paddingRight),
      1,
    );
  });

  it("keeps no room above an uncounted or a counted name", async () => {
    const { el } = await mount(390, { inOrder: new Map([["p-bravas", 2]]) });
    for (const name of ["Bravas", "Squid"]) {
      const look = getComputedStyle(face(tile(el, name)));
      expect(look.paddingTop, name).toBe(look.paddingBottom);
    }
  });

  it("keeps the sold-out and filtered looks", async () => {
    const { el } = await mount(390);
    for (const name of ["Squid", "Prawns"]) {
      const sold = tile(el, name);
      const look = getComputedStyle(face(sold));
      expect(look.opacity, name).toBe("1");
      expect(look.backgroundColor, name).toBe(
        resolved(sold, "backgroundColor", "var(--wt-color-surface-sunken)"),
      );
      expect(look.color, name).toBe(resolved(sold, "color", "var(--wt-color-text)"));
    }
    expect(getComputedStyle(face(tile(el, "Squid"))).boxShadow).toBe("none");
    expect(getComputedStyle(face(tile(el, "Prawns"))).boxShadow).toContain("rgb(37, 107, 177)");
    const filtered = tile(el, "Cheeses");
    expect(filtered.hasAttribute("data-filtered")).toBe(true);
    expect(face(filtered).disabled).toBe(true);
    expect(Number(getComputedStyle(face(filtered)).opacity)).toBeLessThan(1);
  });
});
