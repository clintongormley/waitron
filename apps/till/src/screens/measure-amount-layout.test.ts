import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { pointerElementsAt } from "@waitron/ui/src/reorder-table.js";
import { DraftStore } from "../state/draft-sync.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, mountWidget, pageAt, resetPage } from "../widgets/test-helpers.js";
import { beer, ham, menuOf } from "./till-table-order-screen.test-helpers.js";
import "./till-counter-screen.js";
import "./till-table-order-screen.js";

afterEach(cleanupWidgets);

it.each(["counter", "table"] as const)(
  "reveals amount entry on a long %s menu at phone width",
  async (surface) => {
    await pageAt(390, 844);
    try {
      const products = Array.from({ length: 41 }, (_, n) => ({
        ...beer,
        id: `item-${n}`,
        menuItemId: `offer-${n}`,
        name: `Menu dish ${n}`,
      }));
      products[3] = { ...ham, menuItemId: ham.menuItemId! };
      const common = { products, menus: menuOf(products) };
      const store = surface === "counter" ? new WorkingOrderStore() : new DraftStore();
      store.addProduct(products[0]!, "1");
      const { el, host } =
        surface === "counter"
          ? await mountWidget<HTMLElementTagNameMap["till-counter-screen"]>("till-counter-screen", {
              ...common,
              store,
            })
          : await mountWidget<HTMLElementTagNameMap["till-table-order-screen"]>(
              "till-table-order-screen",
              {
                ...common,
                orderId: "wo-amount",
                draftStore: store,
              },
            );
      host.style.height = "100vh";
      host.style.overflowY = "auto";
      const menu = el.shadowRoot!.querySelector("till-menu-browser")!;
      await menu.updateComplete;
      const tile = menu.shadowRoot!.querySelectorAll<HTMLElement>(
        'wt-button[data-kind="product"]',
      )[3]!;
      await userEvent.click(tile);
      const panel = (surface === "counter" ? el.shadowRoot : menu.shadowRoot)!.querySelector(
        "till-tender-pay",
      )!;
      await panel.updateComplete;
      const field = panel.shadowRoot!.querySelector("wt-price-input")!;
      await field.updateComplete;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const box = field.getBoundingClientRect();
      expect(pointerElementsAt((box.left + box.right) / 2, (box.top + box.bottom) / 2)).toContain(
        field,
      );
      expect(
        panel.shadowRoot!.querySelector(".add")!.getBoundingClientRect().bottom,
      ).toBeLessThanOrEqual(innerHeight);
      if (surface === "table") {
        const tileBox = tile.getBoundingClientRect();
        expect(tileBox.top).toBeGreaterThanOrEqual(0);
        expect(tileBox.bottom).toBeLessThanOrEqual(panel.getBoundingClientRect().top);
      }
    } finally {
      await resetPage();
    }
  },
);
