import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillTableOrderScreen, type TableServiceStatus } from "./till-table-order-screen.js";
import { formatMoney } from "../i18n/format.js";
import { t } from "../i18n/t.js";
import type { TabLine, TillProduct } from "../api/client.js";
import type { TillProductGrid } from "../widgets/product-grid.js";
import type { TillTenderPay } from "../widgets/tender-pay.js";

const cafe: TillProduct = {
  id: "cafe",
  descriptions: { "es-ES": "Café" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
};

const products: TillProduct[] = [cafe];

// Two dos-café lines locked at add-time (1.50 each): line 1 still to serve, line 2 already served.
const pendingLine: TabLine = {
  lineNo: 1,
  productId: "cafe",
  quantity: "2.000",
  unitPriceGross: "1.50",
  servedAt: null,
};
const servedLine: TabLine = {
  lineNo: 2,
  productId: "cafe",
  quantity: "1.000",
  unitPriceGross: "1.50",
  servedAt: "2026-08-20T10:00:00.000Z",
};

const reserved: TableServiceStatus = { id: "s1", label: "Reservada", color: "#cc0000" };

const mount = (over: Partial<TillTableOrderScreen> = {}) =>
  mountWidget<TillTableOrderScreen>("till-table-order-screen", {
    products,
    lines: [],
    statuses: [],
    ...over,
  });

/** The product-grid nested in the screen's shadow (the round-scoped picker). */
const grid = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<TillProductGrid>("till-product-grid")!;
/** The embedded pay widget (only present while the drawer is open). */
const tender = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<TillTenderPay>("till-tender-pay")!;
/** Opens the pull-out tab drawer via its badged handle. */
async function openDrawer(el: TillTableOrderScreen): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe("till-table-order-screen", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-table-order-screen")).toBe(TillTableOrderScreen);
  });

  it("lays out a full-width product grid and a round-scoped basket over ONE round store", async () => {
    const { el } = await mount();
    const productGrid = grid(el);
    const basket = el.shadowRoot!.querySelector("till-basket")!;
    expect(productGrid).not.toBeNull();
    expect(basket).not.toBeNull();
    // The grid gets the catalogue, and the grid + the round basket share the SAME store (the current
    // round) — never the tab's lines.
    expect(productGrid.products).toBe(products);
    expect(productGrid.store).toBe(basket.store);
  });

  it("accumulates a round and emits send-round with the picked lines, then clears the round", async () => {
    const { el } = await mount();
    // Pick a café into the current round (the grid rings an `each` tile straight into its store).
    grid(el).shadowRoot!.querySelector<HTMLElement>("wt-button.tile")!.click();
    await el.updateComplete;

    let captured: CustomEvent | undefined;
    el.addEventListener("send-round", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>("[data-send-round]")!.click();

    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
    expect(captured!.detail.lines).toEqual([{ productId: "cafe", quantity: "1" }]);
    // The round bar is the CURRENT round only — it clears once sent, ready for the next round.
    expect(grid(el).store.lineCount).toBe(0);
  });

  it("disables Enviar ronda while the current round is empty", async () => {
    const { el } = await mount();
    const send = el.shadowRoot!.querySelector("[data-send-round]")!;
    expect(send.hasAttribute("disabled")).toBe(true);
    grid(el).shadowRoot!.querySelector<HTMLElement>("wt-button.tile")!.click();
    await el.updateComplete;
    expect(send.hasAttribute("disabled")).toBe(false);
  });

  it("keeps the tab drawer closed until its handle is tapped", async () => {
    const { el } = await mount({ lines: [pendingLine] });
    expect(el.shadowRoot!.querySelector("[data-drawer]")).toBeNull();
    await openDrawer(el);
    expect(el.shadowRoot!.querySelector("[data-drawer]")).not.toBeNull();
  });

  it("badges the drawer handle with the pending-to-serve count", async () => {
    const { el } = await mount({ lines: [pendingLine, servedLine] });
    // One un-served line ⇒ badge reads 1 (the served line does not count).
    expect(el.shadowRoot!.querySelector("[data-pending-badge]")!.textContent).toContain("1");
  });

  it("hides the badge when nothing is pending", async () => {
    const { el } = await mount({ lines: [servedLine] });
    expect(el.shadowRoot!.querySelector("[data-pending-badge]")).toBeNull();
  });

  it("splits the drawer into Pendiente de servir and Servido lines", async () => {
    const { el } = await mount({ lines: [pendingLine, servedLine] });
    await openDrawer(el);
    // The un-served line carries a Servido tick; the served one does not.
    expect(el.shadowRoot!.querySelector('[data-serve="1"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-serve="2"]')).toBeNull();
    // Both sections are labelled with the Spanish copy the brief prescribes.
    const text = el.shadowRoot!.textContent ?? "";
    expect(text).toContain(t("table.pending_title"));
    expect(text).toContain(t("table.served_title"));
  });

  it("emits serve-line { lineNo } when a Servido tick is tapped", async () => {
    const { el } = await mount({ lines: [pendingLine] });
    await openDrawer(el);
    let captured: CustomEvent | undefined;
    el.addEventListener("serve-line", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>('[data-serve="1"]')!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.detail).toEqual({ lineNo: 1 });
  });

  it("shows the tab total from the LOCKED add-time prices (never a catalogue recompute)", async () => {
    const { el } = await mount({ lines: [pendingLine, servedLine] });
    await openDrawer(el);
    // 2 × 1.50 + 1 × 1.50 = 4.50, summed at money scale from the locked unit prices.
    expect(el.shadowRoot!.querySelector("[data-tab-total]")!.textContent).toContain(
      formatMoney("4.50"),
    );
  });

  it("resolves product names from the catalogue, falling back to the id for an unknown product", async () => {
    const ghost: TabLine = { ...pendingLine, lineNo: 3, productId: "ghost" };
    const { el } = await mount({ lines: [pendingLine, ghost] });
    await openDrawer(el);
    const text = el.shadowRoot!.querySelector("[data-drawer]")!.textContent ?? "";
    expect(text).toContain("Café"); // resolved from the catalogue
    expect(text).toContain("ghost"); // deactivated/unknown product → the raw id
  });

  it("emits pay-tab with the tender when the embedded pay widget confirms, and does NOT leak confirm-payment", async () => {
    const { el } = await mount({ lines: [pendingLine] });
    await openDrawer(el);
    let payTab: CustomEvent | undefined;
    let leaked = false;
    el.addEventListener("pay-tab", (e) => (payTab = e as CustomEvent));
    el.addEventListener("confirm-payment", () => (leaked = true));
    // The tab-pay reuses `tender-pay`; the screen catches its terminal confirm-payment and re-emits it
    // as pay-tab so it reaches the app's tab-pay handler, never the counter's #onConfirmPayment.
    tender(el).dispatchEvent(
      new CustomEvent("confirm-payment", {
        detail: { method: "cash", amount: "10.00" },
        bubbles: true,
        composed: true,
      }),
    );
    expect(payTab).toBeInstanceOf(CustomEvent);
    expect(payTab!.detail).toEqual({ method: "cash", amount: "10.00" });
    expect(leaked).toBe(false);
  });

  it("swallows a Hold (park-order) from the embedded pay widget — a tab cannot be parked", async () => {
    const { el } = await mount({ lines: [pendingLine] });
    await openDrawer(el);
    let leaked = false;
    el.addEventListener("park-order", () => (leaked = true));
    tender(el).dispatchEvent(
      new CustomEvent("park-order", { detail: {}, bubbles: true, composed: true }),
    );
    expect(leaked).toBe(false);
  });

  it("offers a status picker that emits set-status { statusId } and a clear that sends null", async () => {
    const { el } = await mount({ lines: [pendingLine], statuses: [reserved] });
    await openDrawer(el);
    let captured: CustomEvent | undefined;
    el.addEventListener("set-status", (e) => (captured = e as CustomEvent));

    el.shadowRoot!.querySelector<HTMLElement>('[data-status="s1"]')!.click();
    expect(captured!.detail).toEqual({ statusId: "s1" });

    el.shadowRoot!.querySelector<HTMLElement>("[data-status-clear]")!.click();
    expect(captured!.detail).toEqual({ statusId: null });
  });

  it("renders Mover · Dividir disabled (TS-3/TS-5 are out of scope)", async () => {
    const { el } = await mount({ lines: [pendingLine] });
    await openDrawer(el);
    const move = el.shadowRoot!.querySelector("[data-move-split]")!;
    expect(move.textContent).toContain(t("table.move_split"));
    expect(move.hasAttribute("disabled")).toBe(true);
  });

  it("emits a composed, bubbling back-to-floor event from the back control", async () => {
    const { el } = await mount();
    let captured: CustomEvent | undefined;
    el.addEventListener("back-to-floor", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>("[data-back]")!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("handles an empty tab: no badge, empty-state copy, zero total", async () => {
    const { el } = await mount({ lines: [] });
    await openDrawer(el);
    expect(el.shadowRoot!.querySelector("[data-pending-badge]")).toBeNull();
    const text = el.shadowRoot!.querySelector("[data-drawer]")!.textContent ?? "";
    expect(text).toContain(t("table.none_pending"));
    expect(text).toContain(t("table.none_served"));
    expect(el.shadowRoot!.querySelector("[data-tab-total]")!.textContent).toContain(
      formatMoney("0.00"),
    );
  });
});
