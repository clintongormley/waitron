import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { HOME_DISPLAY_DEFAULTS } from "@waitron/catalogue/src/device-home.js";
import type { TillProduct, TillZoneMenu } from "../api/client.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { TillMenuBrowser } from "./menu-browser.js";

afterEach(cleanupWidgets);

const cases = [360, 390].flatMap((width) =>
  [2, 3].flatMap((columns) =>
    (["colours", "thumbnails"] as const).flatMap((tiles) =>
      (["light", "dark"] as const).map((theme) => ({
        width,
        columns,
        tiles,
        theme,
        handheld: true,
        cardColumns: undefined as number | undefined,
        wantedTracks: columns,
      })),
    ),
  ),
);

cases.push(
  ...(["light", "dark"] as const).map((theme) => ({
    width: 1024,
    columns: 4,
    tiles: "colours" as const,
    theme,
    handheld: false,
    cardColumns: undefined,
    wantedTracks: 4,
  })),
);

cases.push(
  ...[360, 390].map((width) => ({
    width,
    columns: 3,
    tiles: "colours" as const,
    theme: "light" as const,
    handheld: true,
    cardColumns: 6,
    wantedTracks: 2,
  })),
);

it.each(cases)(
  "fits $wantedTracks columns at $width px ($tiles, $theme, handheld=$handheld, cardColumns=$cardColumns)",
  async ({ width, columns, tiles, theme, handheld, cardColumns, wantedTracks }) => {
    const locale = currentLocale();
    setLocale("es-ES");
    try {
      await page.viewport(width, 844);
      const products: TillProduct[] = [
        "Pollo asado con patatas y verduras",
        "Extraordinariamenteextralargapalabra",
        "Zumo de naranja recién exprimido",
      ].map((name, index) => ({
        id: `p${index}`,
        productId: `p${index}`,
        menuItemId: `mi${index}`,
        menuVersionId: "v1",
        available: true,
        name,
        customerName: { es: `${name} carta` },
        kitchenName: `${name} cocina`,
        unit: {
          id: "unit-each",
          name: { es: "unidad" },
          abbreviation: { es: "ud" },
          precision: 0,
          hardwareUnit: null,
        },
        unitPrice: "12.50",
        vatClass: "reduced",
        category: null,
        allergens: null,
        image: "photo.svg",
        color: "#256bb1",
      }));
      const members = products.map((product) => ({
        kind: "product" as const,
        productId: product.id,
        menuItemId: product.menuItemId!,
      }));
      const menu: TillZoneMenu = {
        id: "menu",
        name: "Carta",
        isDefault: true,
        orderable: true,
        audience: "customer",
        versionId: "v1",
        structure: {
          members: [
            {
              kind: "section",
              sectionId: "section",
              internalName: "section-internal",
              names: { es: "Bebidas y refrescos de la casa" },
              image: null,
              color: "#b12525",
              members,
            },
            ...members,
          ],
        },
        home: {
          shortcuts: [],
          handheld: { columns, tiles, order: "menu_first" },
          till: { ...HOME_DISPLAY_DEFAULTS.till, columns },
        },
      };
      const { el, host } = await mountWidget<TillMenuBrowser>(
        "till-menu-browser",
        {
          menu,
          products,
          handheld,
          columns: cardColumns,
          store: new WorkingOrderStore(),
        },
        theme,
      );
      host.style.width = `${width}px`;
      host.style.boxSizing = "border-box";
      host.style.paddingInline = "calc(var(--wt-space-5) + var(--wt-space-4))";
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const grid = el.shadowRoot!.querySelector<HTMLElement>(".grid")!;
      for (const image of grid.querySelectorAll<HTMLImageElement>("img")) {
        image.src =
          "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='480'/%3E";
        await image.decode();
      }
      expect(getComputedStyle(grid).gridTemplateColumns.split(" ")).toHaveLength(wantedTracks);
      expect(grid.querySelectorAll(".tile")).toHaveLength(4);
      expect(grid.querySelectorAll("img")).toHaveLength(tiles === "thumbnails" ? 3 : 0);
      for (const tile of grid.querySelectorAll<HTMLElement>(".tile")) {
        const box = tile.getBoundingClientRect();
        expect(box.width).toBeGreaterThanOrEqual(handheld && cardColumns === undefined ? 44 : 104);
        expect(box.height).toBeGreaterThanOrEqual(44);
        for (const content of tile.querySelectorAll<HTMLElement>(
          ".name, .price, .kind, wt-icon, img",
        )) {
          const bounds = content.getBoundingClientRect();
          expect(bounds.left).toBeGreaterThanOrEqual(box.left);
          expect(bounds.right).toBeLessThanOrEqual(box.right);
          expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth + 1);
        }
        if (tile.dataset.kind === "product") {
          expect(tile.querySelector(".price")!.textContent).toContain("12,50");
          const name = tile.querySelector<HTMLElement>(".name")!;
          const canvas = document.createElement("canvas").getContext("2d")!;
          canvas.font = getComputedStyle(name).font;
          const walker = document.createTreeWalker(name, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            for (const match of node.textContent!.matchAll(/\S+/g)) {
              if (canvas.measureText(match[0]).width > name.clientWidth) continue;
              const range = document.createRange();
              range.setStart(node, match.index);
              range.setEnd(node, match.index + match[0].length);
              expect(range.getClientRects().length, match[0]).toBe(1);
            }
          }
        }
      }
      expect(grid.querySelector('[data-kind="section"] wt-icon')).not.toBeNull();
      if (width === 360 && columns === 3) await expectNoA11yViolations(host);
    } finally {
      setLocale(locale);
      await page.viewport(1024, 768);
    }
  },
);
