import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillCounterScreen } from "./till-counter-screen.js";
import type { TabDef } from "../layout.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { currentLocale, t } from "../i18n/t.js";
import type { TillProduct } from "../api/client.js";
import type { TillAllergenScreen } from "./till-allergen-screen.js";

const cafe: TillProduct = {
  id: "p1",
  descriptions: { es: "Café" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
};

const products: TillProduct[] = [cafe];

// The `counter` tab the app supplies from the device canvas (SP-B). It carries the sale-critical cards
// the counter must always yield: product-grid, basket, total, tender-pay. The region/widget model is
// gone — the screen renders solely through this tab, delegating its body to `till-card-grid`.
const counterTab: TabDef = {
  key: "counter",
  title: "Counter",
  columns: 12,
  cards: [
    { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
    { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
    { type: "total", colSpan: 4, rowSpan: 1, config: {} },
    { type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} },
  ],
};

const mount = (over: Partial<TillCounterScreen> = {}) =>
  mountWidget<TillCounterScreen>("till-counter-screen", {
    store: new WorkingOrderStore(),
    products,
    counterTab,
    operatorName: "Ana",
    ...over,
  });

/** The card grid the counter delegates its body to (SP-B4). Typed loosely enough to read the props the
 * counter threads into it without importing the class. */
const cardGrid = (el: TillCounterScreen) =>
  el.shadowRoot!.querySelector<
    HTMLElement & {
      updateComplete: Promise<unknown>;
      tab?: TabDef;
      store: unknown;
      products: TillProduct[];
      heldOrders: unknown;
      stationQueue: unknown;
      defaultStationId?: string;
      cardProvider: string;
      tipsEnabled: boolean;
      cardOutcome?: string;
    }
  >("till-card-grid");

afterEach(cleanupWidgets);

describe("till-counter-screen", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-counter-screen")).toBe(TillCounterScreen);
  });

  // SALE-PATH GUARD (SP-B4): a counter tab must ALWAYS yield the four sale-critical cards. The screen
  // delegates the body to `till-card-grid`, so pierce the grid's own shadow root and prove product-grid,
  // basket, total and tender-pay all render. Removing any card from the grid (or breaking the delegation)
  // fails this — the regression the region-model test guarded, carried over to the grid path.
  it("renders the counter tab's sale-critical cards (product-grid/basket/total/tender-pay) via the card grid", async () => {
    const { el } = await mount();
    const grid = cardGrid(el)!;
    expect(grid).not.toBeNull();
    await grid.updateComplete;
    expect(grid.shadowRoot!.querySelector("till-product-grid")).not.toBeNull();
    expect(grid.shadowRoot!.querySelector("till-basket")).not.toBeNull();
    expect(grid.shadowRoot!.querySelector("till-total")).not.toBeNull();
    expect(grid.shadowRoot!.querySelector("till-tender-pay")).not.toBeNull();
  });

  it("threads the counter tab through to the card grid", async () => {
    const { el } = await mount();
    expect(cardGrid(el)!.tab).toBe(counterTab);
  });

  it("renders the grid body and NONE of the legacy region containers (region model removed)", async () => {
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("till-card-grid")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".region-main")).toBeNull();
    expect(el.shadowRoot!.querySelector(".region-aside")).toBeNull();
    expect(el.shadowRoot!.querySelector(".grid-body")).not.toBeNull();
  });

  it("threads the default station's queue (and station id) through to the card grid", async () => {
    const stationQueue = [
      {
        orderId: "wo-1",
        orderNumber: 5,
        label: "Mesa 4",
        queuedAt: "2026-08-17T10:00:00.000Z",
        status: "settled" as const,
        thresholds: { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
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
    const grid = cardGrid(el)!;
    expect(grid.stationQueue).toBe(stationQueue);
    expect(grid.defaultStationId).toBe("st-1");
  });

  it("threads the held-orders list through to the card grid", async () => {
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
    expect(cardGrid(el)!.heldOrders).toBe(heldOrders);
  });

  it("passes the SAME store instance to the card grid (which coordinates the cards through it)", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mount({ store });
    expect(cardGrid(el)!.store).toBe(store);
  });

  it("threads cardProvider, tipsEnabled and cardOutcome through to the card grid (Task 9)", async () => {
    const { el } = await mount({
      cardProvider: "stripe_on_device",
      tipsEnabled: true,
      cardOutcome: "declined",
    });
    const grid = cardGrid(el)!;
    expect(grid.cardProvider).toBe("stripe_on_device");
    expect(grid.tipsEnabled).toBe(true);
    expect(grid.cardOutcome).toBe("declined");
  });

  it("defaults cardProvider 'none'/tipsEnabled false, reproducing the #62 manual path unchanged", async () => {
    const { el } = await mount();
    const grid = cardGrid(el)!;
    expect(grid.cardProvider).toBe("none");
    expect(grid.tipsEnabled).toBe(false);
    expect(grid.cardOutcome).toBeUndefined();
  });

  it("passes the products through to the card grid", async () => {
    const { el } = await mount();
    // With no menu selected and no diet lens, the visible set is the whole product list (same ref).
    expect(cardGrid(el)!.products).toBe(products);
  });

  // ── Menu diet filter (dietary-classification, Task 7) ────────────────────────────────────────
  const veganDish: TillProduct = {
    ...cafe,
    id: "vegan",
    descriptions: { es: "Ensalada" },
    diet: { vegan: "yes", vegetarian: "yes", contains: [] },
  };
  const meatDish: TillProduct = {
    ...cafe,
    id: "meat",
    descriptions: { es: "Chuleta" },
    diet: { vegan: "no", vegetarian: "no", contains: ["meat"] },
  };

  it("shows NO diet filter when no product carries a published diet", async () => {
    const { el } = await mount(); // cafe only — no diet
    expect(el.shadowRoot!.querySelector("till-diet-filter")).toBeNull();
  });

  it("shows the diet filter when some product carries a diet, and narrows the grid to the picked lens", async () => {
    const { el } = await mount({ products: [veganDish, meatDish] });
    const filter = el.shadowRoot!.querySelector("till-diet-filter")!;
    expect(filter).not.toBeNull();
    // Both dishes are handed to the grid before any lens.
    expect(
      cardGrid(el)!
        .products.map((p) => p.id)
        .sort(),
    ).toEqual(["meat", "vegan"]);
    // Pick the vegan lens — the grid is handed only the vegan dish.
    filter.shadowRoot!.querySelector<HTMLElement>('[data-test="diet-filter-vegan"]')!.click();
    await el.updateComplete;
    expect(cardGrid(el)!.products.map((p) => p.id)).toEqual(["vegan"]);
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
    // Default: the sale body (the grid), not the allergen screen.
    expect(el.shadowRoot!.querySelector(".body")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("till-card-grid")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("till-allergen-screen")).toBeNull();
  });

  it("tapping Allergens swaps the sale body for the allergen screen, passing products/locale/invoiceLocale", async () => {
    const { el } = await mount({ invoiceLocale: "en" });
    el.shadowRoot!.querySelector<HTMLElement>("wt-button.allergens")!.click();
    await el.updateComplete;
    const screen = el.shadowRoot!.querySelector<TillAllergenScreen>("till-allergen-screen");
    expect(screen).not.toBeNull();
    // The sale body (the grid) is gone — the allergen screen replaces it.
    expect(el.shadowRoot!.querySelector(".body")).toBeNull();
    expect(el.shadowRoot!.querySelector("till-card-grid")).toBeNull();
    // The three inputs the screen needs are threaded through.
    expect(screen!.products).toBe(products);
    expect(screen!.locale).toBe(currentLocale());
    expect(screen!.invoiceLocale).toBe("en");
  });

  // Per-user-language-preference (Task 9): the header carries the language chooser. The screen only
  // RENDERS it — the chooser's composed `locale-selected` bubbles past to `till-app`, which persists.
  it("renders the language chooser in the header session row", async () => {
    const { el } = await mount();
    const session = el.shadowRoot!.querySelector(".session")!;
    expect(session.querySelector("till-language-chooser")).not.toBeNull();
  });

  it("lets the chooser's locale-selected bubble out composed (the screen does NOT handle it)", async () => {
    const { el } = await mount();
    const spy = vi.fn();
    el.addEventListener("locale-selected", (e) => spy((e as CustomEvent).detail));
    const chooser = el.shadowRoot!.querySelector("till-language-chooser")!;
    chooser.dispatchEvent(
      new CustomEvent("locale-selected", {
        detail: { code: "en-GB" },
        bubbles: true,
        composed: true,
      }),
    );
    expect(spy).toHaveBeenCalledWith({ code: "en-GB" });
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

  it("suppresses its own header when embedded (chrome lives in the shell)", async () => {
    const { el } = await mount({ embedded: true });
    expect(el.shadowRoot!.querySelector(".header")).toBeNull();
    // The sale body still renders — only the header relocates to the shell.
    expect(el.shadowRoot!.querySelector(".body")).not.toBeNull();
  });
});
