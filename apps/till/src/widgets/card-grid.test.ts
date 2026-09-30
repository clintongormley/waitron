import { afterEach, describe, expect, it } from "vitest";
import { WorkingOrderStore } from "../state/working-order.js";
import type { TabDef } from "../layout.js";
import { cleanupWidgets, mountWidget, servedMenus } from "./test-helpers.js";
import "./card-grid.js";
import type { TillCardGrid } from "./card-grid.js";
import type { TillMenuBrowser } from "./menu-browser.js";
import type {
  DietProfile,
  HeldOrderSummary,
  StationQueueGroup,
  TableState,
  TillProduct,
  TillZoneMenu,
} from "../api/client.js";

afterEach(cleanupWidgets);

const counterTab: TabDef = {
  key: "counter",
  title: "Counter",
  columns: 12,
  cards: [
    { type: "product-grid", colSpan: 8, rowSpan: 6, config: { columns: 4 } },
    { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
    { type: "total", colSpan: 4, rowSpan: 1, config: {} },
    { type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} },
  ],
};

const mesa: HeldOrderSummary = {
  id: "wo-1",
  orderNumber: 5,
  label: "Mesa 4",
  itemCount: 2,
  total: "3.00",
  outstanding: "3.00",
  hasPayments: false,
  partyId: null,
  openedAt: "2026-08-05T10:00:00.000Z",
  signals: [],
};

const barra: HeldOrderSummary = {
  id: "wo-2",
  orderNumber: 6,
  label: null,
  itemCount: 1,
  total: "1.50",
  outstanding: "1.50",
  hasPayments: false,
  partyId: null,
  openedAt: "2026-08-05T10:05:00.000Z",
  signals: [],
};

const stationGroup: StationQueueGroup = {
  orderId: "wo-1",
  orderNumber: 5,
  label: "Mesa 4",
  queuedAt: "2026-08-17T10:00:00.000Z",
  status: "placed",
  thresholds: { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
  items: [
    {
      id: "ti-1",
      workingOrderLineId: "wol-1",
      state: "queued",
      name: "Paella",
      quantity: "2.000",
      course: null,
      firedAt: "2026-08-17T10:00:00.000Z",
    },
  ],
};

const heldTab: TabDef = {
  key: "counter",
  title: "Counter",
  columns: 12,
  cards: [{ type: "held-orders", colSpan: 8, rowSpan: 2, config: {}, visibleWhen: ["has-parked"] }],
};

const prepTab: TabDef = {
  key: "counter",
  title: "Counter",
  columns: 12,
  cards: [{ type: "prep-queue", colSpan: 6, rowSpan: 3, config: {}, visibleWhen: ["has-items"] }],
};

const floorTab: TabDef = {
  key: "floor",
  title: "Floor",
  columns: 12,
  cards: [{ type: "floor-plan", colSpan: 12, rowSpan: 8, config: {} }],
};

const editorTab: TabDef = {
  key: "editor",
  title: "Editor",
  columns: 12,
  cards: [{ type: "table-layout-editor", colSpan: 12, rowSpan: 8, config: {} }],
};

const expoTab: TabDef = {
  key: "expo",
  title: "Expo",
  columns: 12,
  cards: [{ type: "expo", colSpan: 12, rowSpan: 8, config: {} }],
};

const orderTab: TabDef = {
  key: "order",
  title: "Order",
  columns: 12,
  cards: [{ type: "table-order", colSpan: 12, rowSpan: 12, config: {} }],
};

// A big card whose data-condition state the host CANNOT compute, but which carries a visibleWhen gate.
const gatedBigCard: TabDef = {
  key: "expo",
  title: "Expo",
  columns: 12,
  cards: [{ type: "expo", colSpan: 12, rowSpan: 8, config: {}, visibleWhen: ["has-tickets"] }],
};

describe("till-card-grid", () => {
  it("renders each card element in a spanning cell on a fluid grid", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: counterTab, store });
    const grid = el.shadowRoot!.querySelector<HTMLElement>(".grid")!;
    expect(grid.style.gridTemplateColumns).toBe("repeat(12, 1fr)");
    expect(el.shadowRoot!.querySelector("till-menu-browser")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("till-basket")).not.toBeNull();
    const productCell = el.shadowRoot!.querySelector<HTMLElement>(".cell:has(till-menu-browser)")!;
    expect(productCell.style.gridColumn).toBe("span 8");
    expect(productCell.style.gridRow).toBe("span 6");
  });

  it("threads the SAME store into every store-backed card", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: counterTab, store });
    const grid = el.shadowRoot!.querySelector<HTMLElement & { store: unknown }>(
      "till-menu-browser",
    )!;
    const basket = el.shadowRoot!.querySelector<HTMLElement & { store: unknown }>("till-basket")!;
    const pay = el.shadowRoot!.querySelector<HTMLElement & { store: unknown }>("till-tender-pay")!;
    expect(grid.store).toBe(store);
    expect(basket.store).toBe(store);
    expect(pay.store).toBe(store);
  });

  it("threads the product-grid columns config", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: counterTab, store });
    const grid = el.shadowRoot!.querySelector<HTMLElement & { columns?: number }>(
      "till-menu-browser",
    )!;
    expect(grid.columns).toBe(4);
  });

  it("renders nothing when no tab is set", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", { store });
    expect(el.shadowRoot!.querySelector(".grid")).toBeNull();
  });

  it("hides a held-orders card gated on has-parked when there are none", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", {
      tab: heldTab,
      store,
      heldOrders: [],
    });
    expect(el.shadowRoot!.querySelector("till-held-orders")).toBeNull();
  });

  it("shows a held-orders card gated on has-parked when some exist", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", {
      tab: heldTab,
      store,
      heldOrders: [mesa],
    });
    expect(el.shadowRoot!.querySelector("till-held-orders")).not.toBeNull();
  });

  it("gives the held-orders card the floor's tables, which its Move to table lists", async () => {
    const store = new WorkingOrderStore();
    const tables = [{ id: "t9", label: "Mesa 9" }] as unknown as TableState[];
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", {
      tab: heldTab,
      store,
      heldOrders: [mesa],
      tables,
    });
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { tables: unknown }>("till-held-orders")!.tables,
    ).toBe(tables);
  });

  it("lets a held-orders retrieve event bubble through the grid host", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", {
      tab: heldTab,
      store,
      heldOrders: [barra],
    });
    let captured: CustomEvent<{ id: string }> | undefined;
    el.addEventListener("retrieve-order", (e) => (captured = e as CustomEvent<{ id: string }>));
    el.shadowRoot!.querySelector("till-held-orders")!
      .shadowRoot!.querySelector<HTMLElement>("wt-button.retrieve")!
      .click();
    expect(captured?.composed).toBe(true);
    expect(captured?.detail).toEqual({ id: "wo-2" });
  });

  it("renders the prep-queue card as a rail with the default station id", async () => {
    const store = new WorkingOrderStore();
    const prepTab: TabDef = {
      key: "counter",
      title: "Counter",
      columns: 12,
      cards: [{ type: "prep-queue", colSpan: 6, rowSpan: 3, config: {} }],
    };
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", {
      tab: prepTab,
      store,
      stationQueue: [],
      defaultStationId: "station-1",
    });
    const queue = el.shadowRoot!.querySelector<HTMLElement & { view?: string; stationId?: string }>(
      "till-station-queue",
    )!;
    expect(queue).not.toBeNull();
    expect(queue.view).toBe("rail");
    expect(queue.stationId).toBe("station-1");
  });

  it("hides a prep-queue card gated on has-items when the queue is empty", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", {
      tab: prepTab,
      store,
      stationQueue: [],
    });
    expect(el.shadowRoot!.querySelector("till-station-queue")).toBeNull();
  });

  it("shows a prep-queue card gated on has-items when the queue has items", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", {
      tab: prepTab,
      store,
      stationQueue: [stationGroup],
    });
    expect(el.shadowRoot!.querySelector("till-station-queue")).not.toBeNull();
  });

  it("still skips notifications (later), rendering no cell for it", async () => {
    const store = new WorkingOrderStore();
    const bigTab: TabDef = {
      key: "counter",
      title: "Counter",
      columns: 12,
      cards: [
        { type: "notifications", colSpan: 4, rowSpan: 1, config: {} },
        { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
      ],
    };
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: bigTab, store });
    expect(el.shadowRoot!.querySelector("till-basket")).not.toBeNull();
    expect(el.shadowRoot!.querySelectorAll(".cell")).toHaveLength(1);
  });

  it("renders an embedded floor screen for a floor-plan card", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", {
      tab: floorTab,
      store,
      zones: [],
      tables: [],
    });
    const floor = el.shadowRoot!.querySelector<
      HTMLElement & { embedded?: boolean; canEdit?: boolean }
    >("till-floor-screen")!;
    expect(floor).not.toBeNull();
    expect(floor.embedded).toBe(true);
    expect(floor.canEdit).toBe(false);
  });

  it("tells the floor whether the device can open a station's view", async () => {
    const store = new WorkingOrderStore();
    const floorOf = async (canOpenStation?: boolean) => {
      const { el } = await mountWidget<TillCardGrid>("till-card-grid", {
        tab: floorTab,
        store,
        ...(canOpenStation === undefined ? {} : { canOpenStation }),
      });
      return el.shadowRoot!.querySelector<HTMLElement & { canOpenStation?: boolean }>(
        "till-floor-screen",
      )!.canOpenStation;
    };
    expect(await floorOf(true)).toBe(true);
    expect(await floorOf(false)).toBe(false);
    expect(await floorOf()).toBe(false);
  });

  it("renders an embedded editable floor screen for a table-layout-editor card", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", {
      tab: editorTab,
      store,
      zones: [],
      tables: [],
    });
    const floor = el.shadowRoot!.querySelector<
      HTMLElement & { embedded?: boolean; canEdit?: boolean }
    >("till-floor-screen")!;
    expect(floor).not.toBeNull();
    expect(floor.embedded).toBe(true);
    expect(floor.canEdit).toBe(true);
  });

  it("locks a permission-gated card when the operator lacks the permission", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", {
      tab: editorTab,
      store,
      canConfigureTill: false,
    });
    const cell = el.shadowRoot!.querySelector<HTMLElement>(".cell.locked")!;
    expect(cell).not.toBeNull();
    expect(cell.hasAttribute("inert")).toBe(true);
    expect(cell.getAttribute("aria-disabled")).toBe("true");
  });

  it("unlocks a permission-gated card when the operator has the permission", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", {
      tab: editorTab,
      store,
      canConfigureTill: true,
    });
    expect(el.shadowRoot!.querySelector(".cell.locked")).toBeNull();
    expect(el.shadowRoot!.querySelector("till-floor-screen")).not.toBeNull();
  });

  it("renders an embedded expo screen for an expo card", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: expoTab, store });
    const expo = el.shadowRoot!.querySelector<HTMLElement & { embedded?: boolean }>(
      "till-expo-screen",
    )!;
    expect(expo?.embedded).toBe(true);
  });

  it("renders an embedded table-order screen for a table-order card", async () => {
    const store = new WorkingOrderStore();
    const groups = [
      {
        id: "g-1",
        position: 1,
        state: "held" as const,
        firedAt: null,
        remindAt: null,
        lineIds: [],
        summary: "",
      },
    ];
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", {
      tab: orderTab,
      selectedDiet: "vegetarian",
      tabGroups: groups,
      store,
    });
    const to = el.shadowRoot!.querySelector<
      HTMLElement & { embedded?: boolean; selectedDiet?: string | null; groups?: unknown }
    >("till-table-order-screen")!;
    expect(to).not.toBeNull();
    expect(to.embedded).toBe(true);
    expect(to.selectedDiet).toBe("vegetarian");
    expect(to.groups).toBe(groups);
  });

  it("shows a big card with a visibleWhen gate the host cannot evaluate (fail open, follow-up d)", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: gatedBigCard, store });
    expect(el.shadowRoot!.querySelectorAll(".cell").length).toBe(1);
    expect(el.shadowRoot!.querySelector("till-expo-screen")).not.toBeNull();
  });

  it("ALWAYS renders tender-pay even without integrated-card-payment (cash path, sale-critical)", async () => {
    const store = new WorkingOrderStore();
    // tender-pay requires integrated-card-payment, but it takes cash, so it renders regardless.
    const payTab: TabDef = {
      key: "counter",
      title: "Counter",
      columns: 12,
      cards: [{ type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} }],
    };
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", {
      tab: payTab,
      store,
      capabilities: [],
    });
    expect(el.shadowRoot!.querySelector("till-tender-pay")).not.toBeNull();
  });

  it("never WIDENS access: the advisory gate is MONOTONIC — more caps ⇒ a superset of cards (SP-B2.1 follow-up c)", async () => {
    const store = new WorkingOrderStore();
    const mixed: TabDef = {
      key: "x",
      title: "X",
      columns: 12,
      cards: [
        { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
        { type: "kds-board", colSpan: 12, rowSpan: 6, config: {} },
      ],
    };
    const absent = await mountWidget<TillCardGrid>("till-card-grid", {
      tab: mixed,
      store,
      capabilities: [],
    });
    expect(absent.el.shadowRoot!.querySelectorAll(".cell")).toHaveLength(1);
    expect(absent.el.shadowRoot!.querySelector("till-basket")).not.toBeNull();
    expect(absent.el.shadowRoot!.querySelector("till-station-screen")).toBeNull();
    const present = await mountWidget<TillCardGrid>("till-card-grid", {
      tab: mixed,
      store,
      capabilities: ["act-as-kds"],
    });
    expect(present.el.shadowRoot!.querySelectorAll(".cell")).toHaveLength(2);
    expect(present.el.shadowRoot!.querySelector("till-basket")).not.toBeNull();
    expect(present.el.shadowRoot!.querySelector("till-station-screen")).not.toBeNull();
  });

  it("skips a capability-gated card when the capability is absent", async () => {
    const store = new WorkingOrderStore();
    const kdsTab: TabDef = {
      key: "x",
      title: "X",
      columns: 12,
      cards: [
        { type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} },
        { type: "kds-board", colSpan: 12, rowSpan: 6, config: {} },
      ],
    };
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", {
      tab: kdsTab,
      store,
      capabilities: [],
    });
    expect(el.shadowRoot!.querySelector("till-station-screen")).toBeNull();
  });

  it("renders a capability-gated card when the capability is present", async () => {
    const store = new WorkingOrderStore();
    const kdsTab: TabDef = {
      key: "x",
      title: "X",
      columns: 12,
      cards: [
        { type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} },
        { type: "kds-board", colSpan: 12, rowSpan: 6, config: {} },
      ],
    };
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", {
      tab: kdsTab,
      store,
      capabilities: ["act-as-kds"],
    });
    expect(el.shadowRoot!.querySelector("till-station-screen")).not.toBeNull();
  });

  it("proves the capability skip by deletion: kds-board absent without act-as-kds, present with it", async () => {
    const store = new WorkingOrderStore();
    const tab: TabDef = {
      key: "k",
      title: "K",
      columns: 12,
      cards: [{ type: "kds-board", colSpan: 12, rowSpan: 6, config: {} }],
    };
    const absent = await mountWidget<TillCardGrid>("till-card-grid", {
      tab,
      store,
      capabilities: [],
    });
    expect(absent.el.shadowRoot!.querySelector("till-station-screen")).toBeNull();
    const present = await mountWidget<TillCardGrid>("till-card-grid", {
      tab,
      store,
      capabilities: ["act-as-kds"],
    });
    expect(present.el.shadowRoot!.querySelector("till-station-screen")).not.toBeNull();
  });

  it("passes a visibleWhen gate OPEN for a card type with no data-condition mapping (follow-up d)", async () => {
    const store = new WorkingOrderStore();
    const gatedBasketTab: TabDef = {
      key: "counter",
      title: "Counter",
      columns: 12,
      cards: [{ type: "basket", colSpan: 4, rowSpan: 4, config: {}, visibleWhen: ["whatever"] }],
    };
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", {
      tab: gatedBasketTab,
      store,
    });
    expect(el.shadowRoot!.querySelector("till-basket")).not.toBeNull();
  });

  it("STILL hides a card whose host-COMPUTED state is out of the visibleWhen list (fail-open is undefined-only)", async () => {
    const store = new WorkingOrderStore();
    // Fail-open covers only a state the host cannot compute: `heldOrders: []` computes "empty", which
    // is not in the gate, so the card stays hidden.
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", {
      tab: heldTab,
      store,
      heldOrders: [],
    });
    expect(el.shadowRoot!.querySelector("till-held-orders")).toBeNull();
  });
});

function dish(key: string, name: string, menuId: string, extra: Partial<TillProduct> = {}) {
  return {
    id: `p-${key}`,
    productId: `p-${key}`,
    menuItemId: `mi-${menuId}-${key}`,
    catalogueId: menuId,
    available: true,
    name,
    unitPrice: "2.00",
    vatClass: "general",
    category: null,
    allergens: null,
    ...extra,
  } satisfies TillProduct;
}

const vegan: DietProfile = { vegan: "yes", vegetarian: "yes", contains: [] };
const meaty: DietProfile = { vegan: "no", vegetarian: "no", contains: ["meat"] };

const salad = dish("salad", "Salad", "lunch", { diet: vegan });
const steak = dish("steak", "Steak", "lunch", { diet: meaty });
const wine = dish("wine", "Wine", "drinks", { diet: vegan });
const beer = dish("beer", "Beer", "drinks", { diet: vegan });

/** Each menu has a layout of shortcuts to both its dishes; `chosen` picks it over the default. */
function served(id: string, products: TillProduct[], chosen: boolean, isDefault = false) {
  // The meat dish sits alone in its own section, so a lens that hides it empties the section.
  const [first, second] = products.map((each) => ({
    id: each.menuItemId!,
    menuId: id,
    productId: each.productId!,
  }));
  const menu = { id, name: id, isDefault, versionId: `${id}-v1` };
  return servedMenus(
    [chosen ? { ...menu, homeLayoutId: `${id}-shortcuts` } : menu],
    [first!, { ...second!, section: `${id} mains` }],
    { shortcuts: true },
  )[0]! satisfies TillZoneMenu;
}

const lunchMenu = served("lunch", [salad, steak], true, true);
const drinksMenu = served("drinks", [wine, beer], false);

const productCard = (config: Record<string, unknown> = {}): TabDef => ({
  key: "sell",
  title: "Sell",
  columns: 12,
  cards: [{ type: "product-grid", colSpan: 12, rowSpan: 6, config }],
});

async function mountBrowser(props: Partial<TillCardGrid> = {}) {
  const { el } = await mountWidget<TillCardGrid>("till-card-grid", {
    tab: productCard(),
    store: new WorkingOrderStore(),
    menus: [lunchMenu, drinksMenu],
    products: [salad, steak, wine, beer],
    selectedMenuId: "lunch",
    ...props,
  });
  const browser = () => el.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!;
  await browser().updateComplete;
  return { el, browser };
}

function shownNames(browser: TillMenuBrowser, region: string): string[] {
  return [
    ...browser.shadowRoot!.querySelectorAll(`[data-region="${region}"] wt-button[data-kind] .name`),
  ].map((name) => name.textContent!.trim());
}

describe("till-card-grid's product-grid card: the menu browser", () => {
  it("shows the selected menu, only that menu's products, and hands it the store", async () => {
    const store = new WorkingOrderStore();
    const { browser } = await mountBrowser({ store });
    expect(browser().menu).toBe(lunchMenu);
    expect(browser().products).toEqual([salad, steak]);
    expect(browser().store).toBe(store);
    expect(shownNames(browser(), "shortcuts")).toEqual(["Salad", "Steak"]);
  });

  it("switching menus shows the other menu with its own home layout", async () => {
    const { el, browser } = await mountBrowser();
    el.selectedMenuId = "drinks";
    await el.updateComplete;
    await browser().updateComplete;
    expect(browser().menu).toBe(drinksMenu);
    expect(browser().products).toEqual([wine, beer]);
    // Drinks' device layout is its default, which holds no shortcuts.
    expect(shownNames(browser(), "shortcuts")).toEqual([]);
    expect(shownNames(browser(), "structure")).toEqual(["Wine", "drinks mains"]);
  });

  it("shows the zone's default menu when the selected one is not among the menus", async () => {
    // Listed second, so the first menu is not mistaken for the default.
    const { browser } = await mountBrowser({
      menus: [drinksMenu, lunchMenu],
      selectedMenuId: "gone",
    });
    expect(browser().menu).toBe(lunchMenu);
    expect(browser().products).toEqual([salad, steak]);
  });

  it("uses six columns on a till and three on a handheld when the card sets none", async () => {
    const { el, browser } = await mountBrowser();
    expect(browser().columns).toBe(6);
    el.handheld = true;
    await el.updateComplete;
    expect(browser().columns).toBe(3);
  });

  it("lets the card's own column count win on either form factor", async () => {
    const { el, browser } = await mountBrowser({ tab: productCard({ columns: 4 }) });
    expect(browser().columns).toBe(4);
    el.handheld = true;
    await el.updateComplete;
    expect(browser().columns).toBe(4);
  });

  it("hides a product the diet lens rejects, and a section it leaves with nothing", async () => {
    const { browser } = await mountBrowser({ selectedDiet: "vegan" });
    expect(browser().products).toEqual([salad]);
    expect(shownNames(browser(), "structure")).toEqual(["Salad"]);
  });

  it("hands the browser the same products while nothing it reads changes", async () => {
    const { el, browser } = await mountBrowser();
    const first = browser().products;
    el.busy = true;
    await el.updateComplete;
    expect(browser().products).toBe(first);
  });
});
