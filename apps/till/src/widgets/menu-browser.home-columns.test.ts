import { afterEach, expect, it } from "vitest";
import { EACH_UNIT_ID } from "@waitron/menu/src/unit-validation.js";
import { sellingValuesOf, type TillProduct, type TillZoneMenu } from "../api/client.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import {
  cleanupWidgets,
  expectNoA11yViolations,
  mountWidget,
  pageAt,
  resetPage,
} from "./test-helpers.js";
import { TillMenuBrowser } from "./menu-browser.js";

afterEach(cleanupWidgets);

const cases = [
  { width: 360, columns: 3, theme: "light" },
  { width: 390, columns: 3, theme: "dark" },
  { width: 792, columns: 6, theme: "light" },
  { width: 1440, columns: 7, theme: "dark" },
] as const;

it.each(cases.flatMap((size) => [100, 130].map((scale) => ({ ...size, scale }))))(
  "fits $columns automatic columns at $width px and $scale% text",
  async ({ width, columns, theme, scale }) => {
    const locale = currentLocale();
    setLocale("es-ES");
    try {
      await pageAt(width === 792 ? 1280 : width, 844, scale);
      const products: TillProduct[] = [
        "Pollo asado con patatas y verduras",
        "Extraordinariamenteextralargapalabra",
        // Measure centring on words that wrap without a browser-inserted hyphen.
        "Zumo de naranja recién hecho",
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
          staffName: "Staff unit",
          staffAbbreviation: "su",
          id: EACH_UNIT_ID,
          name: { es: "unidad" },
          abbreviation: { es: "ud" },
          precision: 0,
          hardwareUnit: null,
        },
        unitPrice: "12.50",
        vatClass: "reduced",
        category: null,
        allergens: null,
        color: "#256bb1",
      }));
      const measured = products[2]!;
      measured.unit = {
        id: "unit-kg",
        staffName: "Kilogram",
        staffAbbreviation: "kg",
        name: { es: "kg" },
        abbreviation: { es: "kg" },
        precision: 3,
        hardwareUnit: "kg",
      };
      measured.allergens = { milk: {} };
      measured.variants = ["12.50", "85.00"].map((unitPrice, index) => ({
        ...sellingValuesOf(measured),
        id: `v${index}`,
        name: `Size ${index}`,
        unitPrice,
        unitPriceDifference: null,
        available: true,
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
        endedPeriodName: null,
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
          order: "menu_first",
        },
      };
      const { el, host } = await mountWidget<TillMenuBrowser>(
        "till-menu-browser",
        {
          menu,
          products,
          store: new WorkingOrderStore(),
        },
        theme,
      );
      if (width === 792) host.style.width = "792px";
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const grid = el.shadowRoot!.querySelector<HTMLElement>(".grid")!;
      expect(getComputedStyle(grid).gridTemplateColumns.split(" ")).toHaveLength(columns);
      expect(grid.querySelectorAll(".tile")).toHaveLength(4);
      for (const tile of grid.querySelectorAll<HTMLElement>(".tile")) {
        const box = tile.getBoundingClientRect();
        expect(box.width).toBeGreaterThanOrEqual(100);
        expect(box.height).toBeGreaterThanOrEqual(44);
        for (const content of tile.querySelectorAll<HTMLElement>(".name, .price, .kind, wt-icon")) {
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
      const measuredName = [...grid.querySelectorAll(".name")].find(
        (name) => name.textContent === measured.name,
      )!;
      const measuredTile = measuredName.closest(".tile")!.getBoundingClientRect();
      const words = document.createRange();
      words.selectNodeContents(measuredName);
      const lines = [...words.getClientRects()];
      if (width === 390) expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) {
        expect(
          Math.abs(line.left + line.width / 2 - (measuredTile.left + measuredTile.width / 2)),
        ).toBeLessThan(1);
      }
      expect([...grid.querySelectorAll(".price")].map((price) => price.textContent)).toContain(
        "12,50\u00a0€–85,00\u00a0€/kg",
      );
      expect(grid.querySelector('[data-kind="section"] wt-icon')).not.toBeNull();
      if (width === 360) await expectNoA11yViolations(host);
    } finally {
      setLocale(locale);
      await resetPage();
    }
  },
);
