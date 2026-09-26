import { afterEach, describe, expect, it } from "vitest";
import { formatMoney } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillTableOrderScreen, type TableServiceStatus } from "./till-table-order-screen.js";
import { currentLocale, t } from "../i18n/t.js";
import type { OfferedModifier, TabLine, TableState, TillProduct } from "../api/client.js";
import type { TillProductGrid } from "../widgets/product-grid.js";
import type { TillModifierPicker } from "../widgets/modifier-picker.js";
import type { TillTenderPay } from "../widgets/tender-pay.js";

const cafe: TillProduct = {
  id: "cafe",
  menuItemId: "menu-item-cafe",
  name: "Café",
  customerName: { es: "Café para el cliente" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
  // Default course = Postres, so the round-course picker pre-selects it for a café line.
  courseId: "postres",
};

const jamon: TillProduct = {
  ...cafe,
  id: "jamon",
  menuItemId: "menu-item-jamon",
  name: "Jamón",
  customerName: { es: "Jamón para el cliente" },
  pricingUnit: "weight",
  unitPrice: "20.00",
};

const products: TillProduct[] = [cafe, jamon];

const courses = [
  { id: "entrantes", name: "Entrantes", displayOrder: 0 },
  { id: "postres", name: "Postres", displayOrder: 1 },
];

// Two café lines locked at add-time (1.50 each): line 1 still to serve, line 2 already served. Both have
// a null course fired immediately, so they surface no waiter-fire action by default.
const pendingLine: TabLine = {
  lineNo: 1,
  productId: "cafe",
  quantity: "2.000",
  unitPrecision: 0,
  unitPriceGross: "1.50",
  servedAt: null,
  courseId: null,
  sentAt: "2026-08-20T09:59:00.000Z",
  firedAt: "2026-08-20T09:59:00.000Z",
  state: "queued",
  note: null,
  listId: null,
  menuItemId: null,
  parentProductId: null,
};
const servedLine: TabLine = {
  lineNo: 2,
  productId: "cafe",
  quantity: "1.000",
  unitPrecision: 0,
  unitPriceGross: "1.50",
  servedAt: "2026-08-20T10:00:00.000Z",
  courseId: null,
  sentAt: "2026-08-20T09:59:00.000Z",
  firedAt: "2026-08-20T09:59:00.000Z",
  state: "queued",
  note: null,
  listId: null,
  menuItemId: null,
  parentProductId: null,
};

const reserved: TableServiceStatus = { id: "s1", label: "Reservada", color: "#cc0000" };

const mount = (over: Partial<TillTableOrderScreen> = {}) =>
  mountWidget<TillTableOrderScreen>("till-table-order-screen", {
    products,
    lines: [],
    statuses: [],
    ...over,
  });

const grid = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<TillProductGrid>("till-product-grid")!;
/** Only present while the drawer is open. */
const tender = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<TillTenderPay>("till-tender-pay")!;
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

  it("shows NO diet filter when no product carries a published diet", async () => {
    const { el } = await mount(); // cafe only — no diet
    expect(el.shadowRoot!.querySelector("till-diet-filter")).toBeNull();
  });

  it("shows the diet filter and narrows the round grid to the picked lens", async () => {
    const veganDish: TillProduct = {
      ...cafe,
      id: "vegan",
      menuItemId: "menu-item-vegan",
      name: "Ensalada",
      customerName: { es: "Ensalada para el cliente" },
      diet: { vegan: "yes", vegetarian: "yes", contains: [] },
    };
    const meatDish: TillProduct = {
      ...cafe,
      id: "meat",
      menuItemId: "menu-item-meat",
      name: "Chuleta",
      customerName: { es: "Chuleta para el cliente" },
      diet: { vegan: "no", vegetarian: "no", contains: ["meat"] },
    };
    const { el } = await mount({ products: [veganDish, meatDish] });
    const filter = el.shadowRoot!.querySelector("till-diet-filter")!;
    expect(filter).not.toBeNull();
    expect(
      grid(el)
        .products.map((p) => p.id)
        .sort(),
    ).toEqual(["meat", "vegan"]);
    filter.shadowRoot!.querySelector<HTMLElement>('[data-test="diet-filter-vegan"]')!.click();
    await el.updateComplete;
    expect(grid(el).products.map((p) => p.id)).toEqual(["vegan"]);
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
    expect(captured!.detail.lines).toEqual([{ menuItemId: "menu-item-cafe", quantity: "1" }]);
    // The round bar is the CURRENT round only — it clears once sent, ready for the next round.
    expect(grid(el).store.lineCount).toBe(0);
  });

  it("sends a zone offer by menu-item identity", async () => {
    const offer = { ...cafe, menuItemId: "offer-cafe", productId: cafe.id };
    const { el } = await mount({ products: [offer] });
    grid(el).shadowRoot!.querySelector<HTMLElement>("wt-button.tile")!.click();
    await el.updateComplete;

    let captured: CustomEvent | undefined;
    el.addEventListener("send-round", (event) => (captured = event as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>("[data-send-round]")!.click();

    expect(captured!.detail.lines).toEqual([{ menuItemId: "offer-cafe", quantity: "1" }]);
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
      formatMoney("4.50", currentLocale()),
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

  it("hides the pay section when settlement is disabled (an order-only handheld)", async () => {
    const { el } = await mount({ lines: [pendingLine], canSettle: false });
    await openDrawer(el);
    expect(el.shadowRoot!.querySelector("section.pay")).toBeNull();
    // The total row stays visible — the waiter can see the tab total, just can't take payment.
    expect(el.shadowRoot!.querySelector("[data-tab-total]")).not.toBeNull();
  });

  it("shows the pay section by default (canSettle unset ⇒ the counter/fixed till still pays)", async () => {
    const { el } = await mount({ lines: [pendingLine] });
    await openDrawer(el);
    expect(el.shadowRoot!.querySelector("section.pay")).not.toBeNull();
  });

  it("renders the embedded pay widget with the Card button (a handheld settles cash or manual card)", async () => {
    // The table-order screen threads no `cashOnly`/`cardProvider`, so the embedded pay widget offers
    // BOTH tenders — cash and the manual (datáfono) card.
    const { el } = await mount({ lines: [pendingLine], canSettle: true });
    await openDrawer(el);
    const widget = tender(el);
    await widget.updateComplete;
    expect(widget.shadowRoot!.querySelector(".pay-card")).not.toBeNull();
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

  it("renders an ENABLED Table actions trigger that opens the action menu (TS-3/TS-4)", async () => {
    const { el } = await mount({ lines: [pendingLine] });
    await openDrawer(el);
    const trigger = el.shadowRoot!.querySelector("[data-move-split]")!;
    expect(trigger.textContent).toContain(t("table.actions_title"));
    expect(trigger.hasAttribute("disabled")).toBe(false);
    expect(el.shadowRoot!.querySelector("[data-action-menu]")).toBeNull();
    (trigger as HTMLElement).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-action-menu]")).not.toBeNull();
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

  it("suppresses its own header + Back when embedded, keeping the drawer handle", async () => {
    const { el } = await mount({ embedded: true });
    expect(el.shadowRoot!.querySelector("header.head")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-back]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-open-drawer]")).not.toBeNull(); // body function stays
  });

  it("renders its header + Back when standalone (default)", async () => {
    const { el } = await mount({});
    expect(el.shadowRoot!.querySelector("header.head")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-back]")).not.toBeNull();
  });

  it("handles an empty tab: no badge, empty-state copy, zero total", async () => {
    const { el } = await mount({ lines: [] });
    await openDrawer(el);
    expect(el.shadowRoot!.querySelector("[data-pending-badge]")).toBeNull();
    const text = el.shadowRoot!.querySelector("[data-drawer]")!.textContent ?? "";
    expect(text).toContain(t("table.none_pending"));
    expect(text).toContain(t("table.none_served"));
    expect(el.shadowRoot!.querySelector("[data-tab-total]")!.textContent).toContain(
      formatMoney("0.00", currentLocale()),
    );
  });

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
    // No override picked ⇒ the line carries only menuItemId + quantity; the server resolves the product's
    // default course from `<override> ?? product.course_id`.
    expect(captured!.detail.lines).toEqual([{ menuItemId: "menu-item-cafe", quantity: "1" }]);
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
      { menuItemId: "menu-item-cafe", quantity: "1", courseId: "entrantes" },
    ]);
  });

  it("send-round threads a line's picks as one entry per list, naming products and counts alone", async () => {
    const { el } = await mount();
    // Seed the round store with a line carrying a pick (through the UI the picker produces these);
    // only the list, the product and the count reach the wire — never the display name or price.
    grid(el).store.addProduct(cafe, "1", {
      extras: [
        {
          listId: "list-milk",
          productId: "p-oat",
          name: "Leche de avena",
          price: "0.50",
          quantity: 1,
        },
      ],
    });
    await el.updateComplete;
    let captured: CustomEvent | undefined;
    el.addEventListener("send-round", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>("[data-send-round]")!.click();
    expect(captured!.detail.lines).toEqual([
      {
        menuItemId: "menu-item-cafe",
        quantity: "1",
        extras: [{ listId: "list-milk", picks: [{ productId: "p-oat", quantity: 1 }] }],
      },
    ]);
  });

  it("send-round carries each pick's own per-dish count, and groups two lists separately", async () => {
    const { el } = await mount();
    grid(el).store.addProduct(cafe, "1", {
      extras: [
        {
          listId: "list-extras",
          productId: "p-shot",
          name: "Extra chupito",
          price: "0.50",
          quantity: 2,
        },
        {
          listId: "list-milk",
          productId: "p-oat",
          name: "Leche de avena",
          price: "0.50",
          quantity: 1,
        },
      ],
      options: [{ listId: "list-cooked", labelId: "label-medium" }],
    });
    await el.updateComplete;
    let captured: CustomEvent | undefined;
    el.addEventListener("send-round", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>("[data-send-round]")!.click();
    expect(captured!.detail.lines).toEqual([
      {
        menuItemId: "menu-item-cafe",
        quantity: "1",
        extras: [
          { listId: "list-extras", picks: [{ productId: "p-shot", quantity: 2 }] },
          { listId: "list-milk", picks: [{ productId: "p-oat", quantity: 1 }] },
        ],
        options: [{ listId: "list-cooked", labelId: "label-medium" }],
      },
    ]);
  });

  it("forwards a per-line note set through the round basket's Note affordance on send-round (parity)", async () => {
    const { el } = await mount();
    grid(el).shadowRoot!.querySelector<HTMLElement>("wt-button.tile")!.click();
    await el.updateComplete;

    // Open THAT round line's editor via the basket's Note button and type a note.
    const basket = el.shadowRoot!.querySelector("till-basket")!;
    await (basket as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    basket.shadowRoot!.querySelector<HTMLElement>('[data-test="line-note-button-0"]')!.click();
    await (basket as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    const note = basket.shadowRoot!.querySelector<HTMLTextAreaElement>('[data-test="line-note"]')!;
    note.value = "table 4 — no ice";
    note.dispatchEvent(new Event("input"));
    await el.updateComplete;

    let captured: CustomEvent | undefined;
    el.addEventListener("send-round", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>("[data-send-round]")!.click();
    expect(captured!.detail.lines).toEqual([
      { menuItemId: "menu-item-cafe", quantity: "1", note: "table 4 — no ice" },
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
    expect(captured!.detail.lines).toEqual([{ menuItemId: "menu-item-cafe", quantity: "1" }]);
  });

  async function ringAndHolds(el: TillTableOrderScreen): Promise<HTMLElement[]> {
    grid(el).shadowRoot!.querySelector<HTMLElement>("wt-button.tile")!.click();
    await el.updateComplete;
    return [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-round-hold]")];
  }

  /** Clicks the inner native checkbox: a real `click()` flips `checked` before `change`. */
  async function toggleHold(el: TillTableOrderScreen, sw: HTMLElement): Promise<void> {
    await (sw as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    sw.shadowRoot!.querySelector<HTMLInputElement>("input")!.click();
    await el.updateComplete;
  }

  it("renders a per-line hold toggle per round line, defaulting OFF", async () => {
    const { el } = await mount({ courses });
    // No round yet ⇒ no toggle.
    expect(el.shadowRoot!.querySelector("[data-round-hold]")).toBeNull();
    const [hold] = await ringAndHolds(el);
    // One switch for the one round line, OFF by default (a round line fires unless the waiter holds it).
    expect(hold).not.toBeUndefined();
    expect((hold as HTMLElement & { checked: boolean }).checked).toBe(false);
  });

  it("send-round OMITS hold for an un-held line (the default — the line fires on send)", async () => {
    const { el } = await mount({ courses });
    await ringAndHolds(el);
    let captured: CustomEvent | undefined;
    el.addEventListener("send-round", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>("[data-send-round]")!.click();
    // Hold off ⇒ the line carries no `hold` (never `hold: false`); the server fires it by its course rule.
    expect(captured!.detail.lines).toEqual([{ menuItemId: "menu-item-cafe", quantity: "1" }]);
  });

  it("send-round threads hold: true for a line the waiter held", async () => {
    const { el } = await mount({ courses });
    const [hold] = await ringAndHolds(el);
    // Hold the café line — inserted but not fired.
    await toggleHold(el, hold!);
    let captured: CustomEvent | undefined;
    el.addEventListener("send-round", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>("[data-send-round]")!.click();
    // The course is untouched (no override), so only `hold: true` rides alongside menuItemId + quantity.
    expect(captured!.detail.lines).toEqual([
      { menuItemId: "menu-item-cafe", quantity: "1", hold: true },
    ]);
  });

  it("toggling hold off again clears it back to firing on send (omitted)", async () => {
    const { el } = await mount({ courses });
    const [hold] = await ringAndHolds(el);
    // On, then off — back to the default, so the line carries no `hold` (the WeakMap entry is deleted).
    await toggleHold(el, hold!);
    await toggleHold(el, hold!);
    let captured: CustomEvent | undefined;
    el.addEventListener("send-round", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>("[data-send-round]")!.click();
    expect(captured!.detail.lines).toEqual([{ menuItemId: "menu-item-cafe", quantity: "1" }]);
  });

  // A held (fired_at null) line of a named course — the tab's food waiting for the waiter to fire it.
  // Held still means the round-send already inserted its ticket item (fireLines does this for every
  // parent line, fired or held), so `state` is the fresh-insert "queued", not null.
  const heldLine: TabLine = {
    lineNo: 3,
    productId: "cafe",
    quantity: "1.000",
    unitPriceGross: "1.50",
    servedAt: null,
    courseId: "postres",
    sentAt: null,
    firedAt: null,
    state: "queued",
    note: null,
    listId: null,
    menuItemId: null,
    parentProductId: null,
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

  it("renders an editable course picker for a NOT-yet-fired tab line, bound to its current course", async () => {
    // heldLine: firedAt null, current course Postres ⇒ an editable select bound to it.
    const { el } = await mount({ lines: [heldLine], courses });
    await openDrawer(el);
    const picker = el.shadowRoot!.querySelector<HTMLSelectElement>('[data-line-course="3"]');
    expect(picker).not.toBeNull();
    expect(picker!.value).toBe("postres");
    // The reused picker's options: the no-course placeholder plus one per active venue course.
    expect([...picker!.options].map((o) => o.value)).toEqual(["", "entrantes", "postres"]);
  });

  it("emits set-line-course { lineNo, courseId } when a held tab line is re-pointed", async () => {
    const { el } = await mount({ lines: [heldLine], courses, orderId: "wo-9" });
    await openDrawer(el);
    const picker = el.shadowRoot!.querySelector<HTMLSelectElement>('[data-line-course="3"]')!;
    let captured: CustomEvent | undefined;
    el.addEventListener("set-line-course", (e) => (captured = e as CustomEvent));
    picker.value = "entrantes";
    picker.dispatchEvent(new Event("change"));
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
    expect(captured!.detail).toEqual({ lineNo: 3, courseId: "entrantes" });
  });

  it("clears a held tab line's course to null when the no-course placeholder is picked", async () => {
    const { el } = await mount({ lines: [heldLine], courses });
    await openDrawer(el);
    const picker = el.shadowRoot!.querySelector<HTMLSelectElement>('[data-line-course="3"]')!;
    let captured: CustomEvent | undefined;
    el.addEventListener("set-line-course", (e) => (captured = e as CustomEvent));
    // The "" placeholder is the explicit no-course null (setLineCourse takes `string | null`).
    picker.value = "";
    picker.dispatchEvent(new Event("change"));
    expect(captured!.detail).toEqual({ lineNo: 3, courseId: null });
  });

  it("shows a FIRED tab line's course READ-ONLY, offering no editable picker", async () => {
    // A fired line (firedAt set) is corrected via recall, not moved here.
    const firedWithCourse: TabLine = { ...pendingLine, lineNo: 1, courseId: "postres" };
    const { el } = await mount({ lines: [firedWithCourse], courses });
    await openDrawer(el);
    expect(el.shadowRoot!.querySelector('[data-line-course="1"]')).toBeNull();
    const stat = el.shadowRoot!.querySelector('[data-line-course-static="1"]');
    expect(stat).not.toBeNull();
    expect(stat!.textContent).toContain("Postres");
  });

  it("shows a fired line's course as 'no course' when it has none, and the raw id for a retired course", async () => {
    const noCourse: TabLine = { ...pendingLine, lineNo: 1, courseId: null };
    const retired: TabLine = { ...servedLine, lineNo: 2, courseId: "gone" };
    const { el } = await mount({ lines: [noCourse, retired], courses });
    await openDrawer(el);
    expect(el.shadowRoot!.querySelector('[data-line-course-static="1"]')!.textContent).toContain(
      t("table.course_none"),
    );
    // A course deactivated since the line was rung falls back to its raw id (the retrieve-path philosophy).
    expect(el.shadowRoot!.querySelector('[data-line-course-static="2"]')!.textContent).toContain(
      "gone",
    );
  });

  it("renders no course control at all when the venue has no courses", async () => {
    const { el } = await mount({ lines: [heldLine], courses: [] });
    await openDrawer(el);
    expect(el.shadowRoot!.querySelector('[data-line-course="3"]')).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-line-course-static="3"]')).toBeNull();
  });

  describe("send / recall / cancel line actions (C5)", () => {
    // A line the kitchen has already STARTED (fired + preparing/ready) — the cancel-only case.
    const preparingLine: TabLine = { ...pendingLine, lineNo: 1, state: "preparing" };
    const readyLine: TabLine = { ...pendingLine, lineNo: 1, state: "ready" };
    // A CHILD EXTRAS line, in the shape the tab wire really sends one: it carries the PICKED product
    // and names its parent dish by line number, which is the ONLY field telling the two
    // apart. It has no ticket item of its own, so firedAt AND state are both null — the shape whose
    // null firedAt would wrongly fall into the HELD/Send branch, and whose held shape would paint an
    // editable course picker, if the child guard were absent. A fixture with `productId: null` would
    // pass against a screen that still read a null product as "child", so it carries one on purpose.
    const childLine: TabLine = {
      lineNo: 2,
      productId: "cafe",
      parentLineNo: 1,
      quantity: "1.000",
      unitPriceGross: "0.50",
      servedAt: null,
      courseId: null,
      sentAt: null,
      firedAt: null,
      state: null,
      note: null,
      listId: null,
      menuItemId: null,
      parentProductId: null,
    };

    it("renders NO per-line action and NO course picker on a child extras line", async () => {
      // Parent (fired + queued) is recallable and shows its read-only course; the child shows neither.
      const { el } = await mount({ lines: [pendingLine, childLine], courses });
      await openDrawer(el);
      expect(el.shadowRoot!.querySelector('[data-recall-line="1"]')).not.toBeNull();
      // The child row: no Send/Recall/Cancel action…
      expect(el.shadowRoot!.querySelector('[data-send-line="2"]')).toBeNull();
      expect(el.shadowRoot!.querySelector('[data-recall-line="2"]')).toBeNull();
      expect(el.shadowRoot!.querySelector('[data-cancel-line="2"]')).toBeNull();
      // …and no course control at all (neither the editable held picker nor the fired static span).
      expect(el.shadowRoot!.querySelector('[data-line-course="2"]')).toBeNull();
      expect(el.shadowRoot!.querySelector('[data-line-course-static="2"]')).toBeNull();
    });

    it("paints a child extras row as belonging to its dish, never as a dish of its own", async () => {
      // A waiter scanning "Pendiente de servir" must not read a pick as another dish. The basket's
      // `.option` rule is the house shape for a pick: indented under its dish and muted. Measured
      // here rather than asserted as a class, because a class the stylesheet has no rule for paints
      // nothing.
      const { el } = await mount({ lines: [pendingLine, childLine], courses });
      await openDrawer(el);
      const rows = [...el.shadowRoot!.querySelectorAll<HTMLElement>(".pending-line")];
      expect(rows).toHaveLength(2);
      const dish = getComputedStyle(rows[0]!);
      const child = getComputedStyle(rows[1]!);
      expect(parseFloat(child.paddingLeft)).toBeGreaterThan(parseFloat(dish.paddingLeft));
      expect(child.color).not.toBe(dish.color);
      expect(parseFloat(child.fontSize)).toBeLessThan(parseFloat(dish.fontSize));
    });

    it("hides Send all on a fully-fired tab that merely contains a modifier'd dish (child excluded)", async () => {
      // pendingLine: firedAt set (fired). childLine: firedAt null, so it is the held-LOOKING row — but
      // it is not held. HONEST about what this pins: on the real wire a child never has a ticket item,
      // so `state === null` refuses it here whether or not the parent-marker guard is in place. The
      // guard itself is pinned by the course-picker assertion in the test above, which flips.
      const { el } = await mount({ lines: [pendingLine, childLine], courses });
      await openDrawer(el);
      expect(el.shadowRoot!.querySelector("[data-send-all]")).toBeNull();
    });

    it("shows Send on a HELD line and emits send-lines { lineNos: [lineNo] }", async () => {
      // heldLine: firedAt null ⇒ HELD ⇒ the Send action (release it to the kitchen).
      const { el } = await mount({ lines: [heldLine], courses });
      await openDrawer(el);
      const send = el.shadowRoot!.querySelector<HTMLElement>('[data-send-line="3"]');
      expect(send).not.toBeNull();
      // A held line is neither recallable nor cancellable — it is not fired yet.
      expect(el.shadowRoot!.querySelector('[data-recall-line="3"]')).toBeNull();
      expect(el.shadowRoot!.querySelector('[data-cancel-line="3"]')).toBeNull();

      let captured: CustomEvent | undefined;
      el.addEventListener("send-lines", (e) => (captured = e as CustomEvent));
      send!.click();
      expect(captured).toBeInstanceOf(CustomEvent);
      expect(captured!.composed).toBe(true);
      expect(captured!.bubbles).toBe(true);
      expect(captured!.detail).toEqual({ lineNos: [3] });
    });

    it("renders NO Send on a PARENT line with no ticket item (firedAt null, state null)", async () => {
      // A moved/merged line or an openTab-initial line: a real dish (productId set) that was re-inserted
      // or opened WITHOUT firing, so it carries no LIVE ticket item (firedAt null AND state null). Its
      // null firedAt alone would fall into the HELD/Send branch, but sendLines matches no ticket item and
      // no-ops, so the button would be dead — the `state !== null` guard suppresses it. (Contrast heldLine
      // above: firedAt null but state "queued" ⇒ a real held item ⇒ Send still shows.)
      const ticketlessParent: TabLine = { ...heldLine, lineNo: 4, state: null };
      const { el } = await mount({ lines: [ticketlessParent], courses });
      await openDrawer(el);
      expect(el.shadowRoot!.querySelector('[data-send-line="4"]')).toBeNull();
      expect(el.shadowRoot!.querySelector('[data-recall-line="4"]')).toBeNull();
      expect(el.shadowRoot!.querySelector('[data-cancel-line="4"]')).toBeNull();
    });

    it("offers a tab-level Send all that emits send-lines { lineNos: [] } (release every held line)", async () => {
      const { el } = await mount({ lines: [heldLine], courses });
      await openDrawer(el);
      const sendAll = el.shadowRoot!.querySelector<HTMLElement>("[data-send-all]");
      expect(sendAll).not.toBeNull();

      let captured: CustomEvent | undefined;
      el.addEventListener("send-lines", (e) => (captured = e as CustomEvent));
      sendAll!.click();
      expect(captured!.detail).toEqual({ lineNos: [] });
      expect(captured!.composed).toBe(true);
      expect(captured!.bubbles).toBe(true);
    });

    it("hides Send all when no line is held (every line already fired)", async () => {
      // pendingLine: firedAt set ⇒ nothing held ⇒ no send-all affordance.
      const { el } = await mount({ lines: [pendingLine], courses });
      await openDrawer(el);
      expect(el.shadowRoot!.querySelector("[data-send-all]")).toBeNull();
    });

    it("hides Send all when the only firedAt-null line is a ticket-item-less parent (state null)", async () => {
      // Symmetric with the per-line Send guard: a moved/merged or openTab-initial parent carries
      // firedAt null but state null (no ticket item), so #anyHeld must NOT count it — Send-all would
      // no-op on it. A real held line (state "queued") DOES still surface Send-all (test above).
      const ticketlessParent: TabLine = { ...heldLine, lineNo: 4, state: null };
      const { el } = await mount({ lines: [ticketlessParent], courses });
      await openDrawer(el);
      expect(el.shadowRoot!.querySelector("[data-send-all]")).toBeNull();
    });

    it("shows Recall on a FIRED, queued line and emits recall-lines { lineNos: [lineNo] }", async () => {
      // pendingLine: firedAt set + state queued ⇒ recallable (not yet started).
      const { el } = await mount({ lines: [pendingLine], courses });
      await openDrawer(el);
      const recall = el.shadowRoot!.querySelector<HTMLElement>('[data-recall-line="1"]');
      expect(recall).not.toBeNull();
      expect(el.shadowRoot!.querySelector('[data-send-line="1"]')).toBeNull();
      // Owner decision (menus plan Task 7c): a queued line is cancellable too, beside Recall.
      expect(el.shadowRoot!.querySelector('[data-cancel-line="1"]')).not.toBeNull();

      let captured: CustomEvent | undefined;
      el.addEventListener("recall-lines", (e) => (captured = e as CustomEvent));
      recall!.click();
      expect(captured!.detail).toEqual({ lineNos: [1] });
      expect(captured!.composed).toBe(true);
      expect(captured!.bubbles).toBe(true);
    });

    it("shows Cancel on a FIRED, started line; confirming emits void-line { lineNo }", async () => {
      const { el } = await mount({ lines: [preparingLine], courses });
      await openDrawer(el);
      const cancel = el.shadowRoot!.querySelector<HTMLElement>('[data-cancel-line="1"]');
      expect(cancel).not.toBeNull();
      // A started line is cancel-only — no Send, no Recall.
      expect(el.shadowRoot!.querySelector('[data-send-line="1"]')).toBeNull();
      expect(el.shadowRoot!.querySelector('[data-recall-line="1"]')).toBeNull();

      let captured: CustomEvent | undefined;
      el.addEventListener("void-line", (e) => (captured = e as CustomEvent));
      // Clicking Cancel OPENS the confirm — it does NOT void yet.
      cancel!.click();
      await el.updateComplete;
      expect(captured).toBeUndefined();
      const confirm = el.shadowRoot!.querySelector<HTMLElement>("[data-cancel-confirm]");
      expect(confirm).not.toBeNull();
      // Only on confirm does the void fire.
      confirm!.click();
      expect(captured).toBeInstanceOf(CustomEvent);
      expect(captured!.detail).toEqual({ lineNo: 1 });
      expect(captured!.composed).toBe(true);
      expect(captured!.bubbles).toBe(true);
    });

    it("also shows Cancel (not Recall) on a FIRED, ready line", async () => {
      const { el } = await mount({ lines: [readyLine], courses });
      await openDrawer(el);
      expect(el.shadowRoot!.querySelector('[data-cancel-line="1"]')).not.toBeNull();
      expect(el.shadowRoot!.querySelector('[data-recall-line="1"]')).toBeNull();
    });

    it("dismissing the cancel confirm does NOT emit void-line", async () => {
      const { el } = await mount({ lines: [preparingLine], courses });
      await openDrawer(el);
      let captured: CustomEvent | undefined;
      el.addEventListener("void-line", (e) => (captured = e as CustomEvent));
      el.shadowRoot!.querySelector<HTMLElement>('[data-cancel-line="1"]')!.click();
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>("[data-cancel-dismiss]")!.click();
      await el.updateComplete;
      expect(captured).toBeUndefined();
      // The confirm closed, so its buttons are gone from view.
      const dialog = el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>("wt-dialog");
      expect(dialog!.open).toBe(false);
    });
  });

  describe("changing a sent line, and cancelling part of one (menus plan Task 7c)", () => {
    const sent = "2026-08-20T09:59:00.000Z";
    // Three different texts for the three names, so a surface reading the wrong one fails.
    const burger: TillProduct = {
      ...cafe,
      id: "burger",
      menuItemId: "menu-item-burger",
      name: "Burger",
      customerName: { es: "Hamburguesa de la casa" },
      kitchenName: "BRG",
      unitPrice: "9.50",
      courseId: null,
    };
    const cookedList: OfferedModifier = {
      kind: "options",
      id: "list-cooked",
      name: "Punto",
      customerName: { es: "Punto carta" },
      kitchenName: "Punto KDS",
      defaultLabelId: "label-medium",
      labels: [
        {
          id: "label-rare",
          name: "Poco hecha",
          customerName: { es: "Poco hecha carta" },
          kitchenName: "Poco hecha KDS",
          available: true,
        },
        {
          id: "label-medium",
          name: "Al punto",
          customerName: { es: "Al punto carta" },
          kitchenName: "Al punto KDS",
          available: true,
        },
      ],
    };
    const extraItem = (productId: string, name: string, preselected: boolean) => ({
      productId,
      name,
      customerName: { es: `${name} carta` },
      kitchenName: `${name} KDS`,
      price: "1.00",
      vatClass: "general" as const,
      maxQuantity: 3,
      preselected,
      addAllergens: null,
      suitableFor: [],
    });
    const extrasList: OfferedModifier = {
      kind: "extras",
      id: "list-extras",
      name: "Extras",
      customerName: { es: "Extras carta" },
      kitchenName: "Extras KDS",
      minPicks: 0,
      maxPicks: null,
      // Bacon is preselected by the offer: a Change reopens the line's own answers and must not add it.
      items: [extraItem("p-cheese", "Queso", false), extraItem("p-bacon", "Bacon", true)],
    };
    const burgerLine: TabLine = {
      lineNo: 5,
      name: "Burger",
      productId: "burger",
      quantity: "1.000",
      unitPrecision: 0,
      unitPriceGross: "9.50",
      servedAt: null,
      courseId: null,
      sentAt: sent,
      firedAt: sent,
      state: "queued",
      note: null,
      listId: null,
      menuItemId: "menu-item-burger",
      parentProductId: null,
    };
    const recalledLine: TabLine = { ...burgerLine, lineNo: 6, firedAt: null };
    const noRouteLine: TabLine = { ...burgerLine, lineNo: 7, firedAt: null, state: null };
    const unreleasedNoRouteLine: TabLine = { ...noRouteLine, lineNo: 8, sentAt: null };
    const preparingBurger: TabLine = { ...burgerLine, lineNo: 9, state: "preparing" };
    const readyBurger: TabLine = { ...burgerLine, lineNo: 10, state: "ready" };
    const cheeseChild: TabLine = {
      ...burgerLine,
      lineNo: 11,
      name: "Queso",
      productId: "p-cheese",
      parentLineNo: 5,
      unitPrecision: null,
      unitPriceGross: "1.00",
      firedAt: null,
      state: null,
      listId: "list-extras",
    };
    const neverSentLine: TabLine = { ...burgerLine, lineNo: 12, sentAt: null, firedAt: null };

    const mountLines = (lines: TabLine[], over: Partial<TillTableOrderScreen> = {}) =>
      mount({ products: [...products, burger], lines, ...over });
    const lineAction = (el: TillTableOrderScreen, kind: string, lineNo: number) =>
      el.shadowRoot!.querySelector<HTMLElement>(`[data-${kind}-line="${lineNo}"]`);
    const editor = (el: TillTableOrderScreen) =>
      el.shadowRoot!.querySelector<TillModifierPicker>("till-modifier-picker");
    const noteBox = (picker: TillModifierPicker) =>
      picker.shadowRoot!.querySelector<HTMLTextAreaElement>('[data-test="line-note"]')!;
    async function typeNote(picker: TillModifierPicker, text: string): Promise<void> {
      const box = noteBox(picker);
      box.value = text;
      box.dispatchEvent(new Event("input"));
      await picker.updateComplete;
    }
    async function openChange(el: TillTableOrderScreen, lineNo: number) {
      lineAction(el, "change", lineNo)!.click();
      await el.updateComplete;
      const picker = editor(el)!;
      await picker.updateComplete;
      return picker;
    }
    function captureChange(el: TillTableOrderScreen): { event?: CustomEvent } {
      const seen: { event?: CustomEvent } = {};
      el.addEventListener("change-line", (e) => (seen.event = e as CustomEvent));
      return seen;
    }

    it("offers Change beside Recall and Cancel on a queued line the kitchen has not started", async () => {
      const { el } = await mountLines([burgerLine]);
      await openDrawer(el);
      expect(lineAction(el, "change", 5)).not.toBeNull();
      expect(lineAction(el, "recall", 5)).not.toBeNull();
      expect(lineAction(el, "cancel", 5)).not.toBeNull();
      expect(lineAction(el, "change", 5)!.getAttribute("aria-label")).toBe(
        `${t("table.change_line")} · Burger`,
      );
    });

    it("offers Change on a recalled line and on a no-route line, whether or not it was released", async () => {
      const { el } = await mountLines([recalledLine, noRouteLine, unreleasedNoRouteLine]);
      await openDrawer(el);
      expect(lineAction(el, "change", 6)).not.toBeNull();
      // A recalled line is held again, so it can still be sent.
      expect(lineAction(el, "send", 6)).not.toBeNull();
      expect(lineAction(el, "change", 7)).not.toBeNull();
      expect(lineAction(el, "change", 8)).not.toBeNull();
    });

    it("offers Cancel on a recalled line with the setting on, beside Send and Change", async () => {
      const { el } = await mountLines([recalledLine]);
      await openDrawer(el);
      expect(lineAction(el, "cancel", 6)).not.toBeNull();
      expect(lineAction(el, "send", 6)).not.toBeNull();
      expect(lineAction(el, "change", 6)).not.toBeNull();
    });

    it("closes an open Change editor when the app points the screen at another order", async () => {
      const { el } = await mountLines([burgerLine], { orderId: "wo-7" });
      await openDrawer(el);
      await openChange(el, 5);
      el.orderId = "wo-9";
      await el.updateComplete;
      expect(editor(el)).toBeNull();
    });

    it("closes an open Cancel confirm when the app points the screen at another order", async () => {
      const { el } = await mountLines([burgerLine], { orderId: "wo-7" });
      await openDrawer(el);
      lineAction(el, "cancel", 5)!.click();
      await el.updateComplete;
      const dialog = el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
        "wt-dialog.cancel-confirm",
      )!;
      expect(dialog.open).toBe(true);
      el.orderId = "wo-9";
      await el.updateComplete;
      expect(dialog.open).toBe(false);
    });

    it("offers Cancel alone on a line the kitchen has started", async () => {
      const { el } = await mountLines([preparingBurger, readyBurger]);
      await openDrawer(el);
      for (const lineNo of [9, 10]) {
        expect(lineAction(el, "cancel", lineNo)).not.toBeNull();
        expect(lineAction(el, "change", lineNo)).toBeNull();
        expect(lineAction(el, "recall", lineNo)).toBeNull();
      }
    });

    it("offers no Change on an extras row, nor on a held line that was never sent", async () => {
      const { el } = await mountLines([burgerLine, cheeseChild, neverSentLine]);
      await openDrawer(el);
      expect(lineAction(el, "change", 11)).toBeNull();
      expect(lineAction(el, "change", 12)).toBeNull();
      expect(lineAction(el, "send", 12)).not.toBeNull();
    });

    it("offers no Change on a line whose product the till does not have", async () => {
      const gone: TabLine = { ...burgerLine, productId: "gone", menuItemId: "menu-item-gone" };
      const unnamed: TabLine = { ...burgerLine, lineNo: 6, productId: null, menuItemId: null };
      const { el } = await mountLines([gone, unnamed]);
      await openDrawer(el);
      expect(lineAction(el, "change", 5)).toBeNull();
      expect(lineAction(el, "recall", 5)).not.toBeNull();
      expect(lineAction(el, "change", 6)).toBeNull();
    });

    it("with changes to sent items switched off, a sent line offers Cancel and neither Change nor Recall", async () => {
      const { el } = await mountLines([burgerLine, recalledLine, noRouteLine, preparingBurger], {
        editSentLines: false,
      });
      await openDrawer(el);
      for (const lineNo of [5, 6, 9]) {
        expect(lineAction(el, "change", lineNo)).toBeNull();
        expect(lineAction(el, "recall", lineNo)).toBeNull();
        expect(lineAction(el, "cancel", lineNo)).not.toBeNull();
      }
      // The server changes a no-route line whatever the setting, so it keeps Change.
      expect(lineAction(el, "change", 7)).not.toBeNull();
    });

    it("opens the note editor on a dish with no choices; saving sends the note and the order's revision", async () => {
      const { el } = await mountLines([burgerLine], { revision: 7 });
      await openDrawer(el);
      const picker = await openChange(el, 5);
      expect(
        picker.shadowRoot!.querySelector<HTMLElement & { heading: string }>("wt-modal")!.heading,
      ).toBe("Burger");
      expect(noteBox(picker).value).toBe("");
      const seen = captureChange(el);

      await typeNote(picker, "no onions");
      picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!.click();
      await el.updateComplete;

      expect(seen.event!.detail).toEqual({
        lineNo: 5,
        lineName: "Burger",
        patch: { note: "no onions" },
        revision: 7,
      });
      expect(seen.event!.bubbles).toBe(true);
      expect(seen.event!.composed).toBe(true);
      expect(editor(el)).toBeNull();
    });

    it("sends the revision the editor was opened at, not one read while it was open", async () => {
      const { el } = await mountLines([burgerLine], { revision: 7 });
      await openDrawer(el);
      const picker = await openChange(el, 5);
      el.revision = 8;
      await el.updateComplete;
      const seen = captureChange(el);
      await typeNote(picker, "no onions");
      picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!.click();
      expect(seen.event!.detail.revision).toBe(7);
    });

    it("prefills the line's note, answer and extras; saving unchanged sends the extras back and leaves the answer out", async () => {
      const dish: TillProduct = { ...burger, offeredModifiers: [cookedList, extrasList] };
      const line: TabLine = {
        ...burgerLine,
        quantity: "2.000",
        note: "sin sal",
        optionSnapshots: [
          {
            listName: { es: "Punto" },
            listCustomerName: { es: "Punto carta" },
            listKitchenName: "Punto KDS",
            labelName: { es: "Poco hecha" },
            labelCustomerName: { es: "Poco hecha carta" },
            labelKitchenName: "Poco hecha KDS",
          },
        ],
      };
      // Two cheeses per burger on a line of two burgers.
      const child: TabLine = { ...cheeseChild, quantity: "4.000" };
      const { el } = await mount({ products: [dish], lines: [line, child], revision: 3 });
      await openDrawer(el);
      const picker = await openChange(el, 5);

      expect(noteBox(picker).value).toBe("sin sal");
      expect(
        picker.shadowRoot!.querySelector<HTMLInputElement>("#label-list-cooked-label-rare")!
          .checked,
      ).toBe(true);
      const count = (productId: string) =>
        picker
          .shadowRoot!.querySelector(`[data-test="pick-list-extras-${productId}-count"]`)!
          .textContent!.trim();
      expect(count("p-cheese")).toBe("2");
      expect(count("p-bacon")).toBe("0");

      const seen = captureChange(el);
      picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!.click();
      expect(seen.event!.detail).toEqual({
        lineNo: 5,
        lineName: "Burger",
        revision: 3,
        patch: {
          note: "sin sal",
          extras: [{ listId: "list-extras", picks: [{ productId: "p-cheese", quantity: 2 }] }],
        },
      });
    });

    describe("a line holding an answer to a list the dish no longer offers", () => {
      const snapshot = (list: string, label: string) => ({
        listName: { es: list },
        listCustomerName: { es: `${list} carta` },
        listKitchenName: `${list} KDS`,
        labelName: { es: label },
        labelCustomerName: { es: `${label} carta` },
        labelKitchenName: `${label} KDS`,
      });
      const line: TabLine = {
        ...burgerLine,
        optionSnapshots: [snapshot("Punto", "Poco hecha"), snapshot("Pan", "Sin gluten")],
      };
      const mountWithdrawn = () =>
        mount({ products: [{ ...burger, offeredModifiers: [cookedList] }], lines: [line] });
      const pickLabel = async (picker: TillModifierPicker, labelId: string) => {
        picker
          .shadowRoot!.querySelector<HTMLInputElement>(`#label-list-cooked-${labelId}`)!
          .click();
        await picker.updateComplete;
      };

      it("a note-only change leaves the line's answers out, so the server keeps both", async () => {
        const { el } = await mountWithdrawn();
        await openDrawer(el);
        const picker = await openChange(el, 5);
        await typeNote(picker, "sin sal");
        const seen = captureChange(el);
        picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!.click();
        expect(seen.event!.detail.patch).toEqual({ note: "sin sal" });
      });

      it("an answer changed and changed back is compared by value and left out", async () => {
        const { el } = await mountWithdrawn();
        await openDrawer(el);
        const picker = await openChange(el, 5);
        await pickLabel(picker, "label-medium");
        await pickLabel(picker, "label-rare");
        const seen = captureChange(el);
        picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!.click();
        expect(seen.event!.detail.patch).toEqual({ note: null });
      });

      /** The server refuses an answer naming a list the dish no longer offers (`options.invalid`), so
       * a deliberate change of answers replaces the set with the offered lists' answers alone. */
      it("a changed answer sends the offered lists' answers, which replace the set", async () => {
        const { el } = await mountWithdrawn();
        await openDrawer(el);
        const picker = await openChange(el, 5);
        await pickLabel(picker, "label-medium");
        const seen = captureChange(el);
        picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!.click();
        expect(seen.event!.detail.patch).toEqual({
          note: null,
          options: [{ listId: "list-cooked", labelId: "label-medium" }],
        });
      });
    });

    it("keeps Save shut on a pick no offered list still carries, rather than dropping it", async () => {
      const dish: TillProduct = { ...burger, offeredModifiers: [extrasList] };
      const withdrawn: TabLine = { ...cheeseChild, listId: "list-withdrawn" };
      const { el } = await mount({ products: [dish], lines: [burgerLine, withdrawn] });
      await openDrawer(el);
      const picker = await openChange(el, 5);
      expect(picker.shadowRoot!.querySelector(".refusal")!.textContent).toContain("Queso");
      expect(
        picker.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(".confirm")!.disabled,
      ).toBe(true);
    });

    it("leaves a line's extras alone when the dish offers no extras list", async () => {
      const dish: TillProduct = { ...burger, offeredModifiers: [cookedList] };
      const { el } = await mount({
        products: [dish],
        lines: [{ ...burgerLine, optionSnapshots: [] }, cheeseChild],
        revision: 1,
      });
      await openDrawer(el);
      const picker = await openChange(el, 5);
      picker
        .shadowRoot!.querySelector<HTMLInputElement>("#label-list-cooked-label-medium")!
        .click();
      await picker.updateComplete;
      const seen = captureChange(el);
      picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!.click();
      expect(seen.event!.detail.patch).toEqual({
        note: null,
        options: [{ listId: "list-cooked", labelId: "label-medium" }],
      });
    });

    it("sends an empty extras set when every pick is taken off, so the server removes them", async () => {
      const dish: TillProduct = { ...burger, offeredModifiers: [extrasList] };
      const { el } = await mount({ products: [dish], lines: [burgerLine, cheeseChild] });
      await openDrawer(el);
      const picker = await openChange(el, 5);
      picker
        .shadowRoot!.querySelector<HTMLElement>('[data-test="pick-list-extras-p-cheese-dec"]')!
        .click();
      await picker.updateComplete;
      const seen = captureChange(el);
      picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!.click();
      expect(seen.event!.detail.patch).toEqual({ note: null, extras: [] });
    });

    it("treats a pick recorded with no list as no longer offered", async () => {
      const dish: TillProduct = { ...burger, offeredModifiers: [extrasList] };
      const { el } = await mount({
        products: [dish],
        lines: [burgerLine, { ...cheeseChild, listId: null }],
      });
      await openDrawer(el);
      const picker = await openChange(el, 5);
      expect(
        picker.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(".confirm")!.disabled,
      ).toBe(true);
    });

    it("opens a line with no recorded offer on the first product of that id, as its name reads", async () => {
      const lunch: TillProduct = {
        ...burger,
        menuItemId: "menu-item-burger-lunch",
        offeredModifiers: [cookedList],
      };
      const dinner: TillProduct = { ...burger, menuItemId: "menu-item-burger-dinner" };
      const { el } = await mount({
        products: [lunch, dinner],
        lines: [{ ...burgerLine, menuItemId: null }],
      });
      await openDrawer(el);
      const picker = await openChange(el, 5);
      expect(picker.shadowRoot!.querySelector("#label-list-cooked-label-rare")).not.toBeNull();
    });

    it("sends a cleared note as null, which removes it", async () => {
      const { el } = await mountLines([{ ...burgerLine, note: "sin sal" }], { revision: 2 });
      await openDrawer(el);
      const picker = await openChange(el, 5);
      const seen = captureChange(el);
      await typeNote(picker, "");
      picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!.click();
      expect(seen.event!.detail.patch).toEqual({ note: null });
    });

    it("opens a variant line on its parent product, titled with the line's own name", async () => {
      const withVariants: TillProduct = {
        ...burger,
        variants: [
          {
            id: "burger-large",
            name: "Grande",
            customerName: { es: "Grande carta" },
            kitchenName: "GR",
            vatClass: "general",
            category: null,
            allergens: null,
            unitPrice: "11.00",
            unitPriceDifference: "1.50",
            available: true,
          },
        ],
      };
      const variantLine: TabLine = {
        ...burgerLine,
        name: "Grande",
        productId: "burger-large",
        parentProductId: "burger",
        menuItemId: null,
        unitPriceGross: "11.00",
      };
      const { el } = await mount({ products: [withVariants], lines: [variantLine], revision: 1 });
      await openDrawer(el);
      const picker = await openChange(el, 5);
      expect(
        picker.shadowRoot!.querySelector<HTMLElement & { heading: string }>("wt-modal")!.heading,
      ).toBe("Grande");
      // A change cannot move a line to another variant, so no variant has to be chosen to save.
      expect(picker.shadowRoot!.querySelector('input[name="product-variant"]')).toBeNull();
      const seen = captureChange(el);
      await typeNote(picker, "sin pepinillo");
      picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!.click();
      expect(seen.event!.detail.patch).toEqual({ note: "sin pepinillo" });
      expect(seen.event!.detail.lineName).toBe("Grande");
    });

    it("closing the editor changes nothing", async () => {
      const { el } = await mountLines([burgerLine]);
      await openDrawer(el);
      const picker = await openChange(el, 5);
      const seen = captureChange(el);
      picker.shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
      await el.updateComplete;
      expect(seen.event).toBeUndefined();
      expect(editor(el)).toBeNull();
    });

    it("shows a line's note on the tab line, beside its locked price", async () => {
      const { el } = await mountLines([{ ...burgerLine, note: "no onions" }]);
      await openDrawer(el);
      const row = el.shadowRoot!.querySelector(".pending-line")!;
      expect(row.querySelector(".line-note")!.textContent).toContain("no onions");
      expect(row.querySelector(".line-total")!.textContent).toBe(
        formatMoney("9.50", currentLocale()),
      );
    });

    describe("Cancel on a line of more than one", () => {
      const pair: TabLine = { ...burgerLine, quantity: "2.000" };
      function captureVoid(el: TillTableOrderScreen): { event?: CustomEvent } {
        const seen: { event?: CustomEvent } = {};
        el.addEventListener("void-line", (e) => (seen.event = e as CustomEvent));
        return seen;
      }
      async function openCancel(el: TillTableOrderScreen, lineNo: number): Promise<HTMLElement> {
        lineAction(el, "cancel", lineNo)!.click();
        await el.updateComplete;
        return el.shadowRoot!.querySelector<HTMLElement>("wt-dialog.cancel-confirm")!;
      }

      it("asks how many, and Cancel 1 cancels one", async () => {
        const { el } = await mountLines([pair]);
        await openDrawer(el);
        const dialog = await openCancel(el, 5);
        expect(dialog.textContent).toContain(t("table.cancel_one_of").replace("{n}", "2"));
        const seen = captureVoid(el);
        dialog.querySelector<HTMLElement>("[data-cancel-one]")!.click();
        expect(seen.event!.detail).toEqual({ lineNo: 5, quantity: "1" });
        expect(seen.event!.bubbles).toBe(true);
        expect(seen.event!.composed).toBe(true);
      });

      it("Cancel all cancels the whole line", async () => {
        const { el } = await mountLines([pair]);
        await openDrawer(el);
        const dialog = await openCancel(el, 5);
        const seen = captureVoid(el);
        const all = dialog.querySelector<HTMLElement>("[data-cancel-confirm]")!;
        expect(all.textContent!.trim()).toBe(t("table.cancel_all"));
        all.click();
        expect(seen.event!.detail).toEqual({ lineNo: 5 });
      });

      it("keeps the started wording when the kitchen has started the pair", async () => {
        const { el } = await mountLines([{ ...pair, state: "preparing" }]);
        await openDrawer(el);
        const dialog = await openCancel(el, 5);
        expect(dialog.textContent).toContain(t("table.cancel_started"));
        expect(dialog.querySelector("[data-cancel-one]")).not.toBeNull();
      });

      it("does not ask how many on a line of one", async () => {
        const { el } = await mountLines([burgerLine]);
        await openDrawer(el);
        const dialog = await openCancel(el, 5);
        expect(dialog.querySelector("[data-cancel-one]")).toBeNull();
        expect(dialog.textContent).not.toContain(t("table.cancel_one_of").replace("{n}", "1"));
        const seen = captureVoid(el);
        dialog.querySelector<HTMLElement>("[data-cancel-confirm]")!.click();
        expect(seen.event!.detail).toEqual({ lineNo: 5 });
      });

      it("cancels a weighed line whole", async () => {
        const weighed: TabLine = {
          ...burgerLine,
          productId: "jamon",
          menuItemId: "menu-item-jamon",
          name: "Jamón",
          quantity: "2.000",
          unitPrecision: 3,
          state: "preparing",
        };
        const { el } = await mountLines([weighed]);
        await openDrawer(el);
        const dialog = await openCancel(el, 5);
        expect(dialog.querySelector("[data-cancel-one]")).toBeNull();
      });

      it("tells the app it has taken a Cancel offer, so the offer is shown once", async () => {
        const { el } = await mountLines([preparingBurger]);
        let taken: Event | undefined;
        el.addEventListener("cancel-offer-taken", (e) => (taken = e));
        el.cancelOffer = 9;
        await el.updateComplete;
        expect(taken).toBeInstanceOf(CustomEvent);
        expect(taken!.bubbles).toBe(true);
        expect(taken!.composed).toBe(true);
      });

      it("opens nothing when the line the app offers Cancel for is no longer on the tab", async () => {
        const { el } = await mountLines([preparingBurger]);
        await openDrawer(el);
        let taken: Event | undefined;
        el.addEventListener("cancel-offer-taken", (e) => (taken = e));
        el.cancelOffer = 42;
        await el.updateComplete;
        const dialog = el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
          "wt-dialog.cancel-confirm",
        )!;
        expect(dialog.open).toBe(false);
        // Taken all the same: a later mount must not open it on whatever line 42 then is.
        expect(taken).toBeInstanceOf(CustomEvent);
      });

      it("opens Cancel on the line the app offers it for after a refused change", async () => {
        const { el } = await mountLines([preparingBurger]);
        await openDrawer(el);
        el.cancelOffer = 9;
        await el.updateComplete;
        const dialog = el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
          "wt-dialog.cancel-confirm",
        )!;
        expect(dialog.open).toBe(true);
        expect(dialog.textContent).toContain(t("table.cancel_started"));
        expect(dialog.textContent).toContain("Burger");
      });
    });
  });

  describe("table actions (TS-3/TS-4)", () => {
    const tableState = (over: Partial<TableState> = {}): TableState => ({
      id: "t1",
      label: "1",
      zoneId: null,
      capacity: null,
      state: "free",
      hasOpenTab: false,
      pendingDeliveries: 0,
      pendingToServe: 0,
      readyToServe: 0,
      enRoute: 0,
      timingBand: "fresh",
      status: null,
      nextReservation: null,
      posX: null,
      posY: null,
      shape: null,
      rotation: null,
      ...over,
    });

    async function toMenu(el: TillTableOrderScreen): Promise<void> {
      await openDrawer(el);
      el.shadowRoot!.querySelector<HTMLElement>("[data-move-split]")!.click();
      await el.updateComplete;
    }
    const click = (el: TillTableOrderScreen, selector: string) =>
      el.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
    const setSplitQuantity = async (el: TillTableOrderScreen, lineNo: number, value: string) => {
      const field = el.shadowRoot!.querySelector<HTMLElement>(`[data-split-quantity="${lineNo}"]`)!;
      const input = field.shadowRoot!.querySelector("input")!;
      input.value = value;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
      await el.updateComplete;
    };

    it("shows all five action verbs with Split enabled and a Back control", async () => {
      const { el } = await mount({ lines: [pendingLine], tables: [] });
      await toMenu(el);
      for (const verb of ["move", "join", "merge", "transfer"]) {
        expect(el.shadowRoot!.querySelector(`[data-action="${verb}"]`)).not.toBeNull();
      }
      const split = el.shadowRoot!.querySelector(`[data-action="split"]`)!;
      expect(split.hasAttribute("disabled")).toBe(false);
      expect(el.shadowRoot!.querySelector("[data-action-back]")).not.toBeNull();
    });

    it("split → line selection → dispatches split-lines with whole-line entries", async () => {
      const second = { ...pendingLine, lineNo: 2, productId: "agua", quantity: "1.000" };
      const { el } = await mount({ lines: [pendingLine, second], orderId: "wo-7" });
      await toMenu(el);
      click(el, '[data-action="split"]');
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-split-lines]")).not.toBeNull();
      expect(el.shadowRoot!.querySelector("[data-split-confirm]")!.hasAttribute("disabled")).toBe(
        true,
      );

      let captured: CustomEvent | undefined;
      el.addEventListener("split-lines", (event) => (captured = event as CustomEvent));
      click(el, '[data-split-line="1"]');
      click(el, '[data-split-line="2"]');
      await el.updateComplete;
      click(el, "[data-split-confirm]");
      await el.updateComplete;

      expect(captured!.composed).toBe(true);
      expect(captured!.bubbles).toBe(true);
      expect(captured!.detail).toEqual({ transfers: [{ lineNo: 1 }, { lineNo: 2 }] });
      expect(el.shadowRoot!.querySelector("[data-action-menu]")).toBeNull();
    });

    it("split dispatches a mixed partial each quantity and whole weight line", async () => {
      const each = { ...pendingLine, quantity: "4.000" };
      const weight = {
        ...pendingLine,
        lineNo: 2,
        productId: "jamon",
        unitPrecision: 3,
        quantity: "0.750",
        unitPriceGross: "20.00",
      };
      const { el } = await mount({ lines: [each, weight], orderId: "wo-7" });
      await toMenu(el);
      click(el, '[data-action="split"]');
      await el.updateComplete;

      let captured: CustomEvent | undefined;
      el.addEventListener("split-lines", (event) => (captured = event as CustomEvent));
      click(el, '[data-split-line="1"]');
      click(el, '[data-split-line="2"]');
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('[data-split-inc="1"]')!.hasAttribute("disabled")).toBe(
        true,
      );
      click(el, '[data-split-dec="1"]');
      click(el, '[data-split-dec="1"]');
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('[data-split-count="1"]')!.textContent).toBe("2");
      expect(
        el.shadowRoot!.querySelector<HTMLElement & { value: string }>('[data-split-quantity="2"]')!
          .value,
      ).toBe("0.75");

      click(el, "[data-split-confirm]");
      await el.updateComplete;
      expect(captured!.detail).toEqual({
        transfers: [{ lineNo: 1, quantity: "2" }, { lineNo: 2 }],
      });
    });

    it.each(["0", "0.751", "not-a-number"])(
      "split refuses invalid or over-quantity weight input %s with field and form errors",
      async (quantity) => {
        const weight = {
          ...pendingLine,
          productId: "jamon",
          unitPrecision: 3,
          quantity: "0.750",
          unitPriceGross: "20.00",
        };
        const { el } = await mount({ lines: [weight], orderId: "wo-7" });
        await toMenu(el);
        click(el, '[data-action="split"]');
        await el.updateComplete;
        click(el, '[data-split-line="1"]');
        await el.updateComplete;
        await setSplitQuantity(el, 1, quantity);

        let captured: Event | undefined;
        el.addEventListener("split-lines", (event) => (captured = event));
        click(el, "[data-split-confirm]");
        await el.updateComplete;

        expect(captured).toBeUndefined();
        const field = el.shadowRoot!.querySelector<HTMLElement & { error: string }>(
          '[data-split-quantity="1"]',
        )!;
        expect(field.error).toBe(t("table.split_quantity_decimal_error"));
        const summary = el.shadowRoot!.querySelector<
          HTMLElement & { heading: string; errors: string[] }
        >("wt-form-error-summary")!;
        expect(summary.heading).toBe(t("form.error_heading"));
        expect(summary.errors).toEqual([t("table.split_quantity_decimal_error")]);
      },
    );

    // A line sold as a variant names the VARIANT as its product, and a variant is never a till
    // product of its own (the till's products are the offers' parents), so the split has to read the
    // unit precision the line froze rather than look the product up.
    it("splits a variant line sold by the unit with the whole-number stepper", async () => {
      const variantLine: TabLine = {
        ...pendingLine,
        productId: "wine-125",
        name: "Wine 125",
        quantity: "2.000",
        unitPrecision: 0,
      };
      const { el } = await mount({ lines: [variantLine], orderId: "wo-7" });
      await toMenu(el);
      click(el, '[data-action="split"]');
      await el.updateComplete;
      click(el, '[data-split-line="1"]');
      await el.updateComplete;

      expect(el.shadowRoot!.querySelector('[data-split-quantity="1"]')).toBeNull();
      click(el, '[data-split-dec="1"]');
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('[data-split-count="1"]')!.textContent).toBe("1");
    });

    it("Back resets split quantities so a reselected dish defaults to its full quantity", async () => {
      const each = { ...pendingLine, quantity: "4.000" };
      const { el } = await mount({ lines: [each], orderId: "wo-7" });
      await toMenu(el);
      click(el, '[data-action="split"]');
      await el.updateComplete;
      click(el, '[data-split-line="1"]');
      await el.updateComplete;
      click(el, '[data-split-dec="1"]');
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('[data-split-count="1"]')!.textContent).toBe("3");

      click(el, "[data-action-back]");
      await el.updateComplete;
      click(el, '[data-action="split"]');
      await el.updateComplete;
      click(el, '[data-split-line="1"]');
      await el.updateComplete;

      expect(el.shadowRoot!.querySelector('[data-split-count="1"]')!.textContent).toBe("4");
    });

    it("split excludes modifier children and explains that dishes with options move together", async () => {
      // A child extras row as the wire sends one: the picked product, plus the parent dish's line
      // number. Keeping `productId` would let this pass against the old null-product child test.
      const modifier = { ...pendingLine, lineNo: 2, parentLineNo: 1, quantity: "2.000" };
      const { el } = await mount({ lines: [pendingLine, modifier], orderId: "wo-7" });
      await toMenu(el);
      click(el, '[data-action="split"]');
      await el.updateComplete;

      expect(el.shadowRoot!.querySelector('[data-split-line="1"]')).not.toBeNull();
      expect(el.shadowRoot!.querySelector('[data-split-line="2"]')).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-split-help]")!.textContent).toContain(
        t("table.split_options_together"),
      );
    });

    it("move → free-table picker → dispatches move-tab { toTableId } and closes", async () => {
      const free = tableState({ id: "t9", label: "9", state: "free" });
      const occupied = tableState({ id: "t8", state: "open-tab", hasOpenTab: true, tabId: "wo-8" });
      const { el } = await mount({
        lines: [pendingLine],
        orderId: "wo-7",
        tables: [free, occupied],
      });
      await toMenu(el);
      click(el, '[data-action="move"]');
      await el.updateComplete;
      // The picker lists only FREE tables (the occupied one is not a move target).
      expect(el.shadowRoot!.querySelector("[data-target-picker]")).not.toBeNull();
      expect(el.shadowRoot!.querySelector('[data-target="t9"]')).not.toBeNull();
      expect(el.shadowRoot!.querySelector('[data-target="t8"]')).toBeNull();

      let captured: CustomEvent | undefined;
      el.addEventListener("move-tab", (e) => (captured = e as CustomEvent));
      click(el, '[data-target="t9"]');
      await el.updateComplete;
      expect(captured).toBeInstanceOf(CustomEvent);
      expect(captured!.composed).toBe(true);
      expect(captured!.bubbles).toBe(true);
      expect(captured!.detail).toEqual({ toTableId: "t9" });
      // The flow closes back to the trigger.
      expect(el.shadowRoot!.querySelector("[data-action-menu]")).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-move-split]")).not.toBeNull();
    });

    it("join → free-table picker → dispatches join-table { tableId } and closes", async () => {
      const free = tableState({ id: "t9", state: "free" });
      const { el } = await mount({ lines: [pendingLine], orderId: "wo-7", tables: [free] });
      await toMenu(el);
      click(el, '[data-action="join"]');
      await el.updateComplete;
      let captured: CustomEvent | undefined;
      el.addEventListener("join-table", (e) => (captured = e as CustomEvent));
      click(el, '[data-target="t9"]');
      await el.updateComplete;
      expect(captured!.detail).toEqual({ tableId: "t9" });
      expect(el.shadowRoot!.querySelector("[data-action-menu]")).toBeNull();
    });

    it("merge → other-open-tab picker (EXCLUDES the current tab) → dispatches merge-tabs and closes", async () => {
      const own = tableState({ id: "t2", state: "open-tab", hasOpenTab: true, tabId: "wo-7" });
      const other = tableState({
        id: "t3",
        label: "3",
        state: "open-tab",
        hasOpenTab: true,
        tabId: "wo-9",
      });
      const { el } = await mount({ lines: [pendingLine], orderId: "wo-7", tables: [own, other] });
      await toMenu(el);
      click(el, '[data-action="merge"]');
      await el.updateComplete;
      // The current tab's own table (tabId === orderId) is not a merge source.
      expect(el.shadowRoot!.querySelector('[data-target="wo-7"]')).toBeNull();
      expect(el.shadowRoot!.querySelector('[data-target="wo-9"]')).not.toBeNull();

      let captured: CustomEvent | undefined;
      el.addEventListener("merge-tabs", (e) => (captured = e as CustomEvent));
      click(el, '[data-target="wo-9"]');
      await el.updateComplete;
      expect(captured!.detail).toEqual({ fromTabId: "wo-9", freeSourceTable: true });
      expect(el.shadowRoot!.querySelector("[data-action-menu]")).toBeNull();
    });

    it("lists a JOINED tab (two tables, one tabId) once in the merge picker", async () => {
      // A joined tab spans several dining_tables rows all pointing at one tabId; the picker chooses a
      // BILL, so it must dedupe to one entry (not one per covered table).
      const joinedA = tableState({
        id: "t3",
        label: "3",
        state: "open-tab",
        hasOpenTab: true,
        tabId: "wo-9",
      });
      const joinedB = tableState({
        id: "t4",
        label: "4",
        state: "open-tab",
        hasOpenTab: true,
        tabId: "wo-9",
      });
      const { el } = await mount({
        lines: [pendingLine],
        orderId: "wo-7",
        tables: [joinedA, joinedB],
      });
      await toMenu(el);
      click(el, '[data-action="merge"]');
      await el.updateComplete;
      expect(el.shadowRoot!.querySelectorAll('[data-target="wo-9"]')).toHaveLength(1);
    });

    it("transfer → tab picker → line selection → dispatches transfer-lines with a whole-line entry", async () => {
      const other = tableState({ id: "t3", state: "open-tab", hasOpenTab: true, tabId: "wo-9" });
      const { el } = await mount({ lines: [pendingLine], orderId: "wo-7", tables: [other] });
      await toMenu(el);
      click(el, '[data-action="transfer"]');
      await el.updateComplete;
      // Picking the destination tab advances to the line-picker step (does NOT dispatch yet).
      click(el, '[data-target="wo-9"]');
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-transfer-lines]")).not.toBeNull();
      // Confirm is a no-op until at least one line is selected.
      expect(
        el.shadowRoot!.querySelector("[data-transfer-confirm]")!.hasAttribute("disabled"),
      ).toBe(true);

      let captured: CustomEvent | undefined;
      el.addEventListener("transfer-lines", (e) => (captured = e as CustomEvent));
      // Select the whole of line 1 (quantity 2.000) → a whole-line entry OMITS quantity.
      click(el, '[data-transfer-line="1"]');
      await el.updateComplete;
      expect(
        el.shadowRoot!.querySelector("[data-transfer-confirm]")!.hasAttribute("disabled"),
      ).toBe(false);
      click(el, "[data-transfer-confirm]");
      await el.updateComplete;
      expect(captured!.composed).toBe(true);
      expect(captured!.detail).toEqual({ toTabId: "wo-9", transfers: [{ lineNo: 1 }] });
      expect(el.shadowRoot!.querySelector("[data-action-menu]")).toBeNull();
    });

    it("transfer line-picker offers dishes only, never a child extras row", async () => {
      // The server REFUSES a directly named child and cascades a dish's children with the dish instead.
      const child = { ...pendingLine, lineNo: 2, parentLineNo: 1, quantity: "1.000" };
      const other = tableState({ id: "t3", state: "open-tab", hasOpenTab: true, tabId: "wo-9" });
      const { el } = await mount({
        lines: [pendingLine, child],
        orderId: "wo-7",
        tables: [other],
      });
      await toMenu(el);
      click(el, '[data-action="transfer"]');
      await el.updateComplete;
      click(el, '[data-target="wo-9"]');
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('[data-transfer-line="1"]')).not.toBeNull();
      expect(el.shadowRoot!.querySelector('[data-transfer-line="2"]')).toBeNull();
    });

    it("shows an empty-state when there are no free tables to move to", async () => {
      const { el } = await mount({ lines: [pendingLine], orderId: "wo-7", tables: [] });
      await toMenu(el);
      click(el, '[data-action="move"]');
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-target-picker]")!.textContent).toContain(
        t("table.no_free_tables"),
      );
    });

    it("shows an empty-state when there are no other open tabs to merge", async () => {
      const own = tableState({ id: "t2", state: "open-tab", hasOpenTab: true, tabId: "wo-7" });
      const { el } = await mount({ lines: [pendingLine], orderId: "wo-7", tables: [own] });
      await toMenu(el);
      click(el, '[data-action="merge"]');
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-target-picker]")!.textContent).toContain(
        t("table.no_other_tabs"),
      );
    });

    it("Back from the menu closes; Back from a picker returns to the menu", async () => {
      const free = tableState({ id: "t9", state: "free" });
      const { el } = await mount({ lines: [pendingLine], orderId: "wo-7", tables: [free] });
      await toMenu(el);
      // Into the move picker, then Back → the menu again.
      click(el, '[data-action="move"]');
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-target-picker]")).not.toBeNull();
      click(el, "[data-action-back]");
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-action-menu]")).not.toBeNull();
      // Back from the menu closes the flow.
      click(el, "[data-action-back]");
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-action-menu]")).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-move-split]")).not.toBeNull();
    });

    it("resets a half-open flow when the tab changes (the app re-points orderId)", async () => {
      const free = tableState({ id: "t9", state: "free" });
      const { el } = await mount({ lines: [pendingLine], orderId: "wo-7", tables: [free] });
      await toMenu(el);
      click(el, '[data-action="move"]');
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-target-picker]")).not.toBeNull();
      // Switching tabs must not carry the old tab's picker across — it resets to the trigger.
      el.orderId = "wo-9";
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-target-picker]")).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-action-menu]")).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-move-split]")).not.toBeNull();
    });
  });

  // Multi-menu: the round grid shows only the SELECTED menu's products, while a tab line's NAME still
  // resolves against the full product set (a tab may span menus). The app owns the selection.
  describe("multi-menu round grid", () => {
    const foodMenu = { id: "cat-food", name: "Comida", isDefault: true };
    const drinksMenu = { id: "cat-drinks", name: "Bebidas", isDefault: false };
    const bocadillo: TillProduct = {
      ...cafe,
      id: "bocadillo",
      menuItemId: "menu-item-bocadillo",
      name: "Bocadillo",
      customerName: { es: "Bocadillo para el cliente" },
      courseId: null,
      catalogueId: "cat-food",
      catalogueName: "Comida",
    };
    const cerveza: TillProduct = {
      ...cafe,
      id: "cerveza",
      menuItemId: "menu-item-cerveza",
      name: "Cerveza",
      customerName: { es: "Cerveza para el cliente" },
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

it("shows a retained table line's recorded name and modifier answer after live names change", async () => {
  const { el } = await mount({
    products: [
      { ...cafe, name: "Nuevo nombre", customerName: { es: "Nuevo nombre para el cliente" } },
    ],
    lines: [
      {
        ...pendingLine,
        name: "Nombre guardado",
        optionSnapshots: [
          {
            listName: { es: "Cortar" },
            listCustomerName: null,
            listKitchenName: null,
            labelName: { es: "Fino" },
            labelCustomerName: null,
            labelKitchenName: null,
          },
        ],
      },
    ],
  });
  await openDrawer(el);
  const row = el.shadowRoot!.querySelector(".pending-line")!;
  expect(row.textContent).toContain("Nombre guardado");
  // The saved snapshot resolves the modifier name and the chosen label, not the live catalogue name.
  expect(row.textContent).toContain("Cortar");
  expect(row.textContent).not.toContain("Nuevo nombre");
});

it("shows a tab line's frozen options answers in the STAFF wording", async () => {
  // Three different texts per name, so the assertion fails if the tab reads the kitchen or the
  // customer side by mistake (CLAUDE.md §3).
  const { el } = await mount({
    lines: [
      {
        ...pendingLine,
        name: "Nombre guardado",
        optionSnapshots: [
          {
            listName: { es: "Punto personal" },
            listCustomerName: { "es-ES": "¿Cómo lo quiere?" },
            listKitchenName: "PTO",
            labelName: { es: "Poco personal" },
            labelCustomerName: { "es-ES": "Poco hecho" },
            labelKitchenName: "PH",
          },
        ],
      },
    ],
  });
  await openDrawer(el);
  expect(
    [...el.shadowRoot!.querySelectorAll(".modifier-answer")].map((answer) => answer.textContent),
  ).toEqual(["Punto personal: Poco personal"]);
});
