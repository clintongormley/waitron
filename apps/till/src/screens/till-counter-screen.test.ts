import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillCounterScreen } from "./till-counter-screen.js";
import { LAYOUT_A, type LayoutDef } from "../layout.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { currentLocale, t } from "../i18n/t.js";
import type { TillProduct } from "../api/client.js";
import type { TillAllergenScreen } from "./till-allergen-screen.js";
import type { TillProductGrid } from "../widgets/product-grid.js";

const cafe: TillProduct = {
  id: "p1",
  descriptions: { "es-ES": "Café" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
};

const products: TillProduct[] = [cafe];

const mount = (over: Partial<TillCounterScreen> = {}) =>
  mountWidget<TillCounterScreen>("till-counter-screen", {
    store: new WorkingOrderStore(),
    products,
    operatorName: "Ana",
    ...over,
  });

afterEach(cleanupWidgets);

describe("till-counter-screen", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-counter-screen")).toBe(TillCounterScreen);
  });

  it("renders the widgets per LAYOUT_A: product-grid in main, basket/total/tender-pay/held-orders/station-queue in aside", async () => {
    const { el } = await mount();
    const main = el.shadowRoot!.querySelector(".region-main")!;
    const aside = el.shadowRoot!.querySelector(".region-aside")!;

    // product grid fills the main region and appears nowhere else
    expect(main.querySelector("till-product-grid")).not.toBeNull();
    expect(aside.querySelector("till-product-grid")).toBeNull();

    // basket, total, tender-pay, the held-orders list and the (default-station) queue stack in the
    // aside region and nowhere else — the `prep-queue` layout slot now renders the station-queue widget
    expect(aside.querySelector("till-basket")).not.toBeNull();
    expect(aside.querySelector("till-total")).not.toBeNull();
    expect(aside.querySelector("till-tender-pay")).not.toBeNull();
    expect(aside.querySelector("till-held-orders")).not.toBeNull();
    expect(aside.querySelector("till-station-queue")).not.toBeNull();
    expect(main.querySelector("till-basket")).toBeNull();
    expect(main.querySelector("till-total")).toBeNull();
    expect(main.querySelector("till-tender-pay")).toBeNull();
    expect(main.querySelector("till-held-orders")).toBeNull();
    expect(main.querySelector("till-station-queue")).toBeNull();
  });

  it("threads the default station's queue (and station id) through to the station-queue widget as a rail", async () => {
    const stationQueue = [
      {
        orderId: "wo-1",
        orderNumber: 5,
        label: "Mesa 4",
        queuedAt: "2026-08-17T10:00:00.000Z",
        status: "settled" as const,
        items: [
          {
            id: "ti-1",
            workingOrderLineId: "wol-1",
            state: "queued" as const,
            descriptions: { "es-ES": "Paella" },
            quantity: "2.000",
            course: null,
            firedAt: "2026-08-17T10:00:00.000Z",
          },
        ],
      },
    ];
    const { el } = await mount({ stationQueue, defaultStationId: "st-1" });
    const queue = el.shadowRoot!.querySelector("till-station-queue")!;
    expect((queue as unknown as { groups: unknown }).groups).toBe(stationQueue);
    expect((queue as unknown as { view: string }).view).toBe("rail");
    expect((queue as unknown as { stationId: string }).stationId).toBe("st-1");
  });

  it("threads the held-orders list through to the held-orders widget", async () => {
    const heldOrders = [
      {
        id: "wo-1",
        orderNumber: 5,
        label: "Mesa 4",
        itemCount: 2,
        total: "3.00",
        openedAt: "2026-08-05T10:00:00.000Z",
      },
    ];
    const { el } = await mount({ heldOrders });
    const held = el.shadowRoot!.querySelector("till-held-orders")!;
    expect(held.orders).toBe(heldOrders);
  });

  it("is layout-driven: a layout that omits `total` renders no total widget, keeping the rest", async () => {
    const layout: LayoutDef = LAYOUT_A.filter((widget) => widget.type !== "total");
    const { el } = await mount({ layout });
    // the render follows the DATA — drop `total` from the layout and the widget is gone
    expect(el.shadowRoot!.querySelector("till-total")).toBeNull();
    // the widgets the layout still names are all present
    expect(el.shadowRoot!.querySelector("till-product-grid")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("till-basket")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("till-tender-pay")).not.toBeNull();
  });

  it("is layout-driven: an empty layout renders no widgets at all", async () => {
    const { el } = await mount({ layout: [] });
    expect(el.shadowRoot!.querySelector("till-product-grid")).toBeNull();
    expect(el.shadowRoot!.querySelector("till-basket")).toBeNull();
    expect(el.shadowRoot!.querySelector("till-total")).toBeNull();
    expect(el.shadowRoot!.querySelector("till-tender-pay")).toBeNull();
  });

  it("passes the SAME store instance to every widget (they coordinate through one store)", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mount({ store });
    const grid = el.shadowRoot!.querySelector("till-product-grid")!;
    const basket = el.shadowRoot!.querySelector("till-basket")!;
    const total = el.shadowRoot!.querySelector("till-total")!;
    const pay = el.shadowRoot!.querySelector("till-tender-pay")!;
    expect(grid.store).toBe(store);
    expect(basket.store).toBe(store);
    expect(total.store).toBe(store);
    expect(pay.store).toBe(store);
  });

  it("threads cardProvider, tipsEnabled and cardOutcome through to the pay widget (Task 9)", async () => {
    const { el } = await mount({
      cardProvider: "stripe_on_device",
      tipsEnabled: true,
      cardOutcome: "declined",
    });
    const pay = el.shadowRoot!.querySelector("till-tender-pay")!;
    expect(pay.cardProvider).toBe("stripe_on_device");
    expect(pay.tipsEnabled).toBe(true);
    expect(pay.cardOutcome).toBe("declined");
  });

  it("defaults cardProvider 'none'/tipsEnabled false, reproducing the #62 manual path unchanged", async () => {
    const { el } = await mount();
    const pay = el.shadowRoot!.querySelector("till-tender-pay")!;
    expect(pay.cardProvider).toBe("none");
    expect(pay.tipsEnabled).toBe(false);
    expect(pay.cardOutcome).toBeUndefined();
  });

  it("threads a product-grid's `columns` config through to the grid widget (product-grid.columns)", async () => {
    const layout: LayoutDef = [{ type: "product-grid", region: "main", config: { columns: 4 } }];
    const { el } = await mount({ layout });
    const grid = el.shadowRoot!.querySelector<TillProductGrid>("till-product-grid")!;
    expect(grid.columns).toBe(4);
  });

  it("leaves `columns` unset when the product-grid config carries none", async () => {
    const layout: LayoutDef = [{ type: "product-grid", region: "main", config: {} }];
    const { el } = await mount({ layout });
    const grid = el.shadowRoot!.querySelector<TillProductGrid>("till-product-grid")!;
    expect(grid.columns).toBeUndefined();
  });

  it("ignores a non-numeric `columns` config value, leaving the grid's responsive default", async () => {
    // The config bag is `Record<string, unknown>`; the screen narrows `columns` to a number and passes
    // it through only then, so a malformed value can never reach the widget as a bad column count.
    const layout: LayoutDef = [
      { type: "product-grid", region: "main", config: { columns: "four" } },
    ];
    const { el } = await mount({ layout });
    const grid = el.shadowRoot!.querySelector<TillProductGrid>("till-product-grid")!;
    expect(grid.columns).toBeUndefined();
  });

  it("passes the products through to the product grid", async () => {
    const { el } = await mount();
    const grid = el.shadowRoot!.querySelector("till-product-grid")!;
    expect(grid.products).toBe(products);
  });

  it("shows the logged-in operator name in the header", async () => {
    const { el } = await mount({ operatorName: "Bruno" });
    expect(el.shadowRoot!.querySelector(".operator")!.textContent).toContain("Bruno");
  });

  it("labels the Log out control with the localised action", async () => {
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("wt-button.logout")!.textContent).toContain(
      t("action.logout"),
    );
  });

  it("emits a composed logout event when Log out is tapped", async () => {
    const { el } = await mount();
    let captured: Event | undefined;
    el.addEventListener("logout", (event) => (captured = event));
    el.shadowRoot!.querySelector<HTMLElement>("wt-button.logout")!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
  });

  it("labels and emits a composed, bubbling show-schedule event when My schedule is tapped", async () => {
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("wt-button.schedule")!.textContent).toContain(
      t("schedule.open"),
    );
    let captured: Event | undefined;
    el.addEventListener("show-schedule", (event) => (captured = event));
    el.shadowRoot!.querySelector<HTMLElement>("wt-button.schedule")!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("labels and emits a composed, bubbling show-floor event when Sala is tapped (FP-1)", async () => {
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("wt-button.floor")!.textContent).toContain(t("floor.open"));
    let captured: Event | undefined;
    el.addEventListener("show-floor", (event) => (captured = event));
    el.shadowRoot!.querySelector<HTMLElement>("wt-button.floor")!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("labels and emits a composed, bubbling show-expo event when Pass is tapped (KDS-3)", async () => {
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("wt-button.expo")!.textContent).toContain(t("expo.open"));
    let captured: Event | undefined;
    el.addEventListener("show-expo", (event) => (captured = event));
    el.shadowRoot!.querySelector<HTMLElement>("wt-button.expo")!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("labels the Allergens control with the localised action and shows the sale body by default", async () => {
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("wt-button.allergens")!.textContent).toContain(
      t("allergens.open"),
    );
    // Default: the sale body, not the allergen screen.
    expect(el.shadowRoot!.querySelector(".body")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("till-allergen-screen")).toBeNull();
  });

  it("tapping Allergens swaps the sale body for the allergen screen, passing products/locale/invoiceLocale", async () => {
    const { el } = await mount({ invoiceLocale: "en" });
    el.shadowRoot!.querySelector<HTMLElement>("wt-button.allergens")!.click();
    await el.updateComplete;
    const screen = el.shadowRoot!.querySelector<TillAllergenScreen>("till-allergen-screen");
    expect(screen).not.toBeNull();
    // The sale body (product tiles etc.) is gone — the allergen screen is NOT the tiles.
    expect(el.shadowRoot!.querySelector(".body")).toBeNull();
    expect(el.shadowRoot!.querySelector("till-product-grid")).toBeNull();
    // The three inputs the screen needs are threaded through.
    expect(screen!.products).toBe(products);
    expect(screen!.locale).toBe(currentLocale());
    expect(screen!.invoiceLocale).toBe("en");
  });

  it("returns to the sale body when the allergen screen asks to close", async () => {
    const { el } = await mount();
    el.shadowRoot!.querySelector<HTMLElement>("wt-button.allergens")!.click();
    await el.updateComplete;
    const screen = el.shadowRoot!.querySelector("till-allergen-screen")!;
    screen.dispatchEvent(new CustomEvent("close-allergens", { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-allergen-screen")).toBeNull();
    expect(el.shadowRoot!.querySelector(".body")).not.toBeNull();
  });
});
