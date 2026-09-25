import { afterEach, describe, expect, it } from "vitest";
import { WorkingOrderStore } from "../state/working-order.js";
import type { TabDef } from "../layout.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./card-grid.js";
import type { TillCardGrid } from "./card-grid.js";
import type { HeldOrderSummary, StationQueueGroup } from "../api/client.js";

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
  openedAt: "2026-08-05T10:00:00.000Z",
};

const barra: HeldOrderSummary = {
  id: "wo-2",
  orderNumber: 6,
  label: null,
  itemCount: 1,
  total: "1.50",
  openedAt: "2026-08-05T10:05:00.000Z",
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
    expect(el.shadowRoot!.querySelector("till-product-grid")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("till-basket")).not.toBeNull();
    const productCell = el.shadowRoot!.querySelector<HTMLElement>(".cell:has(till-product-grid)")!;
    expect(productCell.style.gridColumn).toBe("span 8");
    expect(productCell.style.gridRow).toBe("span 6");
  });

  it("threads the SAME store into every store-backed card", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: counterTab, store });
    const grid = el.shadowRoot!.querySelector<HTMLElement & { store: unknown }>(
      "till-product-grid",
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
      "till-product-grid",
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

  it("leaves product-grid columns undefined when the config carries no numeric columns", async () => {
    const store = new WorkingOrderStore();
    const noColsTab: TabDef = {
      key: "counter",
      title: "Counter",
      columns: 12,
      cards: [{ type: "product-grid", colSpan: 8, rowSpan: 6, config: {} }],
    };
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: noColsTab, store });
    const grid = el.shadowRoot!.querySelector<HTMLElement & { columns?: number }>(
      "till-product-grid",
    )!;
    expect(grid.columns).toBeUndefined();
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
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", {
      tab: orderTab,
      selectedDiet: "vegetarian",
      store,
    });
    const to = el.shadowRoot!.querySelector<
      HTMLElement & { embedded?: boolean; selectedDiet?: string | null }
    >("till-table-order-screen")!;
    expect(to).not.toBeNull();
    expect(to.embedded).toBe(true);
    expect(to.selectedDiet).toBe("vegetarian");
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
