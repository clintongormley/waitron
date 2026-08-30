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
  // Default course = Postres, so the round-course picker pre-selects it for a café line.
  courseId: "postres",
};

const products: TillProduct[] = [cafe];

// The venue's active courses, in display order (KDS-2 §5b) — the picker options + fire id→name source.
const courses = [
  { id: "entrantes", name: "Entrantes", displayOrder: 0 },
  { id: "postres", name: "Postres", displayOrder: 1 },
];

// Two dos-café lines locked at add-time (1.50 each): line 1 still to serve, line 2 already served. Both
// have a null course fired immediately (KDS-2 fields), so they surface no waiter-fire action by default.
const pendingLine: TabLine = {
  lineNo: 1,
  productId: "cafe",
  quantity: "2.000",
  unitPriceGross: "1.50",
  servedAt: null,
  courseId: null,
  firedAt: "2026-08-20T09:59:00.000Z",
};
const servedLine: TabLine = {
  lineNo: 2,
  productId: "cafe",
  quantity: "1.000",
  unitPriceGross: "1.50",
  servedAt: "2026-08-20T10:00:00.000Z",
  courseId: null,
  firedAt: "2026-08-20T09:59:00.000Z",
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

  // ── KDS-2 (§5b): the per-line course picker + the waiter-fire actions ──────────────────────────────

  /** Rings one café into the current round (the grid tile) and returns the per-line course selects. */
  async function ringAndPickers(el: TillTableOrderScreen): Promise<HTMLSelectElement[]> {
    grid(el).shadowRoot!.querySelector<HTMLElement>("wt-button.tile")!.click();
    await el.updateComplete;
    return [...el.shadowRoot!.querySelectorAll<HTMLSelectElement>("[data-round-course]")];
  }

  it("renders a per-line course picker per round line, pre-selecting the product's default course", async () => {
    const { el } = await mount({ courses });
    // No round yet ⇒ no picker.
    expect(el.shadowRoot!.querySelector("[data-round-courses]")).toBeNull();
    const [picker] = await ringAndPickers(el);
    // One select for the one round line, pre-selected to the café's default course (Postres), with an
    // option per active venue course plus the "use default" placeholder.
    expect(picker).not.toBeUndefined();
    expect(picker!.value).toBe("postres");
    const optionValues = [...picker!.options].map((o) => o.value);
    expect(optionValues).toEqual(["", "entrantes", "postres"]);
  });

  it("hides the course picker when the venue has no courses to pick", async () => {
    const { el } = await mount({ courses: [] });
    await ringAndPickers(el);
    expect(el.shadowRoot!.querySelector("[data-round-courses]")).toBeNull();
  });

  it("send-round OMITS courseId for an unoverridden line (the server applies the product default)", async () => {
    const { el } = await mount({ courses });
    await ringAndPickers(el);
    let captured: CustomEvent | undefined;
    el.addEventListener("send-round", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>("[data-send-round]")!.click();
    // No override picked ⇒ the line carries only productId + quantity; the server resolves the product's
    // default course from `<override> ?? product.course_id`.
    expect(captured!.detail.lines).toEqual([{ productId: "cafe", quantity: "1" }]);
  });

  it("send-round threads the picked course OVERRIDE for a line the waiter re-pointed", async () => {
    const { el } = await mount({ courses });
    const [picker] = await ringAndPickers(el);
    // Override the café line from its default (Postres) to Entrantes.
    picker!.value = "entrantes";
    picker!.dispatchEvent(new Event("change"));
    await el.updateComplete;
    let captured: CustomEvent | undefined;
    el.addEventListener("send-round", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>("[data-send-round]")!.click();
    expect(captured!.detail.lines).toEqual([
      { productId: "cafe", quantity: "1", courseId: "entrantes" },
    ]);
  });

  it("picking the default placeholder clears the override back to the product default (omitted)", async () => {
    const { el } = await mount({ courses });
    const [picker] = await ringAndPickers(el);
    picker!.value = "entrantes";
    picker!.dispatchEvent(new Event("change"));
    await el.updateComplete;
    // Back to the "use default" placeholder ⇒ no override sent.
    picker!.value = "";
    picker!.dispatchEvent(new Event("change"));
    await el.updateComplete;
    let captured: CustomEvent | undefined;
    el.addEventListener("send-round", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>("[data-send-round]")!.click();
    expect(captured!.detail.lines).toEqual([{ productId: "cafe", quantity: "1" }]);
  });

  // A held (fired_at null) line of a named course — the tab's food waiting for the waiter to fire it.
  const heldLine: TabLine = {
    lineNo: 3,
    productId: "cafe",
    quantity: "1.000",
    unitPriceGross: "1.50",
    servedAt: null,
    courseId: "postres",
    firedAt: null,
  };

  it("shows a Fire <course> action per HELD course under fire_control='waiter' and emits fire-course", async () => {
    const { el } = await mount({
      lines: [heldLine],
      courses,
      fireControl: "waiter",
      orderId: "wo-9",
    });
    await openDrawer(el);
    const fire = el.shadowRoot!.querySelector<HTMLElement>('[data-fire-course="postres"]');
    expect(fire).not.toBeNull();
    // The action names the course (Marchar Postres).
    expect(fire!.textContent).toContain(t("table.fire_course"));
    expect(fire!.textContent).toContain("Postres");

    let captured: CustomEvent | undefined;
    el.addEventListener("fire-course", (e) => (captured = e as CustomEvent));
    fire!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
    expect(captured!.detail).toEqual({ orderId: "wo-9", courseId: "postres" });
  });

  it("shows NO waiter-fire action under fire_control='kitchen' (the station display owns the fire)", async () => {
    const { el } = await mount({ lines: [heldLine], courses, fireControl: "kitchen" });
    await openDrawer(el);
    expect(el.shadowRoot!.querySelector("[data-fire-section]")).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-fire-course="postres"]')).toBeNull();
  });

  it("shows no waiter-fire action when nothing is held (a fired / null-course line)", async () => {
    // pendingLine has a null course fired immediately ⇒ not held ⇒ no fire action.
    const { el } = await mount({ lines: [pendingLine], courses, fireControl: "waiter" });
    await openDrawer(el);
    expect(el.shadowRoot!.querySelector("[data-fire-section]")).toBeNull();
  });

  // Multi-menu: the round grid shows only the SELECTED menu's products, while a tab line's NAME still
  // resolves against the full product set (a tab may span menus). The app owns the selection.
  describe("multi-menu round grid", () => {
    const foodMenu = { id: "cat-food", name: "Comida", isDefault: true };
    const drinksMenu = { id: "cat-drinks", name: "Bebidas", isDefault: false };
    const bocadillo: TillProduct = {
      ...cafe,
      id: "bocadillo",
      descriptions: { "es-ES": "Bocadillo" },
      courseId: null,
      catalogueId: "cat-food",
      catalogueName: "Comida",
    };
    const cerveza: TillProduct = {
      ...cafe,
      id: "cerveza",
      descriptions: { "es-ES": "Cerveza" },
      courseId: null,
      catalogueId: "cat-drinks",
      catalogueName: "Bebidas",
    };
    const bothMenus = { menus: [foodMenu, drinksMenu], products: [bocadillo, cerveza] };

    const gridNames = (el: TillTableOrderScreen) =>
      [...grid(el).shadowRoot!.querySelectorAll(".name")].map((n) => n.textContent);
    const switcherButtons = (el: TillTableOrderScreen) => [
      ...el
        .shadowRoot!.querySelector("till-menu-switcher")!
        .shadowRoot!.querySelectorAll<HTMLElement>('[data-test^="menu-"]'),
    ];

    it("filters the round grid to the selected menu; removing the filter shows every menu's products", async () => {
      const { el } = await mount({ ...bothMenus, selectedMenuId: "cat-food" });
      // Guard-by-deletion: drop `filterProductsByMenu`'s `.filter` and this drops "Cerveza" in beside Bocadillo.
      expect(gridNames(el)).toEqual(["Bocadillo"]);
      expect(switcherButtons(el).map((b) => b.textContent?.trim())).toEqual(["Comida", "Bebidas"]);

      // Switching the selection (the app updates the prop) re-filters to the other menu.
      el.selectedMenuId = "cat-drinks";
      await el.updateComplete;
      expect(gridNames(el)).toEqual(["Cerveza"]);
    });

    it("resolves a tab line's NAME from the full product set even when its menu is not the one shown", async () => {
      // A cerveza (drinks menu) line on the tab while the FOOD menu is selected: the round grid hides
      // cerveza, but the drawer must still name the line — name resolution reads the full products.
      const cervezaLine: TabLine = { ...pendingLine, lineNo: 3, productId: "cerveza" };
      const { el } = await mount({
        ...bothMenus,
        selectedMenuId: "cat-food",
        lines: [cervezaLine],
      });
      await openDrawer(el);
      expect(gridNames(el)).toEqual(["Bocadillo"]); // grid stays on the selected menu
      expect(el.shadowRoot!.querySelector(".pending-line .name")!.textContent).toContain("Cerveza");
    });
  });
});
