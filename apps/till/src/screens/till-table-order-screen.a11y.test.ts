import { afterEach, describe, expect, it } from "vitest";
import { t } from "../i18n/t.js";
import {
  cleanupWidgets,
  expectNoA11yViolations,
  mountWidget,
  servedMenus,
} from "../widgets/test-helpers.js";
import "./till-table-order-screen.js";
import "../widgets/adjustment-dialog.js";
import type {
  AdjustDetail,
  TableServiceStatus,
  TillTableOrderScreen,
} from "./till-table-order-screen.js";
import type { TillAdjustmentDialog } from "../widgets/adjustment-dialog.js";
import type {
  OfferedModifier,
  OrderGroup,
  TabLine,
  TableParty,
  TableState,
  TillProduct,
  TillZoneMenu,
  PartyBill,
  AdjustmentReason,
} from "../api/client.js";
import type { TillMenuBrowser } from "../widgets/menu-browser.js";
import type { TillModifierPicker } from "../widgets/modifier-picker.js";

const products: TillProduct[] = [
  {
    id: "cafe",
    menuItemId: "offer-cafe",
    catalogueId: "menu-carta",
    name: "Café",
    customerName: { es: "Café para el cliente" },
    pricingUnit: "each",
    unitPrice: "1.50",
    vatClass: "general",
    category: null,
    allergens: null,
    // A default course so the round-course picker pre-selects it.
    courseId: "c1",
  },
];

const menus: TillZoneMenu[] = servedMenus(
  [{ id: "menu-carta", name: "Carta", isDefault: true, versionId: "v1" }],
  [{ id: "offer-cafe", menuId: "menu-carta", productId: "cafe" }],
);

const mistake: AdjustmentReason = {
  id: "error",
  name: "Error",
  actions: ["cancel"],
  noteRequired: false,
  maxPercentBp: null,
  maxAmount: null,
  applyRole: "staff",
  approverRole: "staff",
};

const lines: TabLine[] = [
  {
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
    // Held (fired_at null) with its ticket item already inserted, so `state` is "queued", not null.
    courseId: "c1",
    sentAt: null,
    firedAt: null,
    state: "queued",
    note: null,
    listId: null,
    menuItemId: null,
    parentProductId: null,
  },
  {
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
    courseId: "c1",
    sentAt: null,
    firedAt: null,
    state: "queued",
    note: null,
    listId: null,
    menuItemId: null,
    parentProductId: null,
  },
];

const courses = [{ id: "c1", name: "Entrantes", displayOrder: 0 }];

const statuses: TableServiceStatus[] = [{ id: "s1", label: "Reservada", color: "#cc0000" }];

const weightProduct: TillProduct = {
  ...products[0]!,
  id: "jamon",
  name: "Jamón",
  customerName: { es: "Jamón para el cliente" },
  pricingUnit: "weight",
};

const party: TableParty = {
  id: "v1",
  revision: 2,
  guestCount: 3,
  state: "open",
  name: "Ana",
  displayName: "Ana",
  mainBillId: "wo-2",
  outstanding: "30.00",
  billCount: 2,
  tableIds: ["t4"],
  unsentDrafts: [],
  reminder: null,
};

const partyBills: PartyBill[] = [
  {
    workingOrderId: "wo-1",
    revision: 0,
    invoiceType: "F2",
    recipient: null,
    partyId: "v1",
    label: null,
    status: "settled",
    total: "14.00",
    outstanding: "0.00",
    hasPayments: false,
    receiptAvailable: true,
  },
  {
    workingOrderId: "wo-2",
    revision: 0,
    invoiceType: "F2",
    recipient: null,
    partyId: "v1",
    label: null,
    status: "open",
    total: "30.00",
    outstanding: "30.00",
    hasPayments: false,
    receiptAvailable: false,
  },
];

afterEach(cleanupWidgets);

/** Below the side-by-side width, as in Vitest's default frame, the draft is on its Review view. */
async function openReview(el: TillTableOrderScreen): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>("[data-review-open]")!.click();
  await el.updateComplete;
}

describe.each(["light", "dark"] as const)("till-table-order-screen a11y (%s theme)", (theme) => {
  it("has no violations with the round grid, the per-line course picker and the open tab drawer", async () => {
    const { el, host } = await mountWidget<TillTableOrderScreen>(
      "till-table-order-screen",
      { products, menus, lines, statuses, courses, fireControl: "waiter", orderId: "wo-1" },
      theme,
    );
    // Ring a café into the current round so the per-line COURSE PICKER renders and is scanned.
    el.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!
      .shadowRoot!.querySelector<HTMLElement>("wt-button.tile")!
      .click();
    // Open the drawer so the full subtree — the Servido ticks, tab total, the reused
    // pay widget and the status picker — is included in the scan, not just the grid.
    el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await el.updateComplete;
    await openReview(el);
    // The reused basket re-renders on its OWN store subscription (a separate Lit update cycle), and its
    // freshly-created remove `wt-button`s render their inner focusable `<button>` on a following tick — so
    // let the nested widgets fully settle before axe runs, or it scans a half-upgraded control.
    await el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "till-basket",
    )!.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations with a child extras row in the drawer", async () => {
    // The child row is painted muted and a size down from its dish, so its contrast against the
    // drawer surface is its own state — the scan above, which has no child row, cannot see it.
    const childLine: TabLine = {
      stationId: null,
      movable: false,
      id: "line-3",
      groupId: null,
      lineNo: 3,
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
    const { el, host } = await mountWidget<TillTableOrderScreen>(
      "till-table-order-screen",
      { products, lines: [...lines, childLine], statuses, courses, orderId: "wo-1" },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  describe("changing and cancelling a sent line", () => {
    const sentLine: TabLine = {
      ...lines[0]!,
      lineNo: 5,
      name: "Café",
      courseId: null,
      sentAt: "2026-08-20T09:59:00.000Z",
      firedAt: "2026-08-20T09:59:00.000Z",
      note: "sin azúcar",
      menuItemId: null,
    };
    const cookedList: OfferedModifier = {
      kind: "options",
      id: "list-cooked",
      name: "Punto",
      customerName: { es: "Punto carta" },
      kitchenName: "Punto KDS",
      defaultLabelId: null,
      labels: [
        {
          id: "label-rare",
          name: "Poco hecha",
          customerName: { es: "Poco hecha carta" },
          kitchenName: "Poco hecha KDS",
          available: true,
        },
      ],
    };
    const extrasList: OfferedModifier = {
      kind: "extras",
      id: "list-extras",
      name: "Extras",
      customerName: { es: "Extras carta" },
      kitchenName: "Extras KDS",
      minPicks: 0,
      maxPicks: null,
      items: [
        {
          portion: "1",
          unit: {
            name: { en: "Each", es: "Unidad", ca: "Unitat", eu: "Unitatea", gl: "Unidade" },
            hardwareUnit: null,
            id: "00000000-0000-0000-0000-000000000001",
            abbreviation: { en: "ea", es: "ud", ca: "u", eu: "u", gl: "u" },
            precision: 0,
          },
          productId: "p-cheese",
          name: "Queso",
          customerName: { es: "Queso carta" },
          kitchenName: "Queso KDS",
          price: "1.00",
          vatClass: "general",
          maxQuantity: 3,
          preselected: false,
          addAllergens: null,
          suitableFor: [],
        },
      ],
    };

    async function mountDrawer(lineList: TabLine[], dishes: TillProduct[] = products) {
      const mounted = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        { products: dishes, lines: lineList, orderId: "wo-1", revision: 4 },
        theme,
      );
      mounted.el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
      await mounted.el.updateComplete;
      return mounted;
    }

    async function settle(el: TillTableOrderScreen): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
    }

    it("has no violations on a line offering Change, Recall and Cancel with its note shown", async () => {
      const { el, host } = await mountDrawer([sentLine]);
      await settle(el);
      await expectNoA11yViolations(host);
    });

    it("has no violations in the open Change editor", async () => {
      const dish: TillProduct = { ...products[0]!, offeredModifiers: [cookedList, extrasList] };
      const { el, host } = await mountDrawer([sentLine], [dish]);
      el.shadowRoot!.querySelector<HTMLElement>('[data-change-line="5"]')!.click();
      await el.updateComplete;
      await el.shadowRoot!.querySelector<TillModifierPicker>("till-modifier-picker")!
        .updateComplete;
      await settle(el);
      await expectNoA11yViolations(host);
    });

    it("has no violations in the dialog asking how many to cancel", async () => {
      const { el } = await mountDrawer([sentLine]);
      let asked: AdjustDetail | undefined;
      el.addEventListener("adjust", (e) => (asked = (e as CustomEvent<AdjustDetail>).detail));
      el.shadowRoot!.querySelector<HTMLElement>('[data-cancel-line="5"]')!.click();
      // The app opens the dialog on what the screen asked for.
      const { el: dialog, host } = await mountWidget<TillAdjustmentDialog>(
        "till-adjustment-dialog",
        { kind: asked!.kind, target: asked!.target, reasons: [mistake] },
        theme,
      );
      expect(dialog.shadowRoot!.querySelector("[data-quantity]")).not.toBeNull();
      dialog.shadowRoot!.querySelector<HTMLElement>('input[name="quantity"][value="1"]')!.click();
      await dialog.updateComplete;
      await expectNoA11yViolations(host);
    });
  });

  it.each([false, true])(
    "has no violations in the party's bills with Finish refused: %s",
    async (finishRefused) => {
      const { el, host } = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        {
          products,
          lines: [],
          statuses,
          orderId: "wo-1",
          party: party,
          bills: partyBills,
          finishRefused,
        },
        theme,
      );
      el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
      await el.updateComplete;
      await expectNoA11yViolations(host);
    },
  );

  it("has no violations in the party's bills with the bill requested", async () => {
    const asked: TableState = {
      id: "t4",
      label: "Mesa 4",
      zoneId: null,
      capacity: null,
      state: "open-tab",
      condition: "held",
      hasOpenTab: true,
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
      party,
      signals: [{ kind: "bill_requested", requestedAt: "2026-09-30T20:00:00.000Z" }],
    };
    const { el, host } = await mountWidget<TillTableOrderScreen>(
      "till-table-order-screen",
      { products, lines: [], statuses, orderId: "wo-1", party, bills: partyBills, tables: [asked] },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-cancel-bill-request]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  describe("the draft's actions", () => {
    /** Rings two cafés, checks the first when `select` is set, and lets the nested widgets settle. */
    async function withDraft(over: Partial<TillTableOrderScreen>, select: boolean) {
      const mounted = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        { products, menus, lines: [], statuses, courses, orderId: "wo-1", ...over },
        theme,
      );
      const { el } = mounted;
      const store = el.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!.store;
      store.addProduct(products[0]!, "1");
      store.addProduct(products[0]!, "2");
      await el.updateComplete;
      if (select) {
        el.shadowRoot!.querySelector<HTMLElement>('[data-draft-select="0"]')!.click();
        await el.updateComplete;
      }
      await el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
        "till-basket",
      )!.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      return mounted;
    }

    it("has no violations in the action bar, with nothing and with a line checked", async () => {
      const { el, host } = await withDraft({}, false);
      await openReview(el);
      await expectNoA11yViolations(host);
      cleanupWidgets();
      const selected = await withDraft({}, true);
      await openReview(selected.el);
      await expectNoA11yViolations(selected.host);
    });

    it("has no violations in the preview dialog", async () => {
      const { el, host } = await withDraft({}, true);
      el.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="fire-selected"]')!.click();
      await el.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      await expectNoA11yViolations(host);
    });

    it("has no violations in the preview's Send to choice", async () => {
      const { el, host } = await withDraft(
        {
          party,
          bills: [
            ...partyBills,
            { ...partyBills[1]!, workingOrderId: "wo-3", total: "8.00", outstanding: "8.00" },
          ],
        },
        false,
      );
      el.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="fire-all"]')!.click();
      await el.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      if (el.shadowRoot!.querySelector("[data-send-to]") === null)
        throw new Error("the scan must include the Send to choice");
      await expectNoA11yViolations(host);
    });

    it("has no violations in a later addition's destination and held-group picker", async () => {
      const group = (id: string, position: number, state: OrderGroup["state"]): OrderGroup => ({
        id,
        position,
        state,
        firedAt: state === "fired" ? "2026-08-20T09:59:00.000Z" : null,
        remindAt: null,
        lineIds: [],
        summary: `${position} × Café`,
      });
      const { el, host } = await withDraft(
        { groups: [group("g1", 1, "fired"), group("g2", 2, "held"), group("g3", 3, "held")] },
        false,
      );
      el.shadowRoot!.querySelector<HTMLElement>('[data-destination="add-to-held"]')!.click();
      await el.updateComplete;
      await openReview(el);
      await expectNoA11yViolations(host);
    });
  });

  describe("the party's groups", () => {
    const group = (
      id: string,
      position: number,
      state: OrderGroup["state"],
      lineIds: string[],
    ): OrderGroup => ({
      id,
      position,
      state,
      firedAt: state === "fired" ? "2026-08-20T09:59:00.000Z" : null,
      remindAt: null,
      lineIds,
      summary: `${position} × Café`,
    });
    const groupLines: TabLine[] = [
      { ...lines[0]!, groupId: "g2" },
      {
        ...lines[1]!,
        id: "line-3",
        lineNo: 3,
        servedAt: null,
        groupId: "g1",
        sentAt: "2026-08-20T09:59:00.000Z",
        firedAt: "2026-08-20T09:59:00.000Z",
      },
      { ...lines[1]!, id: "line-4", lineNo: 4, servedAt: null, groupId: "g3" },
    ];
    const groups = [
      group("g1", 1, "fired", ["line-3"]),
      group("g2", 2, "held", ["line-1"]),
      group("g3", 3, "held", ["line-4"]),
    ];

    async function withGroups() {
      const mounted = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        {
          products,
          menus,
          lines: groupLines,
          groups,
          statuses,
          courses,
          fireControl: "waiter",
          orderId: "wo-1",
        },
        theme,
      );
      mounted.el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
      await mounted.el.updateComplete;
      return mounted;
    }

    async function press(el: TillTableOrderScreen, selector: string): Promise<void> {
      el.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
      await el.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
    }

    it("has no violations in the list, a fired group and held ones with every control", async () => {
      const { el, host } = await withGroups();
      if (el.shadowRoot!.querySelector("[data-split-group-line]") === null)
        throw new Error("the scan must include Split quantity");
      await expectNoA11yViolations(host);
    });

    it("has no violations in the Move to… picker", async () => {
      const { el, host } = await withGroups();
      await press(el, '[data-move-line="line-1"]');
      await expectNoA11yViolations(host);
    });

    it("has no violations in the Fire confirmation", async () => {
      const { el, host } = await withGroups();
      await press(el, '[data-group-fire="g2"]');
      await expectNoA11yViolations(host);
    });

    it("has no violations with a ready group and the printing-problem notice", async () => {
      const { el, host } = await withGroups();
      el.groups = [{ ...groups[0]!, ready: true }, ...groups.slice(1)];
      el.printProblems = [
        {
          workingOrderId: "wo-1",
          stationId: "st-1",
          stationName: "Cocina",
          since: "2026-08-20T09:59:00.000Z",
        },
      ];
      await el.updateComplete;
      if (el.shadowRoot!.querySelector("[data-print-problem-reprint]") === null)
        throw new Error("the scan must include the printing-problem Reprint");
      await expectNoA11yViolations(host);
    });

    it("has no violations with one bill sent to print again and another still to reprint", async () => {
      const { el, host } = await withGroups();
      el.printProblems = [
        {
          workingOrderId: "wo-1",
          stationId: "st-1",
          stationName: "Cocina",
          since: "2026-08-20T09:59:00.000Z",
        },
        {
          workingOrderId: "wo-2",
          stationId: "st-2",
          stationName: "Barra",
          since: "2026-08-20T10:00:00.000Z",
        },
      ];
      el.reprintSent = ["wo-1"];
      await el.updateComplete;
      if (
        el.shadowRoot!.querySelector("[data-print-problem-sent]") === null ||
        el.shadowRoot!.querySelector("[data-print-problem-reprint]") === null
      )
        throw new Error("the scan must include both the sent line and Reprint");
      await expectNoA11yViolations(host);
    });
  });

  it("has no violations with a partly paid bill on screen, saying to take the rest as a bill payment", async () => {
    const { el, host } = await mountWidget<TillTableOrderScreen>(
      "till-table-order-screen",
      {
        products,
        lines,
        statuses,
        orderId: "wo-2",
        party,
        bills: [partyBills[0]!, { ...partyBills[1]!, outstanding: "10.00", hasPayments: true }],
      },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await el.updateComplete;
    if (el.shadowRoot!.querySelector("[data-bill-payments]") === null)
      throw new Error("the scan must include the bill-payments sentence");
    await expectNoA11yViolations(host);
  });

  it("has no violations in the merge picker listing the party's other bills", async () => {
    const { el, host } = await mountWidget<TillTableOrderScreen>(
      "till-table-order-screen",
      {
        products,
        lines,
        statuses,
        orderId: "wo-2",
        party,
        bills: [
          ...partyBills,
          { ...partyBills[1]!, workingOrderId: "wo-3", total: "8.00", outstanding: "8.00" },
        ],
      },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-move-split]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>('[data-action="merge"]')!.click();
    await el.updateComplete;
    if (el.shadowRoot!.querySelector('[data-target="wo-3"]') === null)
      throw new Error("the scan must include a bill to merge");
    await expectNoA11yViolations(host);
  });

  it("has no violations in the transfer picker and in the items it offers to transfer", async () => {
    const { el, host } = await mountWidget<TillTableOrderScreen>(
      "till-table-order-screen",
      {
        products,
        lines,
        statuses,
        orderId: "wo-2",
        party,
        bills: [
          ...partyBills,
          { ...partyBills[1]!, workingOrderId: "wo-3", total: "8.00", outstanding: "8.00" },
        ],
      },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-move-split]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>('[data-action="transfer"]')!.click();
    await el.updateComplete;
    const target = el.shadowRoot!.querySelector<HTMLElement>('[data-target="wo-3"]');
    if (target === null) throw new Error("the scan must include a bill to transfer to");
    await expectNoA11yViolations(host);

    target.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>('[data-transfer-line="1"]')!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  describe("the table actions", () => {
    const tableRow = (id: string, label: string, over: Partial<TableState> = {}): TableState => ({
      id,
      label,
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
      signals: [],
      party: null,
      ...over,
    });
    const ana: TableParty = { ...party, tableIds: ["t4", "t5"] };
    const luis: TableParty = {
      ...party,
      id: "v7",
      name: "Luis",
      displayName: "Luis",
      tableIds: ["t7"],
    };
    const tables = [
      tableRow("t4", "Mesa 4", { state: "open-tab", condition: "held", party: ana }),
      tableRow("t5", "Mesa 5", { state: "open-tab", condition: "held", party: ana }),
      tableRow("t7", "Mesa 7", { state: "open-tab", condition: "held", party: luis }),
      tableRow("t6", "Mesa 6", { condition: "needs_clearing" }),
      tableRow("t9", "Mesa 9"),
    ];

    async function toAction(action: string, orderId = "wo-1") {
      const mounted = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        { products, lines, statuses, orderId, party: ana, bills: partyBills, tables },
        theme,
      );
      const { el } = mounted;
      el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>("[data-move-split]")!.click();
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>(`[data-action="${action}"]`)!.click();
      await el.updateComplete;
      return mounted;
    }

    it("has no violations in the table list, with a free, a seated and a disabled table needing clearing", async () => {
      const { el, host } = await toAction("move");
      if (el.shadowRoot!.querySelector('[data-target-reason="t6"]') === null)
        throw new Error("the scan must include the table needing clearing");
      await expectNoA11yViolations(host);
    });

    it("has no violations in the bill choice over the table screen", async () => {
      const { el, host } = await toAction("move");
      el.shadowRoot!.querySelector<HTMLElement>('[data-target="t7"]')!.click();
      await el.updateComplete;
      const dialog = el.shadowRoot!.querySelector<
        HTMLElement & { updateComplete: Promise<unknown> }
      >("till-bill-choice-dialog");
      if (dialog === null) throw new Error("the scan must include the bill choice");
      await dialog.updateComplete;
      await expectNoA11yViolations(host);
    });

    it("has no violations in Move this bill's list, with the counter, a free, a seated and a disabled table", async () => {
      const { el, host } = await toAction("move-bill", "wo-2");
      if (el.shadowRoot!.querySelector('[data-target="counter"]') === null)
        throw new Error("the scan must include the counter");
      if (el.shadowRoot!.querySelector('[data-target-reason="t6"]') === null)
        throw new Error("the scan must include the table needing clearing");
      await expectNoA11yViolations(host);
    });

    it("has no violations in the bill choice for a bill moving to a seated table", async () => {
      const { el, host } = await toAction("move-bill", "wo-2");
      el.shadowRoot!.querySelector<HTMLElement>('[data-target="t7"]')!.click();
      await el.updateComplete;
      const dialog = el.shadowRoot!.querySelector<
        HTMLElement & { updateComplete: Promise<unknown> }
      >("till-bill-choice-dialog");
      if (dialog === null) throw new Error("the scan must include the bill choice");
      await dialog.updateComplete;
      await expectNoA11yViolations(host);
    });

    it("has no violations in Split a table's choice of bill", async () => {
      const { el, host } = await toAction("split-table");
      el.shadowRoot!.querySelector<HTMLElement>('[data-target="t5"]')!.click();
      await el.updateComplete;
      if (el.shadowRoot!.querySelector('[data-target="none"]') === null)
        throw new Error("the scan must include the bills to choose from");
      await expectNoA11yViolations(host);
    });
  });

  it("has no violations in the split quantity picker", async () => {
    const splitLines: TabLine[] = [
      { ...lines[0]!, quantity: "4.000" },
      { ...lines[1]!, lineNo: 2, productId: "jamon", quantity: "0.750", unitPrecision: 3 },
    ];
    const { el, host } = await mountWidget<TillTableOrderScreen>(
      "till-table-order-screen",
      { products: [...products, weightProduct], lines: splitLines, orderId: "wo-1" },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-move-split]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>('[data-action="split"]')!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>('[data-split-line="1"]')!.click();
    el.shadowRoot!.querySelector<HTMLElement>('[data-split-line="2"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations with a bad split quantity refused", async () => {
    const splitLines: TabLine[] = [
      { ...lines[0]!, productId: "jamon", quantity: "0.750", unitPrecision: 3 },
    ];
    const { el, host } = await mountWidget<TillTableOrderScreen>(
      "till-table-order-screen",
      { products: [...products, weightProduct], lines: splitLines, orderId: "wo-1" },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-move-split]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>('[data-action="split"]')!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>('[data-split-line="1"]')!.click();
    await el.updateComplete;
    const field = el.shadowRoot!.querySelector<HTMLElement & { error: string }>(
      '[data-split-quantity="1"]',
    )!;
    const input = field.shadowRoot!.querySelector("input")!;
    input.value = "0";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-split-confirm]")!.click();
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    const actions = el.shadowRoot!.querySelector<
      HTMLElement & { error: string; updateComplete: Promise<unknown> }
    >("[data-split-lines] wt-form-actions")!;
    await actions.updateComplete;
    expect(actions.error).toBe(t("form.fix_fields"));
    expect(field.error).not.toBe("");
    await expectNoA11yViolations(host);
  });
});

describe.each(["light", "dark"] as const)(
  "till-table-order-screen a11y: the draft on a phone (%s theme)",
  (theme) => {
    /** A 390 px screen with a café rung three times, split, and the course picker shown. */
    async function phoneDraft() {
      const mounted = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        { products, menus, lines: [], statuses, courses, orderId: "wo-1" },
        theme,
      );
      const { el, host } = mounted;
      host.style.width = "390px";
      for (let frame = 0; frame < 2; frame++)
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      const store = el.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!.store;
      store.addProduct(products[0]!, "3", { note: "sin azúcar" });
      store.addProduct(products[0]!, "1");
      await el.updateComplete;
      return mounted;
    }

    async function settled(el: TillTableOrderScreen): Promise<void> {
      for (const basket of el.shadowRoot!.querySelectorAll<
        HTMLElement & { updateComplete: Promise<unknown> }
      >("till-basket"))
        await basket.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
    }

    it("has no violations while browsing, with the last-added bar and Review", async () => {
      const { el, host } = await phoneDraft();
      await settled(el);
      if (!el.shadowRoot!.querySelector("[data-last-added]")?.checkVisibility())
        throw new Error("the scan must include the last-added bar");
      await expectNoA11yViolations(host);
    });

    it("has no violations on the Review view, with Split quantity offered", async () => {
      const { el, host } = await phoneDraft();
      el.shadowRoot!.querySelector<HTMLElement>("[data-review-open]")!.click();
      await el.updateComplete;
      await settled(el);
      if (!el.shadowRoot!.querySelector("[data-split-draft-line]")?.checkVisibility())
        throw new Error("the scan must include the Review view's lines");
      await expectNoA11yViolations(host);
    });
  },
);
