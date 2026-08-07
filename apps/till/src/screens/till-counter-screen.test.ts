import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillCounterScreen } from "./till-counter-screen.js";
import { LAYOUT_A, type LayoutDef } from "../layout.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { t } from "../i18n/t.js";
import type { TillProduct } from "../api/client.js";

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

  it("renders the widgets per LAYOUT_A: product-grid in main, basket/total/tender-pay/held-orders/prep-queue in aside", async () => {
    const { el } = await mount();
    const main = el.shadowRoot!.querySelector(".region-main")!;
    const aside = el.shadowRoot!.querySelector(".region-aside")!;

    // product grid fills the main region and appears nowhere else
    expect(main.querySelector("till-product-grid")).not.toBeNull();
    expect(aside.querySelector("till-product-grid")).toBeNull();

    // basket, total, tender-pay, the held-orders list and the prep queue stack in the aside region
    // and nowhere else
    expect(aside.querySelector("till-basket")).not.toBeNull();
    expect(aside.querySelector("till-total")).not.toBeNull();
    expect(aside.querySelector("till-tender-pay")).not.toBeNull();
    expect(aside.querySelector("till-held-orders")).not.toBeNull();
    expect(aside.querySelector("till-prep-queue")).not.toBeNull();
    expect(main.querySelector("till-basket")).toBeNull();
    expect(main.querySelector("till-total")).toBeNull();
    expect(main.querySelector("till-tender-pay")).toBeNull();
    expect(main.querySelector("till-held-orders")).toBeNull();
    expect(main.querySelector("till-prep-queue")).toBeNull();
  });

  it("threads the prep queue through to the prep-queue widget", async () => {
    const prepQueue = [
      {
        id: "wo-1",
        orderNumber: 5,
        label: "Mesa 4",
        state: "queued" as const,
        queuedAt: "2026-08-06T10:00:00.000Z",
      },
    ];
    const { el } = await mount({ prepQueue });
    const queue = el.shadowRoot!.querySelector("till-prep-queue")!;
    expect(queue.entries).toBe(prepQueue);
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
});
