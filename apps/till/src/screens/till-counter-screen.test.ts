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

  it("renders the four widgets per LAYOUT_A: product-grid in main, basket/total/tender-pay in aside", async () => {
    const { el } = await mount();
    const main = el.shadowRoot!.querySelector(".region-main")!;
    const aside = el.shadowRoot!.querySelector(".region-aside")!;

    // product grid fills the main region and appears nowhere else
    expect(main.querySelector("till-product-grid")).not.toBeNull();
    expect(aside.querySelector("till-product-grid")).toBeNull();

    // basket, total and tender-pay stack in the aside region and appear nowhere else
    expect(aside.querySelector("till-basket")).not.toBeNull();
    expect(aside.querySelector("till-total")).not.toBeNull();
    expect(aside.querySelector("till-tender-pay")).not.toBeNull();
    expect(main.querySelector("till-basket")).toBeNull();
    expect(main.querySelector("till-total")).toBeNull();
    expect(main.querySelector("till-tender-pay")).toBeNull();
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
