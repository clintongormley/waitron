import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillTableOrderScreen, type TableServiceStatus } from "./till-table-order-screen.js";
import { formatMoney } from "../i18n/format.js";
import { t } from "../i18n/t.js";
import type { TabLine, TableState, TillProduct } from "../api/client.js";
import type { TillProductGrid } from "../widgets/product-grid.js";
import type { TillTenderPay } from "../widgets/tender-pay.js";

const cafe: TillProduct = {
  id: "cafe",
  descriptions: { es: "Café" },
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
  state: "queued",
};
const servedLine: TabLine = {
  lineNo: 2,
  productId: "cafe",
  quantity: "1.000",
  unitPriceGross: "1.50",
  servedAt: "2026-08-20T10:00:00.000Z",
  courseId: null,
  firedAt: "2026-08-20T09:59:00.000Z",
  state: "queued",
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

  // ── Menu diet filter (dietary-classification, Task 7) ────────────────────────────────────────
  it("shows NO diet filter when no product carries a published diet", async () => {
    const { el } = await mount(); // cafe only — no diet
    expect(el.shadowRoot!.querySelector("till-diet-filter")).toBeNull();
  });

  it("shows the diet filter and narrows the round grid to the picked lens", async () => {
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

  it("hides the pay section when settlement is disabled (an order-only handheld)", async () => {
    // A handheld takes and fires orders but never settles payment (the server firewall is the real
    // guarantee; this is the honest UI). With `canSettle=false` the pay section is gone.
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
    // BOTH tenders — cash and the manual (datáfono) card. A handheld settles either on `POST /api/sales`;
    // only the INTEGRATED reader (`/api/pay`) is fenced server-side.
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
    // The old disabled "Move · Split" placeholder is now a live control reading "Table actions".
    expect(trigger.textContent).toContain(t("table.actions_title"));
    expect(trigger.hasAttribute("disabled")).toBe(false);
    // Tapping it opens the in-drawer action menu.
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

  // --- Embedded chrome seam (SP-B2.2): a card host supplies the title + Back; the pending-round
  // drawer handle is body FUNCTION and survives in the always-present actions bar (spec §7). ---

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

  it("send-round threads a line's selected modifier options as bare optionGroupItemIds (ordering modifiers)", async () => {
    const { el } = await mount();
    // Seed the round store with a modifier-carrying line (the picker, Task 10, is what will produce these
    // through the UI); only the `optionGroupItemId`s reach the wire — never the display name/priceDelta.
    grid(el).store.addProduct(cafe, "1", [
      { optionGroupItemId: "opt-oat", name: { es: "Leche de avena" }, priceDelta: "0.50" },
    ]);
    await el.updateComplete;
    let captured: CustomEvent | undefined;
    el.addEventListener("send-round", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>("[data-send-round]")!.click();
    expect(captured!.detail.lines).toEqual([
      { productId: "cafe", quantity: "1", options: [{ optionGroupItemId: "opt-oat" }] },
    ]);
  });

  it("send-round forwards a per-option quantity > 1 and OMITS it at 1 (per-option quantity, feature A)", async () => {
    const { el } = await mount();
    grid(el).store.addProduct(cafe, "1", [
      {
        optionGroupItemId: "opt-shot",
        name: { es: "Extra chupito" },
        priceDelta: "0.50",
        quantity: 2,
      },
      {
        optionGroupItemId: "opt-oat",
        name: { es: "Leche de avena" },
        priceDelta: "0.50",
        quantity: 1,
      },
    ]);
    await el.updateComplete;
    let captured: CustomEvent | undefined;
    el.addEventListener("send-round", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>("[data-send-round]")!.click();
    expect(captured!.detail.lines).toEqual([
      {
        productId: "cafe",
        quantity: "1",
        options: [
          { optionGroupItemId: "opt-shot", quantity: 2 },
          { optionGroupItemId: "opt-oat" }, // quantity 1 → omitted
        ],
      },
    ]);
  });

  // Per-line note + meat-gated doneness (order-line customisation, Task 4b): the round bar reuses
  // `till-basket`, so its per-line Note affordance is available on the table-order screen too (parity
  // with the counter). A note set on a round line via that affordance reaches the round store and is
  // forwarded by `send-round` (via `toWireLineExtras`), the same wire path as the counter's sale lines.
  it("forwards a per-line note set through the round basket's Note affordance on send-round (parity)", async () => {
    const { el } = await mount();
    // Ring a café into the current round through the grid (a plain fast-add, no picker).
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
      { productId: "cafe", quantity: "1", note: "table 4 — no ice" },
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

  // ── Coursing editing (A3): the round bar's per-line HOLD toggle ─────────────────────────────────────

  /** Rings one café into the current round (the grid tile) and returns the per-line hold switches. */
  async function ringAndHolds(el: TillTableOrderScreen): Promise<HTMLElement[]> {
    grid(el).shadowRoot!.querySelector<HTMLElement>("wt-button.tile")!.click();
    await el.updateComplete;
    return [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-round-hold]")];
  }

  /** Toggles a round line's hold `wt-switch` by clicking its inner native checkbox — the same pattern
   * `tender-pay.test.ts`/`wt-switch.test.ts` use (a real `click()` flips `checked` before `change`). */
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
    expect(captured!.detail.lines).toEqual([{ productId: "cafe", quantity: "1" }]);
  });

  it("send-round threads hold: true for a line the waiter held", async () => {
    const { el } = await mount({ courses });
    const [hold] = await ringAndHolds(el);
    // Hold the café line — inserted but not fired.
    await toggleHold(el, hold!);
    let captured: CustomEvent | undefined;
    el.addEventListener("send-round", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>("[data-send-round]")!.click();
    // The course is untouched (no override), so only `hold: true` rides alongside productId + quantity.
    expect(captured!.detail.lines).toEqual([{ productId: "cafe", quantity: "1", hold: true }]);
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
    expect(captured!.detail.lines).toEqual([{ productId: "cafe", quantity: "1" }]);
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
    firedAt: null,
    state: "queued",
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

  // ── Coursing editing (A1): moving a NOT-yet-fired tab line into a different course ──────────────────

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

  // ── Coursing corrections (C5): per-line Send / Recall / Cancel, gated on the line's kitchen state ───
  describe("send / recall / cancel line actions (C5)", () => {
    // A line the kitchen has already STARTED (fired + preparing/ready) — the cancel-only case.
    const preparingLine: TabLine = { ...pendingLine, lineNo: 1, state: "preparing" };
    const readyLine: TabLine = { ...pendingLine, lineNo: 1, state: "ready" };
    // A CHILD MODIFIER line (ordering modifiers): productId null, no ticket item of its own, so firedAt
    // AND state are both null — the shape whose null firedAt would wrongly fall into the HELD/Send branch
    // and whose held-shape would paint an editable course picker, if the child guard were absent.
    const childLine: TabLine = {
      lineNo: 2,
      productId: null,
      quantity: "1.000",
      unitPriceGross: "0.50",
      servedAt: null,
      courseId: null,
      firedAt: null,
      state: null,
    };

    it("renders NO per-line action and NO course picker on a child modifier line (productId null)", async () => {
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

    it("hides Send all on a fully-fired tab that merely contains a modifier'd dish (child excluded)", async () => {
      // pendingLine: firedAt set (fired). childLine: firedAt null but productId null ⇒ NOT held.
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
      expect(el.shadowRoot!.querySelector('[data-cancel-line="1"]')).toBeNull();

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

  // ── TS-3/TS-4: the in-drawer move / join / merge / transfer table-action flow ──────────────────────
  describe("table actions (TS-3/TS-4)", () => {
    /** A TableState with sane defaults (all required fields) — override only what a case needs. */
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

    /** Opens the drawer and taps the Table-actions trigger, leaving the action menu open. */
    async function toMenu(el: TillTableOrderScreen): Promise<void> {
      await openDrawer(el);
      el.shadowRoot!.querySelector<HTMLElement>("[data-move-split]")!.click();
      await el.updateComplete;
    }
    const click = (el: TillTableOrderScreen, selector: string) =>
      el.shadowRoot!.querySelector<HTMLElement>(selector)!.click();

    it("shows the four action verbs plus a disabled Split and a Back control", async () => {
      const { el } = await mount({ lines: [pendingLine], tables: [] });
      await toMenu(el);
      for (const verb of ["move", "join", "merge", "transfer"]) {
        expect(el.shadowRoot!.querySelector(`[data-action="${verb}"]`)).not.toBeNull();
      }
      const split = el.shadowRoot!.querySelector(`[data-action="split"]`)!;
      expect(split.hasAttribute("disabled")).toBe(true);
      expect(el.shadowRoot!.querySelector("[data-action-back]")).not.toBeNull();
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
      descriptions: { es: "Bocadillo" },
      courseId: null,
      catalogueId: "cat-food",
      catalogueName: "Comida",
    };
    const cerveza: TillProduct = {
      ...cafe,
      id: "cerveza",
      descriptions: { es: "Cerveza" },
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
