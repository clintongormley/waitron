import { afterEach, describe, it } from "vitest";
import {
  cleanupWidgets,
  expectNoA11yViolations,
  mountWidget,
  servedMenus,
} from "../widgets/test-helpers.js";
import "./till-table-order-screen.js";
import type { TableServiceStatus, TillTableOrderScreen } from "./till-table-order-screen.js";
import type {
  OfferedModifier,
  TabLine,
  TableVisit,
  TillProduct,
  TillZoneMenu,
  VisitBill,
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

const lines: TabLine[] = [
  {
    groupId: null,
    lineNo: 1,
    productId: "cafe",
    quantity: "2.000",
    unitPrecision: 0,
    unitPriceGross: "1.50",
    servedAt: null,
    // A HELD course (fired_at null) so the waiter-fire section is in the a11y scan under `waiter`. Held
    // still means the round-send already inserted its ticket item (fireLines does this for every parent
    // line, fired or held), so `state` is the fresh-insert "queued", not null.
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

const party: TableVisit = {
  id: "v1",
  revision: 2,
  guestCount: 3,
  state: "open",
  outstanding: "30.00",
  billCount: 2,
  tableIds: ["t4"],
};

const partyBills: VisitBill[] = [
  {
    workingOrderId: "wo-1",
    visitId: "v1",
    label: null,
    status: "settled",
    total: "14.00",
    outstanding: "0.00",
    receiptAvailable: true,
  },
  {
    workingOrderId: "wo-2",
    visitId: "v1",
    label: null,
    status: "open",
    total: "30.00",
    outstanding: "30.00",
    receiptAvailable: false,
  },
];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-table-order-screen a11y (%s theme)", (theme) => {
  it("has no violations with the round grid, the per-line course picker, the open tab drawer and the waiter-fire actions", async () => {
    const { el, host } = await mountWidget<TillTableOrderScreen>(
      "till-table-order-screen",
      { products, menus, lines, statuses, courses, fireControl: "waiter", orderId: "wo-1" },
      theme,
    );
    // Ring a café into the current round so the per-line COURSE PICKER renders and is scanned.
    el.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!
      .shadowRoot!.querySelector<HTMLElement>("wt-button.tile")!
      .click();
    // Open the drawer so the full subtree — the waiter-fire actions, Servido ticks, tab total, the reused
    // pay widget and the status picker — is included in the scan, not just the grid.
    el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await el.updateComplete;
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
      const { el, host } = await mountDrawer([sentLine]);
      el.shadowRoot!.querySelector<HTMLElement>('[data-cancel-line="5"]')!.click();
      await el.updateComplete;
      await settle(el);
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
          visit: party,
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
});
