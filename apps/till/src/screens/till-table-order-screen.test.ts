import { WorkingOrderStore } from "../state/working-order.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { WtCombobox } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { formatMoney } from "@waitron/shared";
import { cleanupWidgets, mountWidget, servedMenus } from "../widgets/test-helpers.js";
import { resized } from "./till-table-order-screen.test-helpers.js";
import {
  TillTableOrderScreen,
  type AdjustDetail,
  type TableServiceStatus,
} from "./till-table-order-screen.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type {
  OfferedModifier,
  OrderGroup,
  PartyBill,
  PrintProblem,
  TabLine,
  TableParty,
  TableState,
  TillProduct,
  TillZoneMenu,
} from "../api/client.js";
import type { TillMenuBrowser } from "../widgets/menu-browser.js";
import type { TillModifierPicker } from "../widgets/modifier-picker.js";
import type { TillTenderPay } from "../widgets/tender-pay.js";

const cafe: TillProduct = {
  id: "cafe",
  menuItemId: "menu-item-cafe",
  catalogueId: "menu-table",
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
  stationId: null,
  movable: false,
  id: "line-1",
  groupId: null,
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
  stationId: null,
  movable: false,
  id: "line-2",
  groupId: null,
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

/** A menu listing `offered` in order, with a default layout holding no shortcuts, so the browser's
 * first tiles are these products. */
function servedMenu(
  id: string,
  name: string,
  isDefault: boolean,
  offered: TillProduct[],
): TillZoneMenu {
  const offers = offered.map((product) => ({
    id: product.menuItemId!,
    menuId: id,
    productId: product.productId ?? product.id,
  }));
  return servedMenus([{ id, name, isDefault, versionId: `${id}-v1` }], offers)[0]!;
}

const mount = (over: Partial<TillTableOrderScreen> = {}) =>
  mountWidget<TillTableOrderScreen>("till-table-order-screen", {
    products,
    menus: [servedMenu("menu-table", "Carta", true, over.products ?? products)],
    lines: [],
    statuses: [],
    ...over,
  });

const grid = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!;
/** Only present while the drawer is open. */
const tender = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<TillTenderPay>("till-tender-pay")!;
async function openDrawer(el: TillTableOrderScreen): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
  await el.updateComplete;
}

afterEach(cleanupWidgets);

const draftAction = (el: TillTableOrderScreen, kind: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-draft-action="${kind}"]`);

/** The draft line's selection toggle whose text names `name`. */
const draftToggle = (el: TillTableOrderScreen, name: string) =>
  [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-draft-select]")].find((toggle) =>
    toggle.textContent!.includes(name),
  )!;

/** Below the side-by-side width, as in Vitest's default frame, the draft is on its Review view. */
async function openReview(el: TillTableOrderScreen): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>("[data-review-open]")!.click();
  await el.updateComplete;
}

const previewDialog = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>("[data-draft-preview]")!;

/** Presses a draft action and answers the preview it opens; the preview's text is returned. */
async function openPreview(el: TillTableOrderScreen, kind: string): Promise<string> {
  draftAction(el, kind)!.click();
  await el.updateComplete;
  expect(previewDialog(el).open).toBe(true);
  return previewDialog(el).querySelector("[data-preview-body]")!.textContent!.replace(/\s+/g, " ");
}

/** Confirms the open preview and returns the `submit-draft` it dispatched. */
function confirmPreview(el: TillTableOrderScreen): CustomEvent | undefined {
  let captured: CustomEvent | undefined;
  el.addEventListener("submit-draft", (e) => (captured = e as CustomEvent), { once: true });
  el.shadowRoot!.querySelector<HTMLElement>("[data-draft-confirm]")!.click();
  return captured;
}

async function submitDraft(
  el: TillTableOrderScreen,
  kind: string,
): Promise<CustomEvent | undefined> {
  await openPreview(el, kind);
  return confirmPreview(el);
}

/** Each of `controls` whose tap target — a `wt-button`'s inner button, else the control itself —
 * renders under 44 px on either axis, named by its data attributes and measured size. */
function underTapSize(controls: Iterable<Element>): string[] {
  return [...controls].flatMap((control) => {
    const { width, height } = (
      control.shadowRoot?.querySelector("button") ?? control
    ).getBoundingClientRect();
    if (width >= 44 && height >= 44) return [];
    const name = [...control.attributes]
      .filter((attribute) => attribute.name.startsWith("data-"))
      .map((attribute) => `${attribute.name}=${attribute.value}`)
      .join(" ");
    return [`${name} ${width}×${height}`];
  });
}

function orderGroup(id: string, state: OrderGroup["state"]): OrderGroup {
  return {
    id,
    position: 1,
    state,
    firedAt: state === "fired" ? "2026-08-20T09:59:00.000Z" : null,
    remindAt: null,
    lineIds: [],
    summary: "",
  };
}

const anaParty: TableParty = {
  id: "v1",
  revision: 3,
  guestCount: 3,
  state: "open",
  name: "Ana",
  displayName: "Ana",
  mainBillId: "wo-4",
  outstanding: "44.00",
  billCount: 5,
  tableIds: ["t4"],
  unsentDrafts: [],
  reminder: null,
};
const bill = (over: Partial<PartyBill>): PartyBill => ({
  workingOrderId: "wo-4",
  revision: 0,
  invoiceType: "F2",
  recipient: null,
  partyId: "v1",
  label: null,
  status: "open",
  total: "14.00",
  outstanding: "14.00",
  hasPayments: false,
  receiptAvailable: false,
  ...over,
});
/** The party's main bill, and a bill split off it, both untouched. */
const tabBill = bill({});
const checkBill = bill({ workingOrderId: "wo-check", total: "30.00", outstanding: "30.00" });
const paidBill = bill({ workingOrderId: "wo-paid", status: "settled", outstanding: "0.00" });
const placedBill = bill({ workingOrderId: "wo-placed", status: "placed" });
/** Open, with money already received against it. */
const partlyPaidBill = bill({ workingOrderId: "wo-part", outstanding: "4.00", hasPayments: true });
/** Open, but recorded on a party merged into this one. */
const mergedPartyBill = bill({ workingOrderId: "wo-merged", partyId: "v0" });
const partyBills = () => ({
  party: anaParty,
  bills: [tabBill, checkBill, paidBill, placedBill, partlyPaidBill, mergedPartyBill],
});

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
    expect(productGrid.products).toEqual(products);
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

  it("accumulates a round and emits submit-draft with the picked lines once the preview is confirmed, keeping the round for the app to empty once sent", async () => {
    const { el } = await mount();
    // Pick a café into the current round (the grid rings an `each` tile straight into its store).
    grid(el).shadowRoot!.querySelector<HTMLElement>("wt-button.tile")!.click();
    await el.updateComplete;

    const captured = await submitDraft(el, "fire-all");

    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
    expect(captured!.detail.lines).toEqual([{ menuItemId: "menu-item-cafe", quantity: "1" }]);
    expect(captured!.detail.groups).toEqual([{ release: "fire", lineIndexes: [0] }]);
    // The round stays until the app has the server's answer: a refused round must not be lost.
    expect(captured!.detail.store).toBe(grid(el).store);
    expect(captured!.detail.sent).toEqual(grid(el).store.lines);
    expect(grid(el).store.lineCount).toBe(1);
  });

  it("says a round is being sent, and shuts its controls, until the app has the answer", async () => {
    const { el } = await mount();
    grid(el).shadowRoot!.querySelector<HTMLElement>("wt-button.tile")!.click();
    await el.updateComplete;
    grid(el).store.sending = true;
    await el.updateComplete;

    const status = el.shadowRoot!.querySelector<HTMLElement>("[data-round-sending]");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status!.textContent).toContain(t("table.round_sending"));
    expect(el.shadowRoot!.querySelector("[data-round-controls]")!.hasAttribute("inert")).toBe(true);
    for (const action of el.shadowRoot!.querySelectorAll("[data-draft-action]"))
      expect(action.hasAttribute("disabled")).toBe(true);

    grid(el).store.sending = false;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-round-sending]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-round-controls]")!.hasAttribute("inert")).toBe(
      false,
    );
  });

  it("sends a zone offer by menu-item identity", async () => {
    const offer = { ...cafe, menuItemId: "offer-cafe", productId: cafe.id };
    const { el } = await mount({ products: [offer] });
    grid(el).shadowRoot!.querySelector<HTMLElement>("wt-button.tile")!.click();
    await el.updateComplete;

    const captured = await submitDraft(el, "fire-all");

    expect(captured!.detail.lines).toEqual([{ menuItemId: "offer-cafe", quantity: "1" }]);
  });

  it("disables the draft's actions while the current round is empty", async () => {
    const { el } = await mount();
    const actions = [...el.shadowRoot!.querySelectorAll("[data-draft-action]")];
    expect(actions.map((action) => action.getAttribute("data-draft-action"))).toEqual([
      "send-all",
      "fire-all",
    ]);
    for (const action of actions) expect(action.hasAttribute("disabled")).toBe(true);
    grid(el).shadowRoot!.querySelector<HTMLElement>("wt-button.tile")!.click();
    await el.updateComplete;
    for (const action of el.shadowRoot!.querySelectorAll("[data-draft-action]"))
      expect(action.hasAttribute("disabled")).toBe(false);
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

  // Marking served moved into Current orders (till-table-order-screen.current-orders.test.ts): an
  // unserved row offers it and a served one does not, a dish's extras never do, and a press emits
  // `serve-lines`. The bill's lines no longer carry a whole-line tick.
  it("splits the drawer into Pendiente de servir and Servido lines", async () => {
    const { el } = await mount({ lines: [pendingLine, servedLine] });
    await openDrawer(el);
    expect(el.shadowRoot!.querySelectorAll(".pending-line")).toHaveLength(1);
    expect(el.shadowRoot!.querySelectorAll(".served-line")).toHaveLength(1);
    expect(el.shadowRoot!.querySelector("[data-serve]")).toBeNull();
    const text = el.shadowRoot!.textContent ?? "";
    expect(text).toContain(t("table.pending_title"));
    expect(text).toContain(t("table.served_title"));
  });

  it("keeps an extras row's figures in its dish's columns", async () => {
    const extra = { ...pendingLine, lineNo: 2, parentLineNo: 1, quantity: "2.000" };
    const { el } = await mount({ lines: [pendingLine, extra] });
    await openDrawer(el);
    const pending = [...el.shadowRoot!.querySelectorAll(".pending-line")];
    expect(pending).toHaveLength(2);
    const totalRight = (row: Element) =>
      Math.round(row.querySelector(".line-total")!.getBoundingClientRect().right);
    expect(totalRight(pending[1]!)).toBe(totalRight(pending[0]!));
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

  async function ringAndPickers(el: TillTableOrderScreen): Promise<WtCombobox[]> {
    grid(el).shadowRoot!.querySelector<HTMLElement>("wt-button.tile")!.click();
    await el.updateComplete;
    return [...el.shadowRoot!.querySelectorAll<WtCombobox>("[data-round-course]")];
  }

  it("renders a per-line course picker per round line, pre-selecting the product's default course", async () => {
    const { el } = await mount({ courses });
    // No round yet ⇒ no picker.
    expect(el.shadowRoot!.querySelector("[data-draft-sections]")).toBeNull();
    const [picker] = await ringAndPickers(el);
    // One select for the one round line, pre-selected to the café's default course (Postres), with an
    // option per active venue course plus the "use default" placeholder.
    expect(picker).not.toBeUndefined();
    expect(picker!.value).toBe("postres");
    const optionValues = picker!.options.map((o) => o.value);
    expect(optionValues).toEqual(["", "entrantes", "postres"]);
  });

  it("picks a draft line's course from a compact shared dropdown, named for the line", async () => {
    const { el } = await mount({ courses });
    grid(el).shadowRoot!.querySelector<HTMLElement>("wt-button.tile")!.click();
    await el.updateComplete;
    const picker = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-round-course="0"]');
    expect(picker).not.toBeNull();
    expect(picker!.name).toBe("course");
    expect(picker!.hideLabel).toBe(true);
    expect(picker!.label).toBe(`${t("table.course_label")} · Café`);
    expect(picker!.getAttribute("search")).toBe("auto");
    expect(picker!.searchPlaceholder).toBe(t("form.combobox_search"));
    expect(picker!.noResultsLabel).toBe(t("form.combobox_no_results"));
    expect(picker!.placeholder).toBe(t("table.course_default"));
    expect(picker!.options).toEqual([
      { value: "", label: t("table.course_default") },
      { value: "entrantes", label: "Entrantes" },
      { value: "postres", label: "Postres" },
    ]);
    expect(picker!.value).toBe("postres");

    await chooseOption(picker!, "entrantes");
    await el.updateComplete;
    const captured = await submitDraft(el, "fire-all");
    expect(captured!.detail.lines).toEqual([
      { menuItemId: "menu-item-cafe", quantity: "1", courseId: "entrantes" },
    ]);
  });

  it("keeps a draft line's course box a whole tap target tall on the till's screen", async () => {
    await page.viewport(1024, 768);
    try {
      const { el, host } = await mount({ courses });
      await resized(el);
      host.style.setProperty("--wt-tap-min", "60px");
      grid(el).shadowRoot!.querySelector<HTMLElement>("wt-button.tile")!.click();
      await el.updateComplete;
      const picker = el.shadowRoot!.querySelector<WtCombobox>(
        'wt-combobox[data-round-course="0"]',
      )!;
      await picker.updateComplete;
      const box = picker.shadowRoot!.querySelector<HTMLElement>("[part=field]")!;
      expect(box.getBoundingClientRect().height).toBeGreaterThanOrEqual(60);
    } finally {
      await page.viewport(414, 896);
    }
  });

  it("keeps a draft line's course box within its line when the chosen course has a long name", async () => {
    await page.viewport(1024, 768);
    try {
      const long = {
        id: "long",
        name: "Platos para compartir al centro de la mesa".padEnd(60, "x"),
        displayOrder: 2,
      };
      const { el } = await mount({ courses: [...courses, long] });
      await resized(el);
      grid(el).shadowRoot!.querySelector<HTMLElement>("wt-button.tile")!.click();
      await el.updateComplete;
      await chooseOption(
        el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-round-course="0"]')!,
        "long",
      );
      await el.updateComplete;
      const picker = el.shadowRoot!.querySelector<WtCombobox>(
        'wt-combobox[data-round-course="0"]',
      )!;
      await picker.updateComplete;
      expect(picker.value).toBe("long");
      const box = picker
        .shadowRoot!.querySelector<HTMLElement>("[part=field]")!
        .getBoundingClientRect();
      const line = picker
        .closest(".draft-line-tools")!
        .assignedSlot!.closest(".line-after")!
        .getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(line.left - 0.5);
      expect(box.right).toBeLessThanOrEqual(line.right + 0.5);
    } finally {
      await page.viewport(414, 896);
    }
  });

  it("hides the course picker when the venue has no courses to pick", async () => {
    const { el } = await mount({ courses: [] });
    await ringAndPickers(el);
    expect(el.shadowRoot!.querySelector("[data-round-course]")).toBeNull();
  });

  it("OMITS courseId for an unoverridden line (the server applies the product default)", async () => {
    const { el } = await mount({ courses });
    await ringAndPickers(el);
    const captured = await submitDraft(el, "fire-all");
    // No override picked ⇒ the line carries only menuItemId + quantity; the server resolves the product's
    // default course from `<override> ?? product.course_id`.
    expect(captured!.detail.lines).toEqual([{ menuItemId: "menu-item-cafe", quantity: "1" }]);
  });

  it("threads the picked course OVERRIDE for a line the waiter re-pointed", async () => {
    const { el } = await mount({ courses });
    const [picker] = await ringAndPickers(el);
    // Override the café line from its default (Postres) to Entrantes.
    await chooseOption(picker!, "entrantes");
    await el.updateComplete;
    const captured = await submitDraft(el, "fire-all");
    expect(captured!.detail.lines).toEqual([
      { menuItemId: "menu-item-cafe", quantity: "1", courseId: "entrantes" },
    ]);
  });

  it("threads a line's picks as one entry per list, naming products and counts alone", async () => {
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
    const captured = await submitDraft(el, "fire-all");
    expect(captured!.detail.lines).toEqual([
      {
        menuItemId: "menu-item-cafe",
        quantity: "1",
        extras: [{ listId: "list-milk", picks: [{ productId: "p-oat", quantity: 1 }] }],
      },
    ]);
  });

  it("carries each pick's own per-dish count, and groups two lists separately", async () => {
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
    const captured = await submitDraft(el, "fire-all");
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

  it("forwards a per-line note set through the round basket's Note affordance on submission (parity)", async () => {
    const { el } = await mount();
    grid(el).shadowRoot!.querySelector<HTMLElement>("wt-button.tile")!.click();
    await el.updateComplete;

    // Open THAT round line's editor via the basket's Note button and type a note.
    const basket = el.shadowRoot!.querySelector("till-basket")!;
    await (basket as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    basket.shadowRoot!.querySelector<HTMLElement>('[data-test="line-note-button-0"]')!.click();
    await (basket as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    const note = basket
      .shadowRoot!.querySelector('[data-test="line-note"]')!
      .shadowRoot!.querySelector("textarea")!;
    note.value = "table 4 — no ice";
    note.dispatchEvent(new Event("input"));
    await el.updateComplete;

    const captured = await submitDraft(el, "fire-all");
    expect(captured!.detail.lines).toEqual([
      { menuItemId: "menu-item-cafe", quantity: "1", note: "table 4 — no ice" },
    ]);
  });

  it("picking the default placeholder clears the override back to the product default (omitted)", async () => {
    const { el } = await mount({ courses });
    const [picker] = await ringAndPickers(el);
    await chooseOption(picker!, "entrantes");
    await el.updateComplete;
    // Back to the "use default" placeholder ⇒ no override sent.
    await chooseOption(picker!, "");
    await el.updateComplete;
    const captured = await submitDraft(el, "fire-all");
    expect(captured!.detail.lines).toEqual([{ menuItemId: "menu-item-cafe", quantity: "1" }]);
  });

  it("offers no hold switch: Send all sends the line held, and Fire all now sends it released now", async () => {
    const { el } = await mount({ courses });
    grid(el).shadowRoot!.querySelector<HTMLElement>("wt-button.tile")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-round-hold]")).toBeNull();
    // The group, not the line, carries the hold.
    const held = await submitDraft(el, "send-all");
    expect(held!.detail.lines).toEqual([{ menuItemId: "menu-item-cafe", quantity: "1" }]);
    expect(held!.detail.groups).toEqual([{ release: "hold", lineIndexes: [0] }]);
    const fired = await submitDraft(el, "fire-all");
    expect(fired!.detail.lines).toEqual([{ menuItemId: "menu-item-cafe", quantity: "1" }]);
    expect(fired!.detail.groups).toEqual([{ release: "fire", lineIndexes: [0] }]);
  });

  describe("a round of two courses", () => {
    const pan: TillProduct = {
      ...cafe,
      id: "pan",
      menuItemId: "menu-item-pan",
      courseId: "entrantes",
    };

    async function ringTwoCourses(el: TillTableOrderScreen): Promise<void> {
      // Rung dessert first, so a grouping that follows the ringing order rather than the courses fails.
      grid(el).store.addProduct(cafe, "1");
      grid(el).store.addProduct(pan, "2");
      await el.updateComplete;
    }

    it("Send all holds one group per course, in the venue's order", async () => {
      const { el } = await mount({ courses, products: [cafe, pan] });
      await ringTwoCourses(el);
      const sent = await submitDraft(el, "send-all");
      expect(sent!.detail.lines).toEqual([
        { menuItemId: "menu-item-pan", quantity: "2" },
        { menuItemId: "menu-item-cafe", quantity: "1" },
      ]);
      expect(sent!.detail.groups).toEqual([
        { release: "hold", lineIndexes: [0] },
        { release: "hold", lineIndexes: [1] },
      ]);
    });

    it("Fire all now fires both courses as one group, in the venue's order", async () => {
      const { el } = await mount({ courses, products: [cafe, pan] });
      await ringTwoCourses(el);
      const sent = await submitDraft(el, "fire-all");
      expect(sent!.detail.lines).toEqual([
        { menuItemId: "menu-item-pan", quantity: "2" },
        { menuItemId: "menu-item-cafe", quantity: "1" },
      ]);
      expect(sent!.detail.groups).toEqual([{ release: "fire", lineIndexes: [0, 1] }]);
    });

    it("groups a line by the course the waiter picked over its product's", async () => {
      const { el } = await mount({ courses, products: [cafe, pan] });
      await ringTwoCourses(el);
      const picker = el.shadowRoot!.querySelector<WtCombobox>('[data-round-course="0"]')!;
      await chooseOption(picker, "entrantes");
      await el.updateComplete;
      const sent = await submitDraft(el, "send-all");
      expect(sent!.detail.groups).toEqual([{ release: "hold", lineIndexes: [0, 1] }]);
    });
  });

  describe("the draft in sections, and its actions", () => {
    const serviceCourses = [
      // Listed out of display order, so a screen that keeps the list's order fails.
      { id: "mains", name: "Mains", displayOrder: 2 },
      { id: "drinks", name: "Drinks", displayOrder: 0 },
      { id: "starters", name: "Starters", displayOrder: 1 },
    ];
    const dish = (id: string, name: string, courseId: string | null): TillProduct => ({
      ...cafe,
      id,
      menuItemId: `offer-${id}`,
      name,
      customerName: { es: `${name} para el cliente` },
      courseId,
    });
    const beer = dish("beer", "Beer", "drinks");
    const croquetas = dish("croquetas", "Croquetas", "starters");
    const steak = dish("steak", "Steak", "mains");
    const bread = dish("bread", "Bread", null);
    const menu = [beer, croquetas, steak, bread];

    function heldGroup(id: string, position: number, summary: string): OrderGroup {
      return { ...orderGroup(id, "held"), position, summary };
    }
    function firedGroup(id: string, position: number, summary: string): OrderGroup {
      return { ...orderGroup(id, "fired"), position, summary };
    }

    async function ring(el: TillTableOrderScreen, ...rung: [TillProduct, string][]) {
      for (const [product, quantity] of rung) grid(el).store.addProduct(product, quantity);
      await el.updateComplete;
    }

    const sectionNames = (el: TillTableOrderScreen) =>
      [...el.shadowRoot!.querySelectorAll("[data-draft-section]")].map((section) => ({
        heading: section.querySelector(".draft-section-name")?.textContent?.trim() ?? null,
        lines: [...section.querySelectorAll("[data-draft-select]")].map((toggle) =>
          toggle.textContent!.replace(/[☑☐]/g, "").replace(/\s+/g, " ").trim(),
        ),
      }));

    const actionKinds = (el: TillTableOrderScreen) =>
      [...el.shadowRoot!.querySelectorAll("[data-draft-action]")].map((action) =>
        action.getAttribute("data-draft-action"),
      );

    async function toggle(el: TillTableOrderScreen, name: string): Promise<void> {
      draftToggle(el, name).click();
      await el.updateComplete;
    }

    it("shows Beer, Croquetas and Steak in three sections in the venue's course order, a dish with no default in the first", async () => {
      const { el } = await mount({ courses: serviceCourses, products: menu });
      await ring(el, [steak, "1"], [beer, "1"], [bread, "1"], [croquetas, "1"]);
      expect(sectionNames(el)).toEqual([
        { heading: "Drinks", lines: ["Beer ×1", "Bread ×1"] },
        { heading: "Starters", lines: ["Croquetas ×1"] },
        { heading: "Mains", lines: ["Steak ×1"] },
      ]);
    });

    it("moves a line to the section of the course the waiter picks", async () => {
      const { el } = await mount({ courses: serviceCourses, products: menu });
      await ring(el, [steak, "1"], [beer, "1"]);
      const picker = el.shadowRoot!.querySelector<WtCombobox>('[data-round-course="0"]')!;
      await chooseOption(picker, "drinks");
      await el.updateComplete;
      expect(sectionNames(el)).toEqual([{ heading: "Drinks", lines: ["Steak ×1", "Beer ×1"] }]);
    });

    it("shows one section with no heading when the venue has no courses, and still lets a line be picked", async () => {
      const { el } = await mount({ courses: [], products: menu });
      await ring(el, [steak, "1"], [beer, "1"]);
      expect(sectionNames(el)).toEqual([{ heading: null, lines: ["Steak ×1", "Beer ×1"] }]);
      await toggle(el, "Beer");
      expect(actionKinds(el)).toEqual(["send-selected", "fire-selected"]);
    });

    describe("actions show their scope before acting", () => {
      it("offers Send all and Fire all now with nothing checked", async () => {
        const { el } = await mount({ courses: serviceCourses, products: menu });
        await ring(el, [beer, "2"], [steak, "1"]);
        expect(actionKinds(el)).toEqual(["send-all", "fire-all"]);
        expect(draftAction(el, "send-all")!.textContent).toContain(t("table.draft_send_all"));
        expect(draftAction(el, "fire-all")!.textContent).toContain(t("table.draft_fire_all"));
      });

      it("offers Send selected and Fire selected now with two lines checked, and the toggles say which", async () => {
        const { el } = await mount({ courses: serviceCourses, products: menu });
        await ring(el, [beer, "2"], [croquetas, "1"], [steak, "1"]);
        await toggle(el, "Beer");
        await toggle(el, "Steak");
        // Read from the native button, the element a screen reader announces as pressed or not.
        const pressed = (name: string) => {
          const button = draftToggle(el, name);
          expect(button).toBeInstanceOf(HTMLButtonElement);
          return button.getAttribute("aria-pressed");
        };
        expect(pressed("Beer")).toBe("true");
        expect(pressed("Croquetas")).toBe("false");
        expect(pressed("Steak")).toBe("true");
        expect(actionKinds(el)).toEqual(["send-selected", "fire-selected"]);
        expect(draftAction(el, "send-selected")!.textContent).toContain(
          t("table.draft_send_selected"),
        );
        expect(draftAction(el, "fire-selected")!.textContent).toContain(
          t("table.draft_fire_selected"),
        );

        await toggle(el, "Beer");
        await toggle(el, "Steak");
        expect(actionKinds(el)).toEqual(["send-all", "fire-all"]);
      });

      it("previews each action: the items fired now and the groups held", async () => {
        const { el } = await mount({ courses: serviceCourses, products: menu });
        await ring(el, [beer, "2"], [croquetas, "1"], [steak, "1"]);
        expect(await openPreview(el, "send-all")).toContain("Hold: 3 groups.");
        el.shadowRoot!.querySelector<HTMLElement>("[data-draft-dismiss]")!.click();
        await el.updateComplete;
        expect(await openPreview(el, "fire-all")).toContain("Fire now: 4 items.");
        el.shadowRoot!.querySelector<HTMLElement>("[data-draft-dismiss]")!.click();
        await el.updateComplete;

        await toggle(el, "Beer");
        await toggle(el, "Croquetas");
        expect(await openPreview(el, "fire-selected")).toContain("Fire now: 3 items.");
        el.shadowRoot!.querySelector<HTMLElement>("[data-draft-dismiss]")!.click();
        await el.updateComplete;
        expect(await openPreview(el, "send-selected")).toContain("Hold: 1 group.");
      });

      it("keeps Send selected and Fire selected now inside a phone-width screen", async () => {
        const { el, host } = await mount({ courses: serviceCourses, products: menu });
        host.style.width = "390px";
        await ring(el, [beer, "1"], [steak, "1"]);
        await toggle(el, "Beer");
        await openReview(el);
        const edge = el.getBoundingClientRect().right;
        const actions = [...el.shadowRoot!.querySelectorAll("[data-draft-action]")];
        expect(actions.length).toBe(2);
        expect(
          actions.filter((action) => action.getBoundingClientRect().right > edge + 0.5),
        ).toEqual([]);
      });

      it("counts a weighed line as one item", async () => {
        const { el } = await mount({ courses: serviceCourses, products: menu });
        await ring(el, [jamon, "0.250"], [beer, "2"]);
        expect(await openPreview(el, "fire-all")).toContain("Fire now: 3 items.");
      });

      it("sends nothing when the preview is dismissed", async () => {
        const { el } = await mount({ courses: serviceCourses, products: menu });
        await ring(el, [beer, "1"]);
        let sent = false;
        el.addEventListener("submit-draft", () => (sent = true));
        await openPreview(el, "fire-all");
        el.shadowRoot!.querySelector<HTMLElement>("[data-draft-dismiss]")!.click();
        await el.updateComplete;
        expect(previewDialog(el).open).toBe(false);
        expect(sent).toBe(false);
      });

      it("confirming sends exactly the groups the preview named", async () => {
        const { el } = await mount({ courses: serviceCourses, products: menu });
        await ring(el, [steak, "1"], [beer, "2"], [croquetas, "1"]);

        expect(await openPreview(el, "send-all")).toContain("Hold: 3 groups.");
        const all = confirmPreview(el)!;
        expect(all.detail.lines).toEqual([
          { menuItemId: "offer-beer", quantity: "2" },
          { menuItemId: "offer-croquetas", quantity: "1" },
          { menuItemId: "offer-steak", quantity: "1" },
        ]);
        expect(all.detail.groups).toEqual([
          { release: "hold", lineIndexes: [0] },
          { release: "hold", lineIndexes: [1] },
          { release: "hold", lineIndexes: [2] },
        ]);
        expect(all.detail.sent).toEqual([
          grid(el).store.lines[1],
          grid(el).store.lines[2],
          grid(el).store.lines[0],
        ]);
        await el.updateComplete;
        expect(previewDialog(el).open).toBe(false);

        await toggle(el, "Beer");
        await toggle(el, "Steak");
        expect(await openPreview(el, "fire-selected")).toContain("Fire now: 3 items.");
        const selected = confirmPreview(el)!;
        expect(selected.detail.lines).toEqual([
          { menuItemId: "offer-beer", quantity: "2" },
          { menuItemId: "offer-steak", quantity: "1" },
        ]);
        expect(selected.detail.groups).toEqual([{ release: "fire", lineIndexes: [0, 1] }]);
        expect(selected.detail.sent).toEqual([grid(el).store.lines[1], grid(el).store.lines[0]]);
        expect(selected.detail.joinGroupId).toBeUndefined();
      });
    });

    describe("who may fire the draft now", () => {
      it.each(["waiter", "kitchen", "expo"] as const)(
        "offers Fire all now and Fire selected now under fire_control '%s'",
        async (fireControl) => {
          const { el } = await mount({ courses: serviceCourses, products: menu, fireControl });
          await ring(el, [beer, "1"], [steak, "1"]);
          expect(draftAction(el, "fire-all")).not.toBeNull();
          expect(draftAction(el, "fire-all")!.hasAttribute("disabled")).toBe(false);
          await toggle(el, "Beer");
          expect(draftAction(el, "fire-selected")).not.toBeNull();
          expect(draftAction(el, "fire-selected")!.hasAttribute("disabled")).toBe(false);
        },
      );
    });

    describe("later additions", () => {
      const held = [
        firedGroup("g-drinks", 1, "1 × Beer"),
        heldGroup("g-mains", 2, "2 × Steak, 1 × Fish"),
        heldGroup("g-desserts", 3, "1 × Flan"),
      ];
      const destinations = (el: TillTableOrderScreen) =>
        [...el.shadowRoot!.querySelectorAll("[data-destination]")].map((option) => ({
          kind: option.getAttribute("data-destination"),
          pressed: option.getAttribute("aria-pressed"),
        }));
      const heldChoices = (el: TillTableOrderScreen) =>
        [...el.shadowRoot!.querySelectorAll("[data-held-group]")].map((option) => ({
          id: option.getAttribute("data-held-group"),
          text: option.textContent!.replace(/\s+/g, " ").trim(),
          pressed: option.getAttribute("aria-pressed"),
        }));
      async function pickDestination(el: TillTableOrderScreen, kind: string): Promise<void> {
        el.shadowRoot!.querySelector<HTMLElement>(`[data-destination="${kind}"]`)!.click();
        await el.updateComplete;
      }

      it("offers a destination, defaulting to Fire now, for a draft begun after the party had a group", async () => {
        const { el } = await mount({ courses: serviceCourses, products: menu, groups: held });
        await ring(el, [croquetas, "2"]);
        expect(destinations(el)).toEqual([
          { kind: "fire-now", pressed: "true" },
          { kind: "add-to-held", pressed: "false" },
          { kind: "add-as-new", pressed: "false" },
        ]);
        expect(actionKinds(el)).toEqual(["submit"]);
        expect(await openPreview(el, "submit")).toContain("Fire now: 2 items.");
        const sent = confirmPreview(el)!;
        expect(sent.detail.groups).toEqual([{ release: "fire", lineIndexes: [0] }]);
        expect(sent.detail.joinGroupId).toBeUndefined();
      });

      it("lists the held groups by position and contents, the first as Next, and never a fired one", async () => {
        const { el } = await mount({ courses: serviceCourses, products: menu, groups: held });
        await ring(el, [croquetas, "1"]);
        expect(el.shadowRoot!.querySelector("[data-held-picker]")).toBeNull();
        await pickDestination(el, "add-to-held");
        expect(heldChoices(el)).toEqual([
          { id: "g-mains", text: "Next: 2 × Steak, 1 × Fish", pressed: "true" },
          { id: "g-desserts", text: "Group 3: 1 × Flan", pressed: "false" },
        ]);
      });

      it("adds the draft to the held group picked, without calling it a new group", async () => {
        const { el } = await mount({ courses: serviceCourses, products: menu, groups: held });
        await ring(el, [croquetas, "2"]);
        await pickDestination(el, "add-to-held");
        el.shadowRoot!.querySelector<HTMLElement>('[data-held-group="g-desserts"]')!.click();
        await el.updateComplete;
        const text = await openPreview(el, "submit");
        expect(text).toContain("Add to held group “Group 3: 1 × Flan”: 2 items.");
        expect(text).not.toContain("Hold:");
        const sent = confirmPreview(el)!;
        expect(sent.detail.groups).toEqual([{ release: "hold", lineIndexes: [0] }]);
        expect(sent.detail.joinGroupId).toBe("g-desserts");
      });

      it("shows a held group's contents as written, even when they hold $& or $'", async () => {
        const odd = "1 × Tapa $& $'";
        const { el } = await mount({
          courses: serviceCourses,
          products: menu,
          groups: [heldGroup("g-first", 2, odd), heldGroup("g-second", 3, odd)],
        });
        await ring(el, [croquetas, "1"]);
        await pickDestination(el, "add-to-held");
        expect(heldChoices(el).map((choice) => choice.text)).toEqual([
          `Next: ${odd}`,
          `Group 3: ${odd}`,
        ]);
        expect(await openPreview(el, "submit")).toContain(
          `Add to held group “Next: ${odd}”: 1 item.`,
        );
      });

      it("names the first held group in the preview as the picker does, as Next", async () => {
        const { el } = await mount({ courses: serviceCourses, products: menu, groups: held });
        await ring(el, [croquetas, "1"]);
        await pickDestination(el, "add-to-held");
        expect(await openPreview(el, "submit")).toContain(
          "Add to held group “Next: 2 × Steak, 1 × Fish”: 1 item.",
        );
      });

      it("Add as new group appends one held group, of the selection when there is one", async () => {
        const { el } = await mount({ courses: serviceCourses, products: menu, groups: held });
        await ring(el, [croquetas, "1"], [steak, "1"]);
        await pickDestination(el, "add-as-new");
        await toggle(el, "Steak");
        expect(await openPreview(el, "submit")).toContain("Hold: 1 group.");
        const sent = confirmPreview(el)!;
        expect(sent.detail.lines).toEqual([{ menuItemId: "offer-steak", quantity: "1" }]);
        expect(sent.detail.groups).toEqual([{ release: "hold", lineIndexes: [0] }]);
        expect(sent.detail.joinGroupId).toBeUndefined();
      });

      it("keeps every destination, held group and action inside a phone-width screen", async () => {
        const { el, host } = await mount({ courses: serviceCourses, products: menu, groups: held });
        host.style.width = "390px";
        await ring(el, [croquetas, "1"]);
        await pickDestination(el, "add-to-held");
        await openReview(el);
        const edge = el.getBoundingClientRect().right;
        const controls = [
          ...el.shadowRoot!.querySelectorAll(
            "[data-destination], [data-held-group], [data-draft-action]",
          ),
        ];
        expect(controls.length).toBe(6);
        expect(
          controls.filter((control) => control.getBoundingClientRect().right > edge + 0.5),
        ).toEqual([]);
      });

      it("gives each draft line, destination, held group and action, and the preview's buttons, a tap target of 44 px each way", async () => {
        const { el } = await mount({ courses: serviceCourses, products: menu, groups: held });
        await ring(el, [croquetas, "1"], [steak, "1"]);
        await pickDestination(el, "add-to-held");
        await openReview(el);
        const controls = el.shadowRoot!.querySelectorAll(
          "[data-draft-select], [data-destination], [data-held-group], [data-draft-action]",
        );
        expect(controls.length).toBe(8);
        expect(underTapSize(controls)).toEqual([]);

        await openPreview(el, "submit");
        expect(
          underTapSize(
            el.shadowRoot!.querySelectorAll("[data-draft-confirm], [data-draft-dismiss]"),
          ),
        ).toEqual([]);
      });

      it("offers no Add to held group when every group of the party has fired", async () => {
        const { el } = await mount({
          courses: serviceCourses,
          products: menu,
          groups: [firedGroup("g-drinks", 1, "1 × Beer")],
        });
        await ring(el, [croquetas, "1"]);
        expect(destinations(el).map((option) => option.kind)).toEqual(["fire-now", "add-as-new"]);
      });

      it("keeps the four actions for a draft begun before the party had a group, through its partial submissions", async () => {
        const { el } = await mount({ courses: serviceCourses, products: menu });
        await ring(el, [beer, "1"], [steak, "1"]);
        el.groups = [firedGroup("g-drinks", 1, "1 × Beer")];
        await el.updateComplete;
        expect(el.shadowRoot!.querySelector("[data-destination]")).toBeNull();
        expect(actionKinds(el)).toEqual(["send-all", "fire-all"]);

        // Once the draft is empty, the next one is a later addition.
        grid(el).store.removeLines(grid(el).store.lines);
        await el.updateComplete;
        await ring(el, [croquetas, "1"]);
        expect(actionKinds(el)).toEqual(["submit"]);
      });
    });
  });

  // A held (fired_at null) line of a named course — the tab's food waiting for the waiter to fire it.
  // Held still means the round-send already inserted its ticket item (fireLines does this for every
  // parent line, fired or held), so `state` is the fresh-insert "queued", not null.
  const heldLine: TabLine = {
    stationId: null,
    movable: false,
    id: "line-3",
    groupId: null,
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

  describe("the party's groups in the Tab drawer", () => {
    const at = "2026-09-27T10:00:00.000Z";
    /** A dish line of this bill in group `groupId`, held (never sent) unless `fired`. */
    function dishLine(
      id: string,
      lineNo: number,
      name: string,
      quantity: string,
      groupId: string,
      over: Partial<TabLine> = {},
    ): TabLine {
      return {
        stationId: null,
        movable: false,
        id,
        groupId,
        lineNo,
        name,
        productId: "cafe",
        quantity,
        unitPrecision: 0,
        unitPriceGross: "10.00",
        servedAt: null,
        courseId: null,
        sentAt: null,
        firedAt: null,
        state: "queued",
        note: null,
        listId: null,
        menuItemId: null,
        parentProductId: null,
        ...over,
      };
    }
    function group(
      id: string,
      position: number,
      state: OrderGroup["state"],
      lineIds: string[],
      summary: string,
    ): OrderGroup {
      return { ...orderGroup(id, state), position, lineIds, summary };
    }
    const fired = { sentAt: at, firedAt: at };
    const beer = dishLine("l-beer", 1, "Beer", "1.000", "g1", fired);
    const salad = dishLine("l-salad", 2, "Salad", "1.000", "g2", fired);
    const croquetas = dishLine("l-croq", 3, "Croquetas", "1.000", "g3");
    const steak = dishLine("l-steak", 4, "Steak", "2.000", "g4");
    const fish = dishLine("l-fish", 5, "Fish", "1.000", "g4");
    const flan = dishLine("l-flan", 6, "Flan", "1.000", "g5");
    const tabLines = [beer, salad, croquetas, steak, fish, flan];
    // Listed out of position order; g4 also holds a Wine on another bill of the party.
    const groups = [
      group(
        "g4",
        4,
        "held",
        ["l-steak", "l-fish", "l-wine-elsewhere"],
        "2 × Steak, 1 × Fish, 1 × Wine",
      ),
      group("g1", 1, "fired", ["l-beer"], "1 × Beer"),
      group("g5", 5, "held", ["l-flan"], "1 × Flan"),
      group("g2", 2, "fired", ["l-salad"], "1 × Salad"),
      group("g3", 3, "held", ["l-croq"], "1 × Croquetas"),
    ];

    async function mountGroups(over: Partial<TillTableOrderScreen> = {}) {
      const mounted = await mount({ lines: tabLines, groups, orderId: "wo-4", ...over });
      await openDrawer(mounted.el);
      return mounted;
    }

    const groupRows = (el: TillTableOrderScreen) => [
      ...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-group]"),
    ];
    const groupRow = (el: TillTableOrderScreen, id: string) =>
      el.shadowRoot!.querySelector<HTMLElement>(`[data-group="${id}"]`)!;
    const text = (node: Element) => node.textContent!.replace(/\s+/g, " ").trim();
    const control = (el: TillTableOrderScreen, selector: string) =>
      el.shadowRoot!.querySelector<HTMLElement & { disabled?: boolean }>(selector);

    function capture(el: TillTableOrderScreen, type: string): CustomEvent[] {
      const events: CustomEvent[] = [];
      el.addEventListener(type, (event) => events.push(event as CustomEvent));
      return events;
    }

    it("lists every group of the party in position order, the fired ones marked and without controls", async () => {
      const { el } = await mountGroups();
      const rows = groupRows(el);
      expect(rows.map((row) => row.dataset.group)).toEqual(["g1", "g2", "g3", "g4", "g5"]);
      expect(rows.map((row) => text(row.querySelector("[data-group-position]")!))).toEqual(
        [1, 2, 3, 4, 5].map((n) => t("table.group_n").replace("{n}", String(n))),
      );
      expect(rows.map((row) => row.dataset.groupState)).toEqual([
        "fired",
        "fired",
        "held",
        "held",
        "held",
      ]);
      for (const row of rows.slice(0, 2)) {
        expect(text(row)).toContain(t("table.group_fired"));
        expect(row.querySelector("wt-button")).toBeNull();
      }
      for (const row of rows.slice(2)) expect(text(row)).toContain(t("table.group_held"));
    });

    it("sits above To serve in the drawer, and is absent while the party has no group", async () => {
      const { el } = await mountGroups();
      const list = el.shadowRoot!.querySelector("[data-groups]")!;
      const pending = el.shadowRoot!.querySelector(".pending")!;
      expect(list.compareDocumentPosition(pending) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      el.groups = [];
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-groups]")).toBeNull();
    });

    it("shows each group's contents as the server wrote them, and as rows only this bill's lines", async () => {
      const { el } = await mountGroups();
      const mains = groupRow(el, "g4");
      expect(text(mains.querySelector("[data-group-summary]")!)).toBe(
        "2 × Steak, 1 × Fish, 1 × Wine",
      );
      expect(
        [...mains.querySelectorAll("[data-group-line]")].map((row) => [
          (row as HTMLElement).dataset.groupLine,
          text(row.querySelector(".group-line-name")!),
        ]),
      ).toEqual([
        ["l-steak", "Steak ×2"],
        ["l-fish", "Fish ×1"],
      ]);
      expect(text(groupRow(el, "g1").querySelector("[data-group-line]")!)).toContain("Beer ×1");
    });

    it("moves a held group up or down among the held groups, sending the whole held order", async () => {
      const { el } = await mountGroups();
      const reorders = capture(el, "reorder-groups");
      expect(control(el, '[data-group-up="g3"]')!.disabled).toBe(true);
      expect(control(el, '[data-group-down="g5"]')!.disabled).toBe(true);
      expect(control(el, '[data-group-up="g1"]')).toBeNull();

      control(el, '[data-group-down="g3"]')!.click();
      control(el, '[data-group-up="g5"]')!.click();

      expect(reorders.map((event) => event.detail)).toEqual([
        { heldGroupIds: ["g4", "g3", "g5"] },
        { heldGroupIds: ["g3", "g5", "g4"] },
      ]);
      expect(reorders[0]!.bubbles && reorders[0]!.composed).toBe(true);
    });

    it("Move to… offers the other held groups and a new one, and moves the whole line", async () => {
      const { el } = await mountGroups();
      const moves = capture(el, "move-group-line");
      const dialog = el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
        "[data-move-dialog]",
      )!;
      expect(dialog.open).toBe(false);

      control(el, '[data-move-line="l-steak"]')!.click();
      await el.updateComplete;
      expect(dialog.open).toBe(true);
      expect(text(dialog)).toContain("Steak ×2");
      const targets = [...dialog.querySelectorAll<HTMLElement>("[data-move-target]")];
      expect(targets.map((target) => target.dataset.moveTarget)).toEqual(["g3", "g5", "new"]);
      expect(text(targets[0]!)).toBe("Next: 1 × Croquetas");
      expect(text(targets[1]!)).toBe("Group 5: 1 × Flan");
      expect(text(targets[2]!)).toBe(t("table.move_new_group"));
      targets[1]!.click();
      await el.updateComplete;
      expect(dialog.open).toBe(false);

      control(el, '[data-move-line="l-fish"]')!.click();
      await el.updateComplete;
      dialog.querySelector<HTMLElement>('[data-move-target="new"]')!.click();
      await el.updateComplete;

      expect(moves.map((event) => event.detail)).toEqual([
        { lineId: "l-steak", quantity: "2.000", target: { groupId: "g5" } },
        { lineId: "l-fish", quantity: "1.000", target: "new" },
      ]);
      expect(moves[0]!.bubbles && moves[0]!.composed).toBe(true);
    });

    it("names a Move to… target's contents as written, even when they hold $& or $'", async () => {
      const odd = "1 × Tapa $& $'";
      const { el } = await mountGroups({
        groups: groups.map((row) => (row.id === "g5" ? { ...row, summary: odd } : row)),
      });
      control(el, '[data-move-line="l-steak"]')!.click();
      await el.updateComplete;
      expect(text(control(el, '[data-move-target="g5"]')!)).toBe(`Group 5: ${odd}`);
    });

    it("sends no move when Move to… is dismissed", async () => {
      const { el } = await mountGroups();
      const moves = capture(el, "move-group-line");
      control(el, '[data-move-line="l-flan"]')!.click();
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>("[data-move-dismiss]")!.click();
      await el.updateComplete;
      expect(
        el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>("[data-move-dialog]")!.open,
      ).toBe(false);
      expect(moves).toEqual([]);
    });

    it("offers Split quantity only on a held dish sold by the unit, of more than one, with no extras", async () => {
      const weighed = dishLine("l-ham", 7, "Ham", "1.500", "g5", { unitPrecision: 3 });
      const burger = dishLine("l-burger", 8, "Burger", "2.000", "g5");
      const cheese: TabLine = {
        ...dishLine("l-cheese", 9, "Cheese", "2.000", "g5"),
        parentLineNo: 8,
        unitPrecision: null,
        state: null,
      };
      const firedPair = dishLine("l-wine", 10, "Wine", "2.000", "g1", fired);
      const { el } = await mountGroups({
        lines: [...tabLines, weighed, burger, cheese, firedPair],
        groups: groups.map((each) =>
          each.id === "g5"
            ? { ...each, lineIds: ["l-flan", "l-ham", "l-burger"] }
            : each.id === "g1"
              ? { ...each, lineIds: ["l-beer", "l-wine"] }
              : each,
        ),
      });
      const splits = capture(el, "split-group-line");
      const offered = [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-split-group-line]")];
      expect(offered.map((button) => button.dataset.splitGroupLine)).toEqual(["l-steak"]);

      offered[0]!.click();

      expect(splits.map((event) => event.detail)).toEqual([
        { lineId: "l-steak", groupId: "g4", quantity: "2.000" },
      ]);
      expect(splits[0]!.bubbles && splits[0]!.composed).toBe(true);
    });

    it("disables every held group's controls while a group command is running, and enables them after", async () => {
      const { el } = await mountGroups({ fireControl: "waiter", groupCommandBusy: true });
      const controls = [
        '[data-group-down="g3"]',
        '[data-group-up="g4"]',
        '[data-group-down="g4"]',
        '[data-group-up="g5"]',
        '[data-group-fire="g4"]',
        '[data-move-line="l-steak"]',
        '[data-split-group-line="l-steak"]',
      ];
      const disabled = () => controls.map((selector) => control(el, selector)!.disabled);
      expect(disabled()).toEqual(controls.map(() => true));

      el.groupCommandBusy = false;
      await el.updateComplete;
      expect(disabled()).toEqual(controls.map(() => false));
    });

    it("Fire on a held group asks first, naming its contents, and fires it once confirmed", async () => {
      const { el } = await mountGroups({ fireControl: "waiter" });
      const fires = capture(el, "fire-group");
      const dialog = el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
        "[data-fire-dialog]",
      )!;
      expect(
        [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-group-fire]")].map(
          (button) => button.dataset.groupFire,
        ),
      ).toEqual(["g3", "g4", "g5"]);

      control(el, '[data-group-fire="g4"]')!.click();
      await el.updateComplete;
      expect(fires).toEqual([]);
      expect(dialog.open).toBe(true);
      expect(text(dialog.querySelector("[data-fire-summary]")!)).toBe(
        t("table.fire_group_body").replace("{summary}", "2 × Steak, 1 × Fish, 1 × Wine"),
      );

      dialog.querySelector<HTMLElement>("[data-fire-confirm]")!.click();
      await el.updateComplete;

      expect(fires.map((event) => event.detail)).toEqual([{ groupId: "g4" }]);
      expect(fires[0]!.bubbles && fires[0]!.composed).toBe(true);
      expect(dialog.open).toBe(false);
    });

    /** The messages of errors thrown out of event handlers while `act` runs. */
    function errorsDuring(act: () => void): string[] {
      const errors: string[] = [];
      const trap = (event: ErrorEvent) => {
        errors.push(event.message);
        event.preventDefault();
      };
      window.addEventListener("error", trap);
      try {
        act();
      } finally {
        window.removeEventListener("error", trap);
      }
      return errors;
    }

    it("fires once, and throws nothing, when Fire's confirmation is pressed twice in one turn", async () => {
      const { el } = await mountGroups({ fireControl: "waiter" });
      const fires = capture(el, "fire-group");
      control(el, '[data-group-fire="g3"]')!.click();
      await el.updateComplete;
      const confirm = control(el, "[data-fire-confirm]")!;

      const errors = errorsDuring(() => {
        confirm.click();
        confirm.click();
      });

      expect(errors).toEqual([]);
      expect(fires.map((event) => event.detail)).toEqual([{ groupId: "g3" }]);
    });

    it("moves once, and throws nothing, when a Move to… target is pressed twice in one turn", async () => {
      const { el } = await mountGroups();
      const moves = capture(el, "move-group-line");
      control(el, '[data-move-line="l-flan"]')!.click();
      await el.updateComplete;
      const target = control(el, '[data-move-target="new"]')!;

      const errors = errorsDuring(() => {
        target.click();
        target.click();
      });

      expect(errors).toEqual([]);
      expect(moves.map((event) => event.detail)).toEqual([
        { lineId: "l-flan", quantity: "1.000", target: "new" },
      ]);
    });

    it("fires nothing when the Fire confirmation is dismissed", async () => {
      const { el } = await mountGroups({ fireControl: "waiter" });
      const fires = capture(el, "fire-group");
      control(el, '[data-group-fire="g3"]')!.click();
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>("[data-fire-dismiss]")!.click();
      await el.updateComplete;
      expect(
        el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>("[data-fire-dialog]")!.open,
      ).toBe(false);
      expect(fires).toEqual([]);
    });

    it.each(["kitchen", "expo"] as const)(
      "offers no Fire on a held group under fire_control '%s', and still lets the waiter arrange them",
      async (fireControl) => {
        const { el } = await mountGroups({ fireControl });
        expect(el.shadowRoot!.querySelector("[data-group-fire]")).toBeNull();
        expect(control(el, '[data-group-down="g3"]')).not.toBeNull();
        expect(control(el, '[data-move-line="l-steak"]')).not.toBeNull();
        expect(control(el, '[data-split-group-line="l-steak"]')).not.toBeNull();
      },
    );

    it("offers Fire on a held group of a no-route line with no course, and not once it has fired", async () => {
      // The kitchen and the pass fire by course, so the table screen is the only place this group
      // can be released from.
      const noRoute = dishLine("l-water", 1, "Water", "1.000", "g-held", { state: null });
      const { el } = await mountGroups({
        lines: [noRoute],
        groups: [group("g-held", 1, "held", ["l-water"], "1 × Water")],
        fireControl: "waiter",
      });
      expect(control(el, '[data-group-fire="g-held"]')).not.toBeNull();

      el.groups = [group("g-held", 1, "fired", ["l-water"], "1 × Water")];
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-group-fire]")).toBeNull();
    });

    it("offers no Fire course section and no tab-level Send all", async () => {
      const { el } = await mountGroups({ fireControl: "waiter", courses });
      expect(el.shadowRoot!.querySelector("[data-fire-section]")).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-fire-course]")).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-send-all]")).toBeNull();
    });

    it("closes an open Fire confirmation and Move to… picker when another order is shown", async () => {
      const { el } = await mountGroups({ fireControl: "waiter" });
      const dialog = (name: string) =>
        el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(`[data-${name}-dialog]`)!;
      control(el, '[data-group-fire="g3"]')!.click();
      await el.updateComplete;
      control(el, '[data-move-line="l-flan"]')!.click();
      await el.updateComplete;
      expect([dialog("fire").open, dialog("move").open]).toEqual([true, true]);

      el.orderId = "wo-7";
      await el.updateComplete;

      expect([dialog("fire").open, dialog("move").open]).toEqual([false, false]);
    });

    it("offers Change and Cancel on a dish in a held group, whose Cancel asks the app to take it off the bill", async () => {
      const { el } = await mountGroups();
      const asked = capture(el, "adjust");
      expect(control(el, '[data-change-line="4"]')).not.toBeNull();
      expect(control(el, '[data-cancel-line="3"]')).not.toBeNull();
      expect(control(el, '[data-send-line="3"]')).toBeNull();

      control(el, '[data-cancel-line="3"]')!.click();

      expect(asked.map((event) => event.detail)).toEqual([
        {
          kind: "cancel",
          target: {
            lineId: "l-croq",
            name: "Croquetas",
            quantity: "1",
            total: "10.00",
            unitTotal: null,
            started: false,
          },
        },
      ]);
    });

    it("offers Cancel on a dish in a held group that goes to no kitchen, saying it comes off the bill", async () => {
      const water = dishLine("l-water", 7, "Water", "1.000", "g5", { state: null });
      const { el } = await mountGroups({
        lines: [...tabLines, water],
        groups: groups.map((row) =>
          row.id === "g5" ? { ...row, lineIds: [...row.lineIds, "l-water"] } : row,
        ),
      });
      const asked = capture(el, "adjust");

      control(el, '[data-cancel-line="7"]')!.click();

      expect(asked.map((event) => event.detail)).toEqual([
        {
          kind: "cancel",
          target: expect.objectContaining({ lineId: "l-water", started: false }),
        },
      ]);
    });

    it("gives every held group's control, and its dialogs' buttons, a tap target of 44 px each way", async () => {
      const { el } = await mountGroups({ fireControl: "waiter" });
      const listed = el.shadowRoot!.querySelectorAll(
        "[data-group-up], [data-group-down], [data-group-fire], [data-move-line], [data-split-group-line]",
      );
      expect(listed.length).toBe(14);
      expect(underTapSize(listed)).toEqual([]);

      control(el, '[data-group-fire="g4"]')!.click();
      await el.updateComplete;
      expect(
        underTapSize(el.shadowRoot!.querySelectorAll("[data-fire-confirm], [data-fire-dismiss]")),
      ).toEqual([]);
      control(el, "[data-fire-dismiss]")!.click();
      control(el, '[data-move-line="l-steak"]')!.click();
      await el.updateComplete;
      expect(
        underTapSize(el.shadowRoot!.querySelectorAll("[data-move-target], [data-move-dismiss]")),
      ).toEqual([]);
    });

    it("opens a held-group dish's Change with the revision the lines were read at", async () => {
      const { el } = await mountGroups({ revision: 7 });
      const changes = capture(el, "change-line");
      control(el, '[data-change-line="3"]')!.click();
      await el.updateComplete;
      const picker = el.shadowRoot!.querySelector<TillModifierPicker>("till-modifier-picker")!;
      picker.dispatchEvent(
        new CustomEvent("wt-modifier-confirm", {
          detail: { note: "no salt" },
          bubbles: true,
          composed: true,
        }),
      );
      expect(changes.map((event) => event.detail)).toEqual([
        {
          lineNo: 3,
          lineName: "Croquetas",
          patch: { note: "no salt" },
          revision: 7,
          saleLine: {
            menuItemId: undefined,
            quantity: "1.000",
            options: [],
            extras: [],
            note: "no salt",
          },
        },
      ]);
    });
    describe("the kitchen's progress on a fired group", () => {
      const firedAt = "2026-09-27T10:00:00.000Z";
      const minutesLater = (n: number) => Date.parse(firedAt) + n * 60_000;
      const state = (el: TillTableOrderScreen, id: string) =>
        text(groupRow(el, id).querySelector("[data-group-kitchen]")!);
      const withG1 = (over: Partial<OrderGroup>) =>
        groups.map((row) => (row.id === "g1" ? { ...row, firedAt, ...over } : row));

      it("reads how long ago a fired group went, from when it was fired", async () => {
        const { el } = await mountGroups({ groups: withG1({}), now: minutesLater(20) });
        expect(state(el, "g1")).toBe(t("table.group_fired_ago").replace("{n}", "20"));
        expect(state(el, "g3")).toBe(t("table.group_held"));
      });

      it("never reads Ready while nobody marked it ready, however long ago it was fired (a station on paper)", async () => {
        const { el } = await mountGroups({ groups: withG1({}), now: minutesLater(180) });
        expect(state(el, "g1")).toBe(t("table.group_fired_ago").replace("{n}", "180"));
        expect(text(groupRow(el, "g1"))).not.toContain(t("table.group_ready"));
      });

      it("reads Ready once the kitchen marked it ready", async () => {
        const { el } = await mountGroups({
          groups: withG1({ ready: true }),
          now: minutesLater(20),
        });
        expect(state(el, "g1")).toBe(t("table.group_ready"));
      });

      it("reads en route once the pass sent it away, and no longer Ready", async () => {
        const { el } = await mountGroups({
          groups: withG1({ ready: true, away: true }),
          now: minutesLater(20),
        });
        expect(state(el, "g1")).toBe(t("table.group_away"));
      });

      it("a fired group with no fired time reads Fired", async () => {
        const { el } = await mountGroups({ groups: withG1({ firedAt: null }) });
        expect(state(el, "g1")).toBe(t("table.group_fired"));
      });

      it("never counts a group fired after the clock's reading as fired in the future", async () => {
        const { el } = await mountGroups({ groups: withG1({}), now: minutesLater(-2) });
        expect(state(el, "g1")).toBe(t("table.group_fired_ago").replace("{n}", "0"));
      });

      it("runs a clock only while a fired group's age is on screen", async () => {
        vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
        try {
          const { el } = await mount({ lines: tabLines, groups: withG1({}), orderId: "wo-4" });
          expect(vi.getTimerCount()).toBe(0);
          await openDrawer(el);
          const ages = el.shadowRoot!.querySelectorAll("till-fired-ago").length;
          expect(ages).toBeGreaterThan(0);
          expect(vi.getTimerCount()).toBe(ages);
          await openDrawer(el);
          expect(vi.getTimerCount()).toBe(0);
        } finally {
          vi.useRealTimers();
        }
      });

      it("the age on screen moves on with the clock", async () => {
        vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
        try {
          vi.setSystemTime(minutesLater(20));
          const { el } = await mountGroups({ groups: withG1({}) });
          expect(state(el, "g1")).toBe(t("table.group_fired_ago").replace("{n}", "20"));
          vi.advanceTimersByTime(60_000);
          await groupRow(el, "g1").querySelector("till-fired-ago")!.updateComplete;
          expect(state(el, "g1")).toBe(t("table.group_fired_ago").replace("{n}", "21"));
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });

  it("renders an editable course picker for a NOT-yet-fired tab line, bound to its current course", async () => {
    // heldLine: firedAt null, current course Postres ⇒ an editable dropdown bound to it.
    const { el } = await mount({ lines: [heldLine], courses });
    await openDrawer(el);
    const picker = el.shadowRoot!.querySelector<WtCombobox>('[data-line-course="3"]');
    expect(picker).not.toBeNull();
    expect(picker!.value).toBe("postres");
    // The reused picker's options: the no-course placeholder plus one per active venue course.
    expect(picker!.options.map((o) => o.value)).toEqual(["", "entrantes", "postres"]);
  });

  it("picks a held tab line's course from a compact shared dropdown, named for the line", async () => {
    const { el, host } = await mount({ lines: [heldLine], courses });
    host.style.setProperty("--wt-tap-min", "60px");
    await openDrawer(el);
    const picker = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-line-course="3"]');
    expect(picker).not.toBeNull();
    expect(picker!.name).toBe("course");
    expect(picker!.hideLabel).toBe(true);
    expect(picker!.label).toBe(`${t("table.course_label")} · Café`);
    expect(picker!.getAttribute("search")).toBe("auto");
    expect(picker!.searchPlaceholder).toBe(t("form.combobox_search"));
    expect(picker!.noResultsLabel).toBe(t("form.combobox_no_results"));
    expect(picker!.placeholder).toBe(t("table.course_none"));
    expect(picker!.options).toEqual([
      { value: "", label: t("table.course_none") },
      { value: "entrantes", label: "Entrantes" },
      { value: "postres", label: "Postres" },
    ]);
    expect(picker!.value).toBe("postres");
    await picker!.updateComplete;
    const box = picker!.shadowRoot!.querySelector<HTMLElement>("[part=field]")!;
    expect(box.getBoundingClientRect().height).toBeGreaterThanOrEqual(60);

    let captured: CustomEvent | undefined;
    el.addEventListener("set-line-course", (e) => (captured = e as CustomEvent));
    await chooseOption(picker!, "");
    expect(captured!.detail).toEqual({ lineNo: 3, courseId: null });
  });

  it("shows the held line's course from the server again when a re-read keeps it", async () => {
    const { el } = await mount({ lines: [heldLine], courses });
    await openDrawer(el);
    const picker = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-line-course="3"]')!;
    await chooseOption(picker, "entrantes");
    el.lines = [{ ...heldLine }];
    await el.updateComplete;
    expect(picker.value).toBe("postres");
  });

  it("emits set-line-course { lineNo, courseId } when a held tab line is re-pointed", async () => {
    const { el } = await mount({ lines: [heldLine], courses, orderId: "wo-9" });
    await openDrawer(el);
    const picker = el.shadowRoot!.querySelector<WtCombobox>('[data-line-course="3"]')!;
    let captured: CustomEvent | undefined;
    el.addEventListener("set-line-course", (e) => (captured = e as CustomEvent));
    await chooseOption(picker, "entrantes");
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
    expect(captured!.detail).toEqual({ lineNo: 3, courseId: "entrantes" });
  });

  it("clears a held tab line's course to null when the no-course placeholder is picked", async () => {
    const { el } = await mount({ lines: [heldLine], courses });
    await openDrawer(el);
    const picker = el.shadowRoot!.querySelector<WtCombobox>('[data-line-course="3"]')!;
    let captured: CustomEvent | undefined;
    el.addEventListener("set-line-course", (e) => (captured = e as CustomEvent));
    // The "" placeholder is the explicit no-course null (setLineCourse takes `string | null`).
    await chooseOption(picker, "");
    expect(captured!.detail).toEqual({ lineNo: 3, courseId: null });
  });

  it("shows a FIRED tab line's course READ-ONLY, offering no editable picker", async () => {
    // A fired line (firedAt set) is not moved here.
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
    // apart. This following extra has no ticket item, so firedAt AND state are both null — the shape whose
    // null firedAt would wrongly fall into the HELD/Send branch, and whose held shape would paint an
    // editable course picker, if the child guard were absent. A fixture with `productId: null` would
    // pass against a screen that still read a null product as "child", so it carries one on purpose.
    const childLine: TabLine = {
      stationId: null,
      movable: false,
      id: "line-2",
      groupId: null,
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

    it("renders no Send, Recall or course picker on a child extras line, only its dish's Cancel", async () => {
      // Parent (fired + queued) is recallable and shows its read-only course; the child shows neither.
      const { el } = await mount({ lines: [pendingLine, childLine], courses });
      await openDrawer(el);
      expect(el.shadowRoot!.querySelector('[data-recall-line="1"]')).not.toBeNull();
      // The child row: no Send or Recall action, and Cancel because its dish offers it…
      expect(el.shadowRoot!.querySelector('[data-send-line="2"]')).toBeNull();
      expect(el.shadowRoot!.querySelector('[data-recall-line="2"]')).toBeNull();
      expect(el.shadowRoot!.querySelector('[data-cancel-line="1"]')).not.toBeNull();
      expect(el.shadowRoot!.querySelector('[data-cancel-line="2"]')).not.toBeNull();
      // …and no course control at all (neither the editable held picker nor the fired static span).
      expect(el.shadowRoot!.querySelector('[data-line-course="2"]')).toBeNull();
      expect(el.shadowRoot!.querySelector('[data-line-course-static="2"]')).toBeNull();
    });

    it("offers Cancel for a queued split-off extra when its no-preparation dish cannot be cancelled", async () => {
      const dish: TabLine = {
        ...pendingLine,
        sentAt: pendingLine.sentAt,
        firedAt: null,
        state: null,
      };
      const chips: TabLine = {
        ...childLine,
        sentAt: pendingLine.sentAt,
        firedAt: pendingLine.firedAt,
        state: "queued",
      };
      const { el } = await mount({ lines: [dish, chips], courses });
      await openDrawer(el);
      expect(el.shadowRoot!.querySelector('[data-cancel-line="1"]')).toBeNull();
      expect(el.shadowRoot!.querySelector('[data-cancel-line="2"]')).not.toBeNull();
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

    it("offers no Send on a line in a HELD group, which is released by firing its group", async () => {
      const inHeldGroup: TabLine = { ...heldLine, groupId: "g-held" };
      const { el } = await mount({
        lines: [inHeldGroup],
        groups: [orderGroup("g-held", "held")],
        courses,
        fireControl: "waiter",
      });
      await openDrawer(el);
      expect(el.shadowRoot!.querySelector('[data-send-line="3"]')).toBeNull();
      expect(el.shadowRoot!.querySelector('[data-group-fire="g-held"]')).not.toBeNull();
    });

    it("offers Send on a recalled line whose group has fired", async () => {
      const recalled: TabLine = {
        ...heldLine,
        groupId: "g-fired",
        sentAt: "2026-08-20T09:59:00.000Z",
      };
      const { el } = await mount({
        lines: [recalled],
        groups: [orderGroup("g-fired", "fired")],
        courses,
      });
      await openDrawer(el);
      expect(el.shadowRoot!.querySelector('[data-send-line="3"]')).not.toBeNull();
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

    it("shows Cancel on a FIRED, started line; pressing it asks the app to cancel it as started", async () => {
      const { el } = await mount({ lines: [preparingLine], courses });
      await openDrawer(el);
      const cancel = el.shadowRoot!.querySelector<HTMLElement>('[data-cancel-line="1"]');
      expect(cancel).not.toBeNull();
      // A started line is cancel-only — no Send, no Recall.
      expect(el.shadowRoot!.querySelector('[data-send-line="1"]')).toBeNull();
      expect(el.shadowRoot!.querySelector('[data-recall-line="1"]')).toBeNull();

      let captured: CustomEvent | undefined;
      el.addEventListener("adjust", (e) => (captured = e as CustomEvent));
      cancel!.click();
      expect(captured).toBeInstanceOf(CustomEvent);
      expect(captured!.detail).toEqual({
        kind: "cancel",
        target: expect.objectContaining({ lineId: pendingLine.id, started: true }),
      });
      expect(captured!.composed).toBe(true);
      expect(captured!.bubbles).toBe(true);
    });

    it("also shows Cancel (not Recall) on a FIRED, ready line", async () => {
      const { el } = await mount({ lines: [readyLine], courses });
      await openDrawer(el);
      expect(el.shadowRoot!.querySelector('[data-cancel-line="1"]')).not.toBeNull();
      expect(el.shadowRoot!.querySelector('[data-recall-line="1"]')).toBeNull();
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
      portion: "1",
      unit: {
        name: { en: "Each", es: "Unidad", ca: "Unitat", eu: "Unitatea", gl: "Unidade" },
        hardwareUnit: null,
        id: "00000000-0000-0000-0000-000000000001",
        abbreviation: { en: "ea", es: "ud", ca: "u", eu: "u", gl: "u" },
        precision: 0,
      },
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
      stationId: null,
      movable: false,
      id: "line-5",
      groupId: null,
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
      picker
        .shadowRoot!.querySelector('[data-test="line-note"]')!
        .shadowRoot!.querySelector("textarea")!;
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
        saleLine: {
          menuItemId: "menu-item-burger",
          quantity: "1.000",
          options: [],
          extras: [],
          note: "no onions",
        },
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

    it("prefills the line's note, answer and extras; saving a note-only change sends the extras back and leaves the answer out", async () => {
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
      await typeNote(picker, "sin cebolla");
      picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!.click();
      expect(seen.event!.detail).toEqual({
        lineNo: 5,
        lineName: "Burger",
        revision: 3,
        patch: {
          note: "sin cebolla",
          extras: [{ listId: "list-extras", picks: [{ productId: "p-cheese", quantity: 2 }] }],
        },
        saleLine: {
          menuItemId: "menu-item-burger",
          quantity: "2.000",
          options: [{ listId: "list-cooked", labelId: "label-rare" }],
          extras: [{ listId: "list-extras", picks: [{ productId: "p-cheese", quantity: 2 }] }],
          note: "sin cebolla",
        },
      });
    });

    it("reopens a 0.150 kg child as three 0.050 kg picks per dish", async () => {
      const weighted: OfferedModifier = {
        ...extrasList,
        items: [{ ...extraItem("p-cheese", "Jamón", false), portion: "0.050", price: "0.01" }],
      };
      const dish: TillProduct = { ...burger, offeredModifiers: [weighted] };
      const child: TabLine = {
        ...cheeseChild,
        name: "Jamón",
        quantity: "0.300",
        priceQuantity: "0.050",
        unitPriceGross: "0.01",
      };
      const { el } = await mount({
        products: [dish],
        lines: [{ ...burgerLine, quantity: "2.000" }, child],
        revision: 3,
      });
      await openDrawer(el);
      const picker = await openChange(el, 5);
      expect(
        picker
          .shadowRoot!.querySelector('[data-test="pick-list-extras-p-cheese-count"]')!
          .textContent!.trim(),
      ).toBe("3");
      const seen = captureChange(el);
      await typeNote(picker, "sin sal");
      picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!.click();
      expect(seen.event!.detail.patch).toMatchObject({
        extras: [{ listId: "list-extras", picks: [{ productId: "p-cheese", quantity: 3 }] }],
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

      it("an answer changed and changed back is compared by value: Save is disabled and sends nothing", async () => {
        const { el } = await mountWithdrawn();
        await openDrawer(el);
        const picker = await openChange(el, 5);
        await pickLabel(picker, "label-medium");
        await pickLabel(picker, "label-rare");
        const save =
          picker.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(".confirm")!;
        await save.updateComplete;
        expect(save.disabled).toBe(true);
        expect(save.shadowRoot!.querySelector("button")!.disabled).toBe(true);
        const seen = captureChange(el);
        save.click();
        await el.updateComplete;
        expect(seen.event).toBeUndefined();
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
      expect(seen.event!.detail.saleLine.variantId).toBe("burger-large");
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
      function captureCancel(el: TillTableOrderScreen): AdjustDetail[] {
        const seen: AdjustDetail[] = [];
        el.addEventListener("adjust", (e) => {
          expect(e.bubbles && e.composed).toBe(true);
          seen.push((e as CustomEvent<AdjustDetail>).detail);
        });
        return seen;
      }
      async function pressCancel(el: TillTableOrderScreen, lineNo: number): Promise<AdjustDetail> {
        const seen = captureCancel(el);
        lineAction(el, "cancel", lineNo)!.click();
        await el.updateComplete;
        expect(seen).toHaveLength(1);
        expect(seen[0]!.kind).toBe("cancel");
        return seen[0]!;
      }

      it("lets the dialog cancel one of them, at one unit's price", async () => {
        const { el } = await mountLines([pair]);
        await openDrawer(el);
        const { target } = await pressCancel(el, 5);
        expect(target).toEqual({
          lineId: "line-5",
          name: "Burger",
          quantity: "2",
          total: "19.00",
          unitTotal: "9.50",
          started: false,
        });
      });

      it("keeps the started wording, and one at a time, when the kitchen has started the pair", async () => {
        const { el } = await mountLines([{ ...pair, state: "preparing" }]);
        await openDrawer(el);
        const { target } = await pressCancel(el, 5);
        expect(target.started).toBe(true);
        expect(target.unitTotal).toBe("9.50");
      });

      it("does not offer one at a time on a line of one", async () => {
        const { el } = await mountLines([burgerLine]);
        await openDrawer(el);
        const { target } = await pressCancel(el, 5);
        expect(target.quantity).toBe("1");
        expect(target.unitTotal).toBeNull();
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
        const { target } = await pressCancel(el, 5);
        expect(target.unitTotal).toBeNull();
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
        const seen = captureCancel(el);
        let taken: Event | undefined;
        el.addEventListener("cancel-offer-taken", (e) => (taken = e));
        el.cancelOffer = 42;
        await el.updateComplete;
        expect(seen).toEqual([]);
        // Taken all the same: a later mount must not open it on whatever line 42 then is.
        expect(taken).toBeInstanceOf(CustomEvent);
      });

      it("opens Cancel on the line the app offers it for after a refused change", async () => {
        const { el } = await mountLines([preparingBurger]);
        await openDrawer(el);
        const seen = captureCancel(el);
        el.cancelOffer = 9;
        await el.updateComplete;
        expect(seen).toEqual([
          {
            kind: "cancel",
            target: expect.objectContaining({ lineId: "line-5", name: "Burger", started: true }),
            offered: true,
          },
        ]);
      });
    });
  });

  describe("sending an order to another bill of the party", () => {
    /** Rings a café into the draft and opens Fire all now's preview. */
    async function previewCafe(el: TillTableOrderScreen): Promise<void> {
      grid(el).shadowRoot!.querySelector<HTMLElement>("wt-button.tile")!.click();
      await el.updateComplete;
      await openPreview(el, "fire-all");
    }
    const sendTo = (el: TillTableOrderScreen) =>
      previewDialog(el).querySelector<HTMLFieldSetElement>("[data-send-to]");
    const choices = (el: TillTableOrderScreen) =>
      [...sendTo(el)!.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((radio) => ({
        name: radio.name,
        value: radio.value,
        checked: radio.checked,
        label: radio.closest("label")!.textContent!.replace(/\s+/g, " ").trim(),
      }));
    const billName = (n: number) =>
      t("table.bill_of").replace("{party}", "Ana").replace("{n}", String(n));

    it("offers each open, unpresented bill of the party, defaulting to the main bill, and sends no bill when nothing is picked", async () => {
      const { el } = await mount({ ...partyBills(), orderId: "wo-4" });
      await previewCafe(el);

      expect(sendTo(el)!.querySelector("legend")!.textContent!.trim()).toBe(t("table.send_to"));
      expect(choices(el)).toEqual([
        {
          name: "billId",
          value: "wo-4",
          checked: true,
          label: `${billName(1)} ${t("table.bill_main")}`,
        },
        { name: "billId", value: "wo-check", checked: false, label: billName(2) },
        { name: "billId", value: "wo-part", checked: false, label: billName(5) },
      ]);
      const captured = confirmPreview(el);
      expect(captured!.detail).not.toHaveProperty("billId");
    });

    it("puts the chosen bill in submit-draft's detail", async () => {
      const { el } = await mount({ ...partyBills(), orderId: "wo-4" });
      await previewCafe(el);

      sendTo(el)!.querySelector<HTMLInputElement>('input[value="wo-check"]')!.click();
      await el.updateComplete;
      const captured = confirmPreview(el);

      expect(captured!.detail.billId).toBe("wo-check");
    });

    it("defaults to the main bill even on a bill split off it", async () => {
      const { el } = await mount({ ...partyBills(), orderId: "wo-check" });
      await previewCafe(el);

      expect(choices(el).find((choice) => choice.checked)!.value).toBe("wo-4");
    });

    it("starts again from the main bill each time the preview opens", async () => {
      const { el } = await mount({ ...partyBills(), orderId: "wo-4" });
      await previewCafe(el);
      sendTo(el)!.querySelector<HTMLInputElement>('input[value="wo-check"]')!.click();
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>("[data-draft-dismiss]")!.click();
      await el.updateComplete;

      await openPreview(el, "fire-all");

      expect(choices(el).find((choice) => choice.checked)!.value).toBe("wo-4");
    });

    it("offers no choice, and names no bill, when the party has one open bill", async () => {
      const { el } = await mount({
        party: anaParty,
        bills: [tabBill, paidBill, placedBill, mergedPartyBill],
        orderId: "wo-4",
      });
      await previewCafe(el);

      expect(sendTo(el)).toBeNull();
      expect(confirmPreview(el)!.detail).not.toHaveProperty("billId");
    });

    it("offers a new bill first, and by default, when the party has no main bill", async () => {
      const { el } = await mount({
        party: { ...anaParty, mainBillId: null },
        bills: [paidBill, checkBill],
        orderId: "wo-check",
      });
      await previewCafe(el);

      expect(choices(el).map(({ value, checked, label }) => ({ value, checked, label }))).toEqual([
        { value: "", checked: true, label: t("table.send_to_new") },
        { value: "wo-check", checked: false, label: billName(2) },
      ]);
      expect(confirmPreview(el)!.detail).not.toHaveProperty("billId");
    });

    it("offers no choice for an order that belongs to no party", async () => {
      const { el } = await mount({ orderId: "wo-4" });
      await previewCafe(el);

      expect(sendTo(el)).toBeNull();
    });

    const checkedChoice = (el: TillTableOrderScreen) =>
      choices(el)
        .filter((choice) => choice.checked)
        .map(({ value, label }) => ({ value, label }));

    it("keeps the chosen bill, and sends it, after a refresh shows it presented", async () => {
      const { el } = await mount({ ...partyBills(), orderId: "wo-4" });
      await previewCafe(el);
      sendTo(el)!.querySelector<HTMLInputElement>('input[value="wo-check"]')!.click();
      await el.updateComplete;

      el.bills = [tabBill, { ...checkBill, status: "placed" }];
      await el.updateComplete;

      expect(checkedChoice(el)).toEqual([
        { value: "wo-check", label: `${billName(2)} ${t("table.send_to_not_open")}` },
      ]);
      expect(confirmPreview(el)!.detail.billId).toBe("wo-check");
    });

    it("keeps the chosen bill under the name it was chosen by after it leaves the party's bills", async () => {
      const { el } = await mount({ ...partyBills(), orderId: "wo-4" });
      await previewCafe(el);
      sendTo(el)!.querySelector<HTMLInputElement>('input[value="wo-check"]')!.click();
      await el.updateComplete;

      el.bills = [tabBill, { ...checkBill, status: "abandoned" }];
      await el.updateComplete;

      expect(checkedChoice(el)).toEqual([
        { value: "wo-check", label: `${billName(2)} ${t("table.send_to_not_open")}` },
      ]);
      expect(confirmPreview(el)!.detail.billId).toBe("wo-check");
    });

    it("tells a chosen bill merged away from the bill that takes its name", async () => {
      const thirdBill = bill({ workingOrderId: "wo-third" });
      const { el } = await mount({
        party: anaParty,
        bills: [tabBill, checkBill, thirdBill],
        orderId: "wo-4",
      });
      await previewCafe(el);
      sendTo(el)!.querySelector<HTMLInputElement>('input[value="wo-check"]')!.click();
      await el.updateComplete;

      el.bills = [tabBill, { ...checkBill, status: "abandoned" }, thirdBill];
      await el.updateComplete;

      expect(choices(el).map(({ value, checked, label }) => ({ value, checked, label }))).toEqual([
        { value: "wo-4", checked: false, label: `${billName(1)} ${t("table.bill_main")}` },
        { value: "wo-third", checked: false, label: billName(2) },
        {
          value: "wo-check",
          checked: true,
          label: `${billName(2)} ${t("table.send_to_not_open")}`,
        },
      ]);
      expect(confirmPreview(el)!.detail.billId).toBe("wo-check");
    });

    it("follows the party's main bill when it moves while the preview is open and nothing was chosen", async () => {
      const { el } = await mount({ ...partyBills(), orderId: "wo-4" });
      await previewCafe(el);

      el.party = { ...anaParty, mainBillId: "wo-check" };
      el.bills = [{ ...tabBill, status: "placed" }, checkBill, partlyPaidBill];
      await el.updateComplete;

      expect(checkedChoice(el)).toEqual([
        { value: "wo-check", label: `${billName(2)} ${t("table.bill_main")}` },
      ]);
      expect(confirmPreview(el)!.detail).not.toHaveProperty("billId");
    });

    it("sends the main bill by name when the waiter chose it, not only when another bill was", async () => {
      const { el } = await mount({ ...partyBills(), orderId: "wo-4" });
      await previewCafe(el);
      sendTo(el)!.querySelector<HTMLInputElement>('input[value="wo-check"]')!.click();
      await el.updateComplete;
      sendTo(el)!.querySelector<HTMLInputElement>('input[value="wo-4"]')!.click();
      await el.updateComplete;

      expect(checkedChoice(el)).toEqual([
        { value: "wo-4", label: `${billName(1)} ${t("table.bill_main")}` },
      ]);
      expect(confirmPreview(el)!.detail.billId).toBe("wo-4");
    });

    it("sends the bill chosen as the main one by name once another bill becomes the main one", async () => {
      const { el } = await mount({ ...partyBills(), orderId: "wo-4" });
      await previewCafe(el);
      sendTo(el)!.querySelector<HTMLInputElement>('input[value="wo-check"]')!.click();
      await el.updateComplete;
      sendTo(el)!.querySelector<HTMLInputElement>('input[value="wo-4"]')!.click();
      await el.updateComplete;

      el.party = { ...anaParty, mainBillId: "wo-check" };
      await el.updateComplete;

      expect(checkedChoice(el)).toEqual([{ value: "wo-4", label: billName(1) }]);
      expect(confirmPreview(el)!.detail.billId).toBe("wo-4");
    });

    it("moves the default from a new bill to the main bill another device made meanwhile", async () => {
      const { el } = await mount({
        party: { ...anaParty, mainBillId: null },
        bills: [paidBill, checkBill],
        orderId: "wo-check",
      });
      await previewCafe(el);

      el.party = { ...anaParty, mainBillId: "wo-4" };
      el.bills = [paidBill, checkBill, tabBill];
      await el.updateComplete;

      expect(checkedChoice(el)).toEqual([
        { value: "wo-4", label: `${billName(3)} ${t("table.bill_main")}` },
      ]);
      expect(confirmPreview(el)!.detail).not.toHaveProperty("billId");
    });
  });

  describe("table actions (TS-3/TS-4)", () => {
    const tableState = (over: Partial<TableState> = {}): TableState => ({
      id: "t1",
      label: "1",
      zoneId: null,
      capacity: null,
      state: "free",
      condition: "free",
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
      today: null,
      signals: [],
      party: null,
      ...over,
    });

    async function toMenu(el: TillTableOrderScreen): Promise<void> {
      await openDrawer(el);
      el.shadowRoot!.querySelector<HTMLElement>("[data-move-split]")!.click();
      await el.updateComplete;
    }
    const click = (el: TillTableOrderScreen, selector: string) =>
      el.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
    const splitBottom = (el: TillTableOrderScreen) =>
      el.shadowRoot!.querySelector<HTMLElement & { error: string }>(
        "[data-split-lines] wt-form-actions",
      )!;
    const splitConfirm = (el: TillTableOrderScreen) =>
      el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-split-confirm]")!;

    const setSplitQuantity = async (el: TillTableOrderScreen, lineNo: number, value: string) => {
      const field = el.shadowRoot!.querySelector<HTMLElement>(`[data-split-quantity="${lineNo}"]`)!;
      const input = field.shadowRoot!.querySelector("input")!;
      input.value = value;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
      await el.updateComplete;
    };

    /** The ids the open target picker offers, in order. */
    const targetIds = (el: TillTableOrderScreen) =>
      [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-target]")].map(
        (target) => target.dataset.target,
      );

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
      expect(el.shadowRoot!.querySelector("[data-split-confirm]")!.textContent!.trim()).toBe(
        "Add bill",
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

    it("says on the native button, the element a screen reader announces, whether a split line is picked", async () => {
      const second = { ...pendingLine, lineNo: 2, productId: "agua", quantity: "1.000" };
      const { el } = await mount({ lines: [pendingLine, second], orderId: "wo-7" });
      await toMenu(el);
      click(el, '[data-action="split"]');
      await el.updateComplete;
      const pressed = (lineNo: number) => {
        const button = el.shadowRoot!.querySelector(`[data-split-line="${lineNo}"]`);
        expect(button).toBeInstanceOf(HTMLButtonElement);
        return button!.getAttribute("aria-pressed");
      };
      expect([pressed(1), pressed(2)]).toEqual(["false", "false"]);

      click(el, '[data-split-line="2"]');
      await el.updateComplete;
      expect([pressed(1), pressed(2)]).toEqual(["false", "true"]);
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
        expect(splitBottom(el).error).toBe(t("form.fix_fields"));
        expect(el.shadowRoot!.querySelector("wt-form-error-summary")).toBeNull();
        expect(splitConfirm(el).disabled).toBe(true);
      },
    );

    /** Two weighed dishes, on the split step with both picked. */
    const splitTwoLines = async () => {
      const weight = {
        ...pendingLine,
        productId: "jamon",
        unitPrecision: 3,
        quantity: "0.750",
        unitPriceGross: "20.00",
      };
      const cheese = {
        ...weight,
        lineNo: 2,
        productId: "queso",
        quantity: "0.500",
      };
      const { el } = await mount({ lines: [weight, cheese], orderId: "wo-7" });
      await toMenu(el);
      click(el, '[data-action="split"]');
      await el.updateComplete;
      click(el, '[data-split-line="1"]');
      click(el, '[data-split-line="2"]');
      await el.updateComplete;
      return el;
    };

    it("decimal input split quantity accepts either mark and shows Spanish", async () => {
      const locale = currentLocale();
      setLocale("es");
      try {
        const el = await splitTwoLines();
        const field = el.shadowRoot!.querySelector<
          HTMLElement & { updateComplete: Promise<unknown> }
        >('[data-split-quantity="1"]')!;
        await field.updateComplete;
        const native = field.shadowRoot!.querySelector("input")!;
        expect(native.value).toBe("0,75");
        for (const separator of [".", ","]) {
          native.value = `0${separator}125`;
          native.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
          await el.updateComplete;
          await field.updateComplete;
          expect(native.value).toBe("0,125");
        }
        let sent: unknown;
        el.addEventListener("split-lines", (event) => (sent = (event as CustomEvent).detail));
        click(el, "[data-split-confirm]");
        expect(sent).toEqual({
          transfers: [{ lineNo: 1, quantity: "0.125" }, { lineNo: 2 }],
        });
      } finally {
        setLocale(locale);
      }
    });

    it("split says nothing about a bad quantity until Split is pressed", async () => {
      const el = await splitTwoLines();

      await setSplitQuantity(el, 1, "0");

      const field = el.shadowRoot!.querySelector<HTMLElement & { error: string }>(
        '[data-split-quantity="1"]',
      )!;
      expect(field.error).toBe("");
      expect(splitBottom(el).error).toBe("");
      expect(splitConfirm(el).disabled).toBe(false);
    });

    it("split re-checks each quantity as it changes after a refused press, and Split works again once all are fixed", async () => {
      const el = await splitTwoLines();
      let captured: CustomEvent | undefined;
      el.addEventListener("split-lines", (event) => (captured = event as CustomEvent));
      await setSplitQuantity(el, 1, "0");
      await setSplitQuantity(el, 2, "9");
      click(el, "[data-split-confirm]");
      await el.updateComplete;
      const error = (lineNo: number) =>
        el.shadowRoot!.querySelector<HTMLElement & { error: string }>(
          `[data-split-quantity="${lineNo}"]`,
        )!.error;
      expect(error(1)).toBe(t("table.split_quantity_decimal_error"));
      expect(error(2)).toBe(t("table.split_quantity_decimal_error"));

      await setSplitQuantity(el, 1, "0.5");

      expect(error(1)).toBe("");
      expect(error(2)).toBe(t("table.split_quantity_decimal_error"));
      expect(splitBottom(el).error).toBe(t("form.fix_fields"));
      expect(splitConfirm(el).disabled).toBe(true);

      await setSplitQuantity(el, 2, "0.25");

      expect(error(2)).toBe("");
      expect(splitBottom(el).error).toBe("");
      expect(splitConfirm(el).disabled).toBe(false);
      click(el, "[data-split-confirm]");
      expect(captured!.detail).toEqual({
        transfers: [
          { lineNo: 1, quantity: "0.5" },
          { lineNo: 2, quantity: "0.25" },
        ],
      });
    });

    it("split keeps a bad quantity's message when another dish is unpicked after a refused press", async () => {
      const el = await splitTwoLines();
      await setSplitQuantity(el, 1, "0");
      click(el, "[data-split-confirm]");
      await el.updateComplete;

      click(el, '[data-split-line="2"]');
      await el.updateComplete;

      expect(
        el.shadowRoot!.querySelector<HTMLElement & { error: string }>('[data-split-quantity="1"]')!
          .error,
      ).toBe(t("table.split_quantity_decimal_error"));
      expect(splitBottom(el).error).toBe(t("form.fix_fields"));
      expect(splitConfirm(el).disabled).toBe(true);
    });

    it("split moves the cursor to the first bad quantity when Split is refused", async () => {
      const el = await splitTwoLines();
      await setSplitQuantity(el, 2, "0");

      click(el, "[data-split-confirm]");

      const field = el.shadowRoot!.querySelector<HTMLElement>('[data-split-quantity="2"]')!;
      await vi.waitFor(() =>
        expect(field.shadowRoot!.activeElement).toBe(field.shadowRoot!.querySelector("input")),
      );
    });

    // A line sold as a variant names the VARIANT as its product, and a variant is never a till
    // product of its own (the till's products are the offers' parents), so the split has to read the
    // unit precision the line froze rather than look the product up.
    it("splits a variant line sold by the unit with the whole-number stepper", async () => {
      const variantLine: TabLine = {
        ...pendingLine,
        productId: "wine-125",
        name: "125 ml",
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

    /** Ana at Mesa 4 (and Mesa 5 with `atTwo`), and the floor around her. */
    const partyTables = (atTwo = false) => {
      const ana: TableParty = {
        ...anaParty,
        tableIds: atTwo ? ["t4", "t5"] : ["t4"],
      };
      const luis: TableParty = {
        ...anaParty,
        id: "v7",
        revision: 9,
        name: "Luis",
        displayName: "Luis",
        mainBillId: "wo-7",
        tableIds: ["t7"],
      };
      const held = (id: string, label: string, party: TableParty) =>
        tableState({ id, label, state: "open-tab", condition: "held", party });
      return {
        party: ana,
        tables: [
          held("t4", "Mesa 4", ana),
          ...(atTwo ? [held("t5", "Mesa 5", ana)] : []),
          held("t7", "Mesa 7", luis),
          tableState({ id: "t6", label: "Mesa 6", condition: "needs_clearing" }),
          tableState({ id: "t9", label: "Mesa 9" }),
        ],
      };
    };
    const target = (el: TillTableOrderScreen, id: string) =>
      el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(`[data-target="${id}"]`);
    const billChoice = (el: TillTableOrderScreen) =>
      el.shadowRoot!.querySelector<HTMLElement & { scope: string }>("till-bill-choice-dialog");
    function heard(el: TillTableOrderScreen, type: string): unknown[] {
      const details: unknown[] = [];
      el.addEventListener(type, (event) => {
        expect((event as CustomEvent).bubbles && (event as CustomEvent).composed).toBe(true);
        details.push((event as CustomEvent).detail);
      });
      return details;
    }

    describe("Move this bill", () => {
      /** Ana's second bill on screen, at Mesa 4, with the floor around her. */
      const onCheck = () => ({
        lines: [pendingLine],
        orderId: "wo-check",
        ...partyTables(),
        bills: partyBills().bills,
      });
      async function toMoveBill(el: TillTableOrderScreen): Promise<void> {
        await toMenu(el);
        click(el, '[data-action="move-bill"]');
        await el.updateComplete;
      }
      const scope = t("table.bill_of").replace("{party}", "Ana").replace("{n}", "2");

      it("lists The counter and every other table with its condition, under the bill it moves", async () => {
        const { el } = await mount(onCheck());
        await toMenu(el);
        expect(el.shadowRoot!.querySelector('[data-action="move-bill"]')!.textContent!.trim()).toBe(
          t("table.action_move_bill"),
        );
        click(el, '[data-action="move-bill"]');
        await el.updateComplete;

        expect(el.shadowRoot!.querySelector("[data-target-picker] h2")!.textContent!.trim()).toBe(
          t("table.move_bill_heading").replace("{bill}", scope),
        );
        expect(targetIds(el)).toEqual(["counter", "t7", "t6", "t9"]);
        expect(target(el, "counter")!.textContent).toContain(t("table.to_counter"));
        expect(target(el, "t9")!.textContent).toContain(t("floor.free"));
        expect(target(el, "t7")!.textContent).toContain(
          t("table.held_by").replace("{party}", "Luis"),
        );
        expect(target(el, "t6")!.disabled).toBe(true);
        expect(el.shadowRoot!.querySelector('[data-target-reason="t6"]')!.textContent!.trim()).toBe(
          codeMessage("table.needs_clearing"),
        );
      });

      it("moves the bill to the counter, or to a free table, at once", async () => {
        const { el } = await mount(onCheck());
        const moved = heard(el, "move-bill");
        await toMoveBill(el);
        target(el, "counter")!.click();
        await el.updateComplete;
        expect(el.shadowRoot!.querySelector("[data-target-picker]")).toBeNull();
        const pickAgain = async (id: string) => {
          click(el, "[data-move-split]");
          await el.updateComplete;
          click(el, '[data-action="move-bill"]');
          await el.updateComplete;
          target(el, id)!.click();
          await el.updateComplete;
        };
        await pickAgain("t9");
        await pickAgain("t6");
        await el.updateComplete;

        expect(moved).toEqual([
          { to: { counter: true }, bills: "merge" },
          { to: { tableId: "t9", seated: null }, bills: "merge" },
        ]);
        expect(billChoice(el)).toBeNull();
      });

      it("asks about the bills first at a table another party holds, naming the bill and where it goes", async () => {
        const { el } = await mount(onCheck());
        const moved = heard(el, "move-bill");
        await toMoveBill(el);
        target(el, "t7")!.click();
        await el.updateComplete;

        const dialog = billChoice(el)!;
        expect(moved).toEqual([]);
        expect(dialog.scope).toBe(
          t("table.move_bill_scope").replace("{bill}", scope).replace("{into}", "Luis (Mesa 7)"),
        );
        await (dialog as unknown as { updateComplete: Promise<unknown> }).updateComplete;
        expect(dialog.shadowRoot!.textContent).toContain(t("table.bill_move_question"));
        dialog.shadowRoot!.querySelector<HTMLElement>("[data-bills-separate]")!.click();
        await el.updateComplete;

        expect(moved).toEqual([
          { to: { tableId: "t7", seated: { id: "v7", revision: 9 } }, bills: "separate" },
        ]);
        expect(billChoice(el)).toBeNull();
      });

      it("sends the party the bill choice names, though the floor read since seats another there", async () => {
        const { el } = await mount(onCheck());
        const moved = heard(el, "move-bill");
        await toMoveBill(el);
        target(el, "t7")!.click();
        await el.updateComplete;
        el.tables = el.tables.map((table) =>
          table.id === "t7"
            ? {
                ...table,
                party: {
                  ...table.party!,
                  id: "v8",
                  revision: 2,
                  name: "Pedro",
                  displayName: "Pedro",
                },
              }
            : table,
        );
        await el.updateComplete;

        const dialog = billChoice(el)!;
        expect(dialog.scope).toBe(
          t("table.move_bill_scope").replace("{bill}", scope).replace("{into}", "Luis (Mesa 7)"),
        );
        await (dialog as unknown as { updateComplete: Promise<unknown> }).updateComplete;
        dialog.shadowRoot!.querySelector<HTMLElement>("[data-bills-merge]")!.click();
        await el.updateComplete;

        expect(moved).toEqual([
          { to: { tableId: "t7", seated: { id: "v7", revision: 9 } }, bills: "merge" },
        ]);
      });

      it("sends nothing when the bill choice is cancelled", async () => {
        const { el } = await mount(onCheck());
        const moved = heard(el, "move-bill");
        await toMoveBill(el);
        target(el, "t7")!.click();
        await el.updateComplete;
        billChoice(el)!.shadowRoot!.querySelector<HTMLElement>("[data-bills-cancel]")!.click();
        await el.updateComplete;

        expect(moved).toEqual([]);
        expect(billChoice(el)).toBeNull();
      });

      it("is offered on a presented or partly paid bill, and not on a paid one", async () => {
        for (const [orderId, offered] of [
          ["wo-placed", true],
          ["wo-part", true],
          ["wo-paid", false],
        ] as const) {
          const { el } = await mount({ ...onCheck(), orderId });
          await toMenu(el);
          expect(el.shadowRoot!.querySelector('[data-action="move-bill"]') !== null).toBe(offered);
          cleanupWidgets();
        }
      });
    });

    it("offers Split a table only when the party holds two or more tables, and Name the party with a party", async () => {
      const alone = await mount({ lines: [pendingLine], orderId: "wo-4", ...partyTables() });
      await toMenu(alone.el);
      expect(alone.el.shadowRoot!.querySelector('[data-action="move"]')!.textContent!.trim()).toBe(
        t("table.action_move_guests"),
      );
      expect(alone.el.shadowRoot!.querySelector('[data-action="split-table"]')).toBeNull();
      expect(alone.el.shadowRoot!.querySelector('[data-action="name"]')).not.toBeNull();

      const atTwo = await mount({ lines: [pendingLine], orderId: "wo-4", ...partyTables(true) });
      await toMenu(atTwo.el);
      expect(
        atTwo.el.shadowRoot!.querySelector('[data-action="split-table"]')!.textContent!.trim(),
      ).toBe(t("table.action_split_table"));
    });

    it("Move guests lists every other table with its condition, a table needing clearing disabled with its reason", async () => {
      const { el } = await mount({ lines: [pendingLine], orderId: "wo-4", ...partyTables() });
      await toMenu(el);
      click(el, '[data-action="move"]');
      await el.updateComplete;

      expect(el.shadowRoot!.querySelector("[data-target-picker] h2")!.textContent!.trim()).toBe(
        t("table.move_guests_heading").replace("{party}", "Ana (Mesa 4)"),
      );
      expect(targetIds(el)).toEqual(["t7", "t6", "t9"]);
      expect(target(el, "t9")!.textContent).toContain("Mesa 9");
      expect(target(el, "t9")!.textContent).toContain(t("floor.free"));
      expect(target(el, "t7")!.textContent).toContain(
        t("table.held_by").replace("{party}", "Luis"),
      );
      expect(target(el, "t6")!.disabled).toBe(true);
      expect(el.shadowRoot!.querySelector('[data-target-reason="t6"]')!.textContent!.trim()).toBe(
        codeMessage("table.needs_clearing"),
      );
      const moved = heard(el, "move-guests");
      target(el, "t6")!.click();
      await el.updateComplete;
      expect(moved).toEqual([]);
      expect(billChoice(el)).toBeNull();
    });

    it("names a seated party with no name of its own by the name the floor shows for it", async () => {
      const floor = partyTables();
      const unnamed = floor.tables.map((table) =>
        table.id === "t7"
          ? { ...table, party: { ...table.party!, name: null, displayName: "Mesa 7" } }
          : table,
      );
      const { el } = await mount({
        lines: [pendingLine],
        orderId: "wo-4",
        ...floor,
        tables: unnamed,
      });
      await toMenu(el);
      click(el, '[data-action="move"]');
      await el.updateComplete;

      expect(target(el, "t7")!.textContent).toContain(
        t("table.held_by").replace("{party}", "Mesa 7"),
      );
    });

    it("Move guests to a free table dispatches move-guests { toTableId, bills } at once and closes", async () => {
      const { el } = await mount({ lines: [pendingLine], orderId: "wo-4", ...partyTables() });
      const moved = heard(el, "move-guests");
      await toMenu(el);
      click(el, '[data-action="move"]');
      await el.updateComplete;

      click(el, '[data-target="t9"]');
      await el.updateComplete;

      expect(moved).toEqual([{ toTableId: "t9", bills: "merge" }]);
      expect(billChoice(el)).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-action-menu]")).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-move-split]")).not.toBeNull();
    });

    it("Move guests to a seated table asks about the bills first, stating who joins whom, and sends the choice", async () => {
      const { el } = await mount({ lines: [pendingLine], orderId: "wo-4", ...partyTables(true) });
      const moved = heard(el, "move-guests");
      await toMenu(el);
      click(el, '[data-action="move"]');
      await el.updateComplete;

      click(el, '[data-target="t7"]');
      await el.updateComplete;

      expect(moved).toEqual([]);
      expect(billChoice(el)!.scope).toBe(
        t("table.combine_scope")
          .replace("{from}", "Ana (Mesa 4, 5)")
          .replace("{into}", "Luis (Mesa 7)"),
      );
      billChoice(el)!.dispatchEvent(
        new CustomEvent("bill-choice-confirm", {
          detail: { bills: "separate" },
          bubbles: true,
          composed: true,
        }),
      );
      await el.updateComplete;

      expect(moved).toEqual([{ toTableId: "t7", bills: "separate" }]);
      expect(billChoice(el)).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-move-split]")).not.toBeNull();
    });

    it("cancelling the bill choice sends nothing and leaves the table list open", async () => {
      const { el } = await mount({ lines: [pendingLine], orderId: "wo-4", ...partyTables() });
      const moved = heard(el, "move-guests");
      await toMenu(el);
      click(el, '[data-action="move"]');
      await el.updateComplete;
      click(el, '[data-target="t7"]');
      await el.updateComplete;

      billChoice(el)!.dispatchEvent(
        new CustomEvent("bill-choice-cancel", { bubbles: true, composed: true }),
      );
      await el.updateComplete;

      expect(moved).toEqual([]);
      expect(billChoice(el)).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-target-picker]")).not.toBeNull();
    });

    it("Join a table to a seated table asks with the other party joining this one, and dispatches join-tables", async () => {
      const { el } = await mount({ lines: [pendingLine], orderId: "wo-4", ...partyTables() });
      const joined = heard(el, "join-tables");
      await toMenu(el);
      click(el, '[data-action="join"]');
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-target-picker] h2")!.textContent!.trim()).toBe(
        t("table.join_heading").replace("{party}", "Ana (Mesa 4)"),
      );

      click(el, '[data-target="t9"]');
      await el.updateComplete;
      click(el, "[data-move-split]");
      await el.updateComplete;
      click(el, '[data-action="join"]');
      await el.updateComplete;
      click(el, '[data-target="t7"]');
      await el.updateComplete;
      expect(billChoice(el)!.scope).toBe(
        t("table.combine_scope")
          .replace("{from}", "Luis (Mesa 7)")
          .replace("{into}", "Ana (Mesa 4)"),
      );
      billChoice(el)!.dispatchEvent(
        new CustomEvent("bill-choice-confirm", {
          detail: { bills: "merge" },
          bubbles: true,
          composed: true,
        }),
      );
      await el.updateComplete;

      expect(joined).toEqual([
        { tableId: "t9", bills: "merge" },
        { tableId: "t7", bills: "merge" },
      ]);
    });

    it("Join a table leaves out the party's own tables; Move guests offers them, as these guests, only when the party holds two", async () => {
      const { el } = await mount({ lines: [pendingLine], orderId: "wo-4", ...partyTables(true) });
      await toMenu(el);
      click(el, '[data-action="join"]');
      await el.updateComplete;
      expect(targetIds(el)).toEqual(["t7", "t6", "t9"]);

      click(el, "[data-action-back]");
      await el.updateComplete;
      click(el, '[data-action="move"]');
      await el.updateComplete;
      expect(targetIds(el)).toEqual(["t4", "t5", "t7", "t6", "t9"]);
      expect(target(el, "t5")!.textContent).toContain(t("table.this_party"));
      const moved = heard(el, "move-guests");
      click(el, '[data-target="t5"]');
      await el.updateComplete;
      expect(billChoice(el)).toBeNull();
      expect(moved).toEqual([{ toTableId: "t5", bills: "merge" }]);
    });

    it("Split a table picks one of the party's tables, then one of its open or presented bills other than the main one, or none", async () => {
      const { el } = await mount({
        lines: [pendingLine],
        orderId: "wo-4",
        ...partyTables(true),
        bills: partyBills().bills,
      });
      const split = heard(el, "split-table");
      await toMenu(el);
      click(el, '[data-action="split-table"]');
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-split-table] h2")!.textContent!.trim()).toBe(
        t("table.split_table_heading").replace("{party}", "Ana (Mesa 4, 5)"),
      );
      expect(targetIds(el)).toEqual(["t4", "t5"]);

      click(el, '[data-target="t5"]');
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-split-table] h2")!.textContent!.trim()).toBe(
        t("table.split_table_bill_heading")
          .replace("{table}", "Mesa 5")
          .replace("{party}", "Ana (Mesa 4, 5)"),
      );
      expect(targetIds(el)).toEqual(["wo-check", "wo-placed", "wo-part", "none"]);
      expect(target(el, "none")!.textContent!.trim()).toBe(t("table.split_no_bill"));
      click(el, '[data-target="wo-check"]');
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-move-split]")).not.toBeNull();

      click(el, "[data-move-split]");
      await el.updateComplete;
      click(el, '[data-action="split-table"]');
      await el.updateComplete;
      click(el, '[data-target="t5"]');
      await el.updateComplete;
      click(el, '[data-target="none"]');
      await el.updateComplete;

      expect(split).toEqual([
        { tableId: "t5", billId: "wo-check" },
        { tableId: "t5", billId: null },
      ]);
    });

    it("Back from choosing Split a table's bill returns to its tables", async () => {
      const { el } = await mount({ lines: [pendingLine], orderId: "wo-4", ...partyTables(true) });
      await toMenu(el);
      click(el, '[data-action="split-table"]');
      await el.updateComplete;
      click(el, '[data-target="t5"]');
      await el.updateComplete;

      click(el, "[data-action-back]");
      await el.updateComplete;
      expect(targetIds(el)).toEqual(["t4", "t5"]);
      click(el, "[data-action-back]");
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-action-menu]")).not.toBeNull();
    });

    it("Name the party opens the name dialog with the party's name, and sends name-party { name }", async () => {
      const { el } = await mount({ lines: [pendingLine], orderId: "wo-4", ...partyTables(true) });
      const named = heard(el, "name-party");
      await toMenu(el);
      click(el, '[data-action="name"]');
      await el.updateComplete;
      const dialog = el.shadowRoot!.querySelector<
        HTMLElement & { value: string; tables: string; refusal: string }
      >("till-party-name-dialog")!;
      expect(dialog.value).toBe("Ana");
      expect(dialog.tables).toBe("Mesa 4, 5");
      expect(dialog.refusal).toBe("");

      dialog.dispatchEvent(
        new CustomEvent("party-name-confirm", {
          detail: { name: "Ana B" },
          bubbles: true,
          composed: true,
        }),
      );
      await el.updateComplete;

      expect(named).toEqual([{ name: "Ana B" }]);
      expect(el.shadowRoot!.querySelector("till-party-name-dialog")).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-move-split]")).not.toBeNull();
    });

    it("reopens the name dialog with the name sent and the refusal beside the field when the app hands one back", async () => {
      const { el } = await mount({ lines: [pendingLine], orderId: "wo-4", ...partyTables() });

      el.nameRefusal = { name: "Ana de la mesa del fondo", message: t("table.name_too_long") };
      await el.updateComplete;

      const dialog = el.shadowRoot!.querySelector<HTMLElement & { value: string; refusal: string }>(
        "till-party-name-dialog",
      )!;
      expect(dialog.value).toBe("Ana de la mesa del fondo");
      expect(dialog.refusal).toBe(t("table.name_too_long"));
      dialog.dispatchEvent(new CustomEvent("party-name-cancel", { bubbles: true, composed: true }));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("till-party-name-dialog")).toBeNull();
    });

    it("merge lists the party's other untouched bills only, and dispatches merge-bills { fromBillId }", async () => {
      const { el } = await mount({ ...partyBills(), orderId: "wo-4" });
      await toMenu(el);
      click(el, '[data-action="merge"]');
      await el.updateComplete;

      expect(targetIds(el)).toEqual(["wo-check"]);
      expect(el.shadowRoot!.querySelector('[data-target="wo-check"]')!.textContent).toContain(
        t("table.bill_of").replace("{party}", "Ana").replace("{n}", "2"),
      );
      let captured: CustomEvent | undefined;
      el.addEventListener("merge-bills", (e) => (captured = e as CustomEvent));
      click(el, '[data-target="wo-check"]');
      await el.updateComplete;
      expect(captured!.composed).toBe(true);
      expect(captured!.detail).toEqual({ fromBillId: "wo-check" });
      expect(el.shadowRoot!.querySelector("[data-action-menu]")).toBeNull();
    });

    it("offers neither merge nor transfer a bill holding a pending payment, though it still owes its total", async () => {
      const pendingCard = bill({
        workingOrderId: "wo-pending",
        total: "20.00",
        outstanding: "20.00",
        hasPayments: true,
      });
      for (const verb of ["merge", "transfer"]) {
        const { el } = await mount({
          party: anaParty,
          bills: [tabBill, checkBill, pendingCard],
          lines: [pendingLine],
          orderId: "wo-4",
        });
        await toMenu(el);
        click(el, `[data-action="${verb}"]`);
        await el.updateComplete;
        expect(targetIds(el), verb).toEqual(["wo-check"]);
      }
    });

    it("says which bill the chosen one merges into before anything is chosen", async () => {
      const { el } = await mount({ ...partyBills(), orderId: "wo-check" });
      await toMenu(el);
      click(el, '[data-action="merge"]');
      await el.updateComplete;

      expect(el.shadowRoot!.querySelector("[data-target-picker] h2")!.textContent!.trim()).toBe(
        t("table.merge_into").replace(
          "{bill}",
          t("table.bill_of").replace("{party}", "Ana").replace("{n}", "2"),
        ),
      );
    });

    it("says which bill a transfer takes items from, and then asks for the items and names both bills", async () => {
      const { el } = await mount({ ...partyBills(), lines: [pendingLine], orderId: "wo-4" });
      await toMenu(el);
      click(el, '[data-action="transfer"]');
      await el.updateComplete;
      const anaBill = (n: number) =>
        t("table.bill_of").replace("{party}", "Ana").replace("{n}", String(n));

      expect(el.shadowRoot!.querySelector("[data-target-picker] h2")!.textContent!.trim()).toBe(
        t("table.transfer_from").replace("{bill}", anaBill(1)),
      );
      click(el, '[data-target="wo-check"]');
      await el.updateComplete;
      const itemsHeading = el
        .shadowRoot!.querySelector("[data-transfer-lines] h2")!
        .textContent!.trim();
      expect(itemsHeading).toBe(
        t("table.transfer_from_to").replace("{from}", anaBill(1)).replace("{to}", anaBill(2)),
      );
      expect(itemsHeading).toBe("Choose items to transfer from Ana · Bill 1 to Ana · Bill 2");
    });

    it("heads the transfer's items plainly once the bill they go to leaves the party's bills", async () => {
      const { el } = await mount({ ...partyBills(), lines: [pendingLine], orderId: "wo-4" });
      await toMenu(el);
      click(el, '[data-action="transfer"]');
      await el.updateComplete;
      click(el, '[data-target="wo-check"]');
      await el.updateComplete;

      el.bills = [tabBill, { ...checkBill, status: "abandoned" }];
      await el.updateComplete;

      expect(el.shadowRoot!.querySelector("[data-transfer-lines] h2")!.textContent!.trim()).toBe(
        t("table.actions_title"),
      );
    });

    it("offers nothing to transfer to, under the plain heading, for an order that belongs to no party", async () => {
      const { el } = await mount({ lines: [pendingLine], orderId: "wo-4" });
      await toMenu(el);
      click(el, '[data-action="transfer"]');
      await el.updateComplete;

      const picker = el.shadowRoot!.querySelector("[data-target-picker]")!;
      expect(picker.querySelector("h2")!.textContent!.trim()).toBe(t("table.actions_title"));
      expect(picker.textContent).toContain(t("table.no_other_bills"));
    });

    it("offers nothing to merge, under the plain heading, for an order that belongs to no party", async () => {
      const { el } = await mount({ lines: [pendingLine], orderId: "wo-4" });
      await toMenu(el);
      click(el, '[data-action="merge"]');
      await el.updateComplete;

      const picker = el.shadowRoot!.querySelector("[data-target-picker]")!;
      expect(picker.querySelector("h2")!.textContent!.trim()).toBe(t("table.actions_title"));
      expect(picker.textContent).toContain(t("table.no_other_bills"));
    });

    it("names the merge verb for bills", async () => {
      const { el } = await mount({ ...partyBills(), orderId: "wo-4" });
      await toMenu(el);

      expect(el.shadowRoot!.querySelector('[data-action="merge"]')!.textContent!.trim()).toBe(
        t("table.action_merge_bills"),
      );
    });

    it("transfer offers the same bills as merge, then dispatches transfer-lines { toBillId, transfers }", async () => {
      const { el } = await mount({ ...partyBills(), lines: [pendingLine], orderId: "wo-4" });
      await toMenu(el);
      click(el, '[data-action="transfer"]');
      await el.updateComplete;
      expect(targetIds(el)).toEqual(["wo-check"]);
      // Picking the destination bill advances to the line-picker step (does NOT dispatch yet).
      click(el, '[data-target="wo-check"]');
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
      expect(captured!.detail).toEqual({ toBillId: "wo-check", transfers: [{ lineNo: 1 }] });
      expect(el.shadowRoot!.querySelector("[data-action-menu]")).toBeNull();
    });

    it("says on the native button, the element a screen reader announces, whether a transfer line is picked", async () => {
      const second = { ...pendingLine, lineNo: 2, productId: "agua", quantity: "1.000" };
      const { el } = await mount({
        ...partyBills(),
        lines: [pendingLine, second],
        orderId: "wo-4",
      });
      await toMenu(el);
      click(el, '[data-action="transfer"]');
      await el.updateComplete;
      click(el, '[data-target="wo-check"]');
      await el.updateComplete;
      const pressed = (lineNo: number) => {
        const button = el.shadowRoot!.querySelector(`[data-transfer-line="${lineNo}"]`);
        expect(button).toBeInstanceOf(HTMLButtonElement);
        return button!.getAttribute("aria-pressed");
      };
      expect([pressed(1), pressed(2)]).toEqual(["false", "false"]);

      click(el, '[data-transfer-line="1"]');
      await el.updateComplete;
      expect([pressed(1), pressed(2)]).toEqual(["true", "false"]);
    });

    it("dispatches no transfer while no item is chosen, even when Confirm is pressed", async () => {
      const { el } = await mount({ ...partyBills(), lines: [pendingLine], orderId: "wo-4" });
      await toMenu(el);
      click(el, '[data-action="transfer"]');
      await el.updateComplete;
      click(el, '[data-target="wo-check"]');
      await el.updateComplete;
      let sent = false;
      el.addEventListener("transfer-lines", () => (sent = true));

      el.shadowRoot!.querySelector<HTMLElement>("[data-transfer-confirm]")!
        .shadowRoot!.querySelector<HTMLButtonElement>("button")!
        .click();
      await el.updateComplete;

      expect(sent).toBe(false);
      expect(el.shadowRoot!.querySelector("[data-transfer-lines]")).not.toBeNull();
    });

    it("offers Split on a bill split off before, as on the main bill", async () => {
      const { el } = await mount({ ...partyBills(), lines: [pendingLine], orderId: "wo-check" });
      await toMenu(el);
      let captured: CustomEvent | undefined;
      el.addEventListener("split-lines", (e) => (captured = e as CustomEvent));

      click(el, '[data-action="split"]');
      await el.updateComplete;
      click(el, '[data-split-line="1"]');
      await el.updateComplete;
      click(el, "[data-split-confirm]");
      await el.updateComplete;

      expect(captured!.detail).toEqual({ transfers: [{ lineNo: 1 }] });
    });

    it("merges into the bill on screen from the main bill when the bill on screen was split off", async () => {
      const { el } = await mount({ ...partyBills(), orderId: "wo-check" });
      await toMenu(el);
      click(el, '[data-action="merge"]');
      await el.updateComplete;

      expect(targetIds(el)).toEqual(["wo-4"]);
    });

    it("transfer line-picker offers dishes only, never a child extras row", async () => {
      // The server REFUSES a directly named child and cascades a dish's children with the dish instead.
      const child = { ...pendingLine, lineNo: 2, parentLineNo: 1, quantity: "1.000" };
      const { el } = await mount({
        ...partyBills(),
        lines: [pendingLine, child],
        orderId: "wo-4",
      });
      await toMenu(el);
      click(el, '[data-action="transfer"]');
      await el.updateComplete;
      click(el, '[data-target="wo-check"]');
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('[data-transfer-line="1"]')).not.toBeNull();
      expect(el.shadowRoot!.querySelector('[data-transfer-line="2"]')).toBeNull();
    });

    it("shows an empty-state when there are no other tables to move to", async () => {
      const { el } = await mount({ lines: [pendingLine], orderId: "wo-7", tables: [] });
      await toMenu(el);
      click(el, '[data-action="move"]');
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-target-picker]")!.textContent).toContain(
        t("table.no_other_tables"),
      );
    });

    it("shows an empty-state when the party has no other bill to merge", async () => {
      const { el } = await mount({
        lines: [pendingLine],
        orderId: "wo-4",
        party: anaParty,
        bills: [tabBill, paidBill, placedBill],
      });
      await toMenu(el);
      click(el, '[data-action="merge"]');
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-target-picker]")!.textContent).toContain(
        t("table.no_other_bills"),
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
    const foodMenu = servedMenu("cat-food", "Comida", true, [bocadillo]);
    const drinksMenu = servedMenu("cat-drinks", "Bebidas", false, [cerveza]);
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

    it("hands the browser the selected menu, with that menu's own Device Home Page", async () => {
      const drinksBar = {
        ...drinksMenu,
        home: { ...drinksMenu.home, shortcuts: [{ kind: "product", productId: "cerveza" }] },
      } satisfies TillZoneMenu;
      const { el } = await mount({ ...bothMenus, menus: [foodMenu, drinksBar] });
      expect(grid(el).menu).toBe(foodMenu);
      el.selectedMenuId = "cat-drinks";
      await el.updateComplete;
      await grid(el).updateComplete;
      expect(grid(el).menu).toBe(drinksBar);
      expect(grid(el).products).toEqual([cerveza]);
      const shortcuts = grid(el).shadowRoot!.querySelectorAll(
        '[data-region="shortcuts"] wt-button .name',
      );
      expect([...shortcuts].map((name) => name.textContent)).toEqual(["Cerveza"]);
    });

    it("hands the browser the device kind and no column count", async () => {
      const { el } = await mount(bothMenus);
      expect(grid(el).columns).toBeUndefined();
      expect(grid(el).handheld).toBe(false);
      el.handheld = true;
      await el.updateComplete;
      expect(grid(el).columns).toBeUndefined();
      expect(grid(el).handheld).toBe(true);
    });

    it("hands the browser the selected menu's products before the diet lens as well as after", async () => {
      const veganCerveza: TillProduct = {
        ...cerveza,
        diet: { vegan: "yes", vegetarian: "yes", contains: [] },
      };
      const croqueta: TillProduct = {
        ...cerveza,
        id: "croqueta",
        menuItemId: "menu-item-croqueta",
        name: "Croqueta",
        diet: { vegan: "no", vegetarian: "no", contains: ["meat"] },
      };
      const { el } = await mount({
        menus: [foodMenu, servedMenu("cat-drinks", "Bebidas", false, [veganCerveza, croqueta])],
        products: [bocadillo, veganCerveza, croqueta],
        selectedMenuId: "cat-drinks",
        selectedDiet: "vegan",
      });
      await grid(el).updateComplete;
      expect(grid(el).products).toEqual([veganCerveza]);
      expect(grid(el).unfilteredProducts).toEqual([veganCerveza, croqueta]);
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

    describe("search across the served menus", () => {
      async function search(el: TillTableOrderScreen, text: string): Promise<void> {
        const input = grid(el)
          .shadowRoot!.querySelector("wt-input")!
          .shadowRoot!.querySelector("input")!;
        input.value = text;
        input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        await grid(el).updateComplete;
      }

      function groups(el: TillTableOrderScreen) {
        return [
          ...grid(el).shadowRoot!.querySelectorAll<HTMLElement>(
            '[data-region="results"] section[data-menu]',
          ),
        ].map((group) => ({
          menu: group.dataset.menu,
          heading: group.querySelector("h3")!.textContent!.trim(),
          names: [...group.querySelectorAll("wt-button[data-kind] .name")].map((name) =>
            name.textContent!.trim(),
          ),
        }));
      }

      it("shows another served menu's matches in a group of their own", async () => {
        const { el } = await mount({ ...bothMenus, selectedMenuId: "cat-food" });
        await search(el, "c");
        expect(groups(el)).toEqual([
          {
            menu: "cat-food",
            heading: t("menu.results_this_menu").replace("{menu}", () => "Comida"),
            names: ["Bocadillo"],
          },
          { menu: "cat-drinks", heading: "Bebidas", names: ["Cerveza"] },
        ]);
      });

      it("leaves a product the diet lens rejects out of another menu's group", async () => {
        const veganCerveza: TillProduct = {
          ...cerveza,
          diet: { vegan: "yes", vegetarian: "yes", contains: [] },
        };
        const croqueta: TillProduct = {
          ...cerveza,
          id: "croqueta",
          menuItemId: "menu-item-croqueta",
          name: "Croqueta",
          diet: { vegan: "no", vegetarian: "no", contains: ["meat"] },
        };
        const { el } = await mount({
          menus: [foodMenu, servedMenu("cat-drinks", "Bebidas", false, [veganCerveza, croqueta])],
          products: [bocadillo, veganCerveza, croqueta],
          selectedMenuId: "cat-food",
        });
        await search(el, "c");
        expect(groups(el).find((group) => group.menu === "cat-drinks")?.names).toEqual([
          "Cerveza",
          "Croqueta",
        ]);
        el.selectedDiet = "vegan";
        await el.updateComplete;
        await grid(el).updateComplete;
        expect(groups(el).find((group) => group.menu === "cat-drinks")?.names).toEqual(["Cerveza"]);
      });
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

describe("till-table-order-screen — printing problems", () => {
  const problems: PrintProblem[] = [
    {
      workingOrderId: "wo-4",
      stationId: "st-1",
      stationName: "Cocina",
      since: "2026-09-27T10:00:00Z",
    },
    {
      workingOrderId: "wo-4",
      stationId: "st-2",
      stationName: "Barra",
      since: "2026-09-27T10:01:00Z",
    },
    {
      workingOrderId: "wo-check",
      stationId: "st-1",
      stationName: "Cocina",
      since: "2026-09-27T10:02:00Z",
    },
  ];
  const notice = (el: TillTableOrderScreen) =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-print-problem]");

  it("shows the problem and where, without opening the drawer", async () => {
    const { el } = await mount({ orderId: "wo-4", printProblems: problems });
    const text = notice(el)!.textContent!.replace(/\s+/g, " ");
    expect(text).toContain(t("table.print_problem"));
    expect(text).toContain(t("table.print_problem_detail").replace("{stations}", "Cocina, Barra"));
  });

  it("shows nothing while every ticket printed", async () => {
    const { el } = await mount({ orderId: "wo-4", printProblems: [] });
    expect(notice(el)).toBeNull();
  });

  it("Reprint asks for each affected bill once", async () => {
    const { el } = await mount({ orderId: "wo-4", printProblems: problems });
    const events: CustomEvent[] = [];
    el.addEventListener("reprint-kitchen-tickets", (e) => events.push(e as CustomEvent));
    const reprint = notice(el)!.querySelector<HTMLElement>("[data-print-problem-reprint]")!;
    expect(reprint.textContent).toContain(t("table.print_problem_reprint"));
    expect(underTapSize([reprint])).toEqual([]);
    reprint.click();
    expect(events.map((e) => e.detail)).toEqual([{ workingOrderIds: ["wo-4", "wo-check"] }]);
    expect(events[0]!.bubbles).toBe(true);
    expect(events[0]!.composed).toBe(true);
  });

  it("a bill whose tickets were sent to print again says so and offers no Reprint", async () => {
    const { el } = await mount({
      orderId: "wo-4",
      printProblems: problems,
      reprintSent: ["wo-4", "wo-check"],
    });
    const text = notice(el)!.textContent!.replace(/\s+/g, " ");
    expect(text).toContain(t("table.print_problem_sent").replace("{stations}", "Cocina, Barra"));
    expect(text).not.toContain(t("table.print_problem_detail").replace("{stations}", ""));
    expect(notice(el)!.querySelector("[data-print-problem-reprint]")).toBeNull();
  });

  it("Reprint asks only for the bills not sent to print again", async () => {
    const { el } = await mount({
      orderId: "wo-4",
      printProblems: problems,
      reprintSent: ["wo-4"],
    });
    const text = notice(el)!.textContent!.replace(/\s+/g, " ");
    expect(text).toContain(t("table.print_problem_detail").replace("{stations}", "Cocina"));
    expect(text).toContain(t("table.print_problem_sent").replace("{stations}", "Cocina, Barra"));
    const events: CustomEvent[] = [];
    el.addEventListener("reprint-kitchen-tickets", (e) => events.push(e as CustomEvent));
    notice(el)!.querySelector<HTMLElement>("[data-print-problem-reprint]")!.click();
    expect(events.map((e) => e.detail)).toEqual([{ workingOrderIds: ["wo-check"] }]);
  });

  it("never blocks ordering: a round is still sent while the problem shows", async () => {
    const { el } = await mount({ orderId: "wo-4", printProblems: problems });
    grid(el).shadowRoot!.querySelector<HTMLElement>("wt-button.tile")!.click();
    await el.updateComplete;
    const captured = await submitDraft(el, "fire-all");
    expect(captured!.detail.lines).toEqual([{ menuItemId: "menu-item-cafe", quantity: "1" }]);
    expect(notice(el)).not.toBeNull();
  });
});

describe("closed department ordering", () => {
  it("keeps the bill payable and movable when the zone stops new dishes", async () => {
    const previous = currentLocale();
    try {
      setLocale("en-GB");
      const draft = new WorkingOrderStore();
      draft.addProduct(cafe, "2");
      const { el } = await mount({
        draftStore: draft,
        lines: [pendingLine],
        orderId: "wo-closed-zone",
        zoneName: "Terrace",
        service: {
          open: true,
          zoneOpen: false,
          periodName: "Lunch",
          keepOpen: null,
          zoneKeepOpen: null,
        },
      });
      expect(el.shadowRoot!.querySelector("[data-zone-closed]")?.textContent?.trim()).toBe(
        "Terrace is closed: nothing new can be ordered here. Bills can be paid or moved to another area.",
      );
      expect(el.shadowRoot!.querySelector("till-menu-browser")).toBeNull();
      expect(el.shadowRoot!.querySelector("till-menu-switcher")).toBeNull();
      expect(draft.lines.map((line) => [line.product.id, line.quantity])).toEqual([["cafe", "2"]]);
      await openDrawer(el);
      const payment = el.shadowRoot!.querySelector<HTMLElement>('[data-open-bill-pay="items"]')!;
      expect(payment).not.toBeNull();
      const paid = vi.fn();
      el.addEventListener("bill-pay", paid);
      payment.click();
      expect(paid).toHaveBeenCalledOnce();
      el.shadowRoot!.querySelector<HTMLElement>("[data-move-split]")!.click();
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>('[data-action="move"]')!.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-target-picker]")).not.toBeNull();
      expect(el.lines.map((line) => line.id)).toEqual(["line-1"]);
    } finally {
      setLocale(previous);
    }
  });

  it("does not claim the department is closed while its offers are unread", async () => {
    const draft = new WorkingOrderStore();
    draft.addProduct(cafe, "2");
    const { el } = await mount({ draftStore: draft, service: null, departmentName: "Restaurant" });
    expect(el.shadowRoot!.querySelector("[data-service-closed]")).toBeNull();
    expect(el.shadowRoot!.querySelector("till-menu-browser")).toBeNull();
    expect(draft.lines.map((line) => [line.product.id, line.quantity])).toEqual([["cafe", "2"]]);
  });

  it("keeps saved and draft lines while removing the menu and all add tiles", async () => {
    const draft = new WorkingOrderStore();
    draft.addProduct(cafe, "2");
    const { el } = await mount({
      draftStore: draft,
      lines: [pendingLine],
      service: {
        open: false,
        zoneOpen: true,
        periodName: null,
        keepOpen: null,
        zoneKeepOpen: null,
      },
      departmentName: "Restaurant",
    });
    expect(el.shadowRoot!.querySelector("[data-service-closed]")?.textContent?.trim()).toBe(
      "Restaurant is closed: no period is running",
    );
    expect(el.shadowRoot!.querySelector("till-menu-browser")).toBeNull();
    expect(el.shadowRoot!.querySelector("till-menu-switcher")).toBeNull();
    expect(draft.lines.map((line) => [line.product.id, line.quantity])).toEqual([["cafe", "2"]]);
    expect(el.shadowRoot!.querySelector("[data-review-open]")).not.toBeNull();
    expect(el.lines.map((line) => line.id)).toEqual(["line-1"]);
  });
});
