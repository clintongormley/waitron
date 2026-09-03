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

// A valid HeldOrderSummary — the shape held-orders.test.ts uses (id/orderNumber/label/itemCount/
// total(string)/openedAt), NOT the brief's inline sketch. The renderer keys visibility on the list
// length, not the shape, but the held-orders widget itself reads these fields.
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

// A minimal valid StationQueueGroup — one queued line at one station (shape from station-queue.test.ts).
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
      descriptions: { "es-ES": "Paella" },
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

// A big card whose data-condition state the host CANNOT compute (`#currentState("expo")` is
// undefined), but which carries a visibleWhen gate. Under B1 this was hidden (fail closed); SP-B2.1
// follow-up d fails it OPEN so a self-fetching big card never silently vanishes.
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

  it("still skips notifications, kds-board and table-order (B2.2/later), rendering no cell for them", async () => {
    const store = new WorkingOrderStore();
    // floor-plan / table-layout-editor / expo now RENDER (SP-B2.1, tested below); the three types
    // that still return `nothing` arrive in B2.2/later, so a tab carrying them shows only the basket.
    const bigTab: TabDef = {
      key: "counter",
      title: "Counter",
      columns: 12,
      cards: [
        { type: "notifications", colSpan: 4, rowSpan: 1, config: {} },
        { type: "kds-board", colSpan: 6, rowSpan: 4, config: {} },
        { type: "table-order", colSpan: 6, rowSpan: 4, config: {} },
        { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
      ],
    };
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: bigTab, store });
    // Only the basket card renders; every still-skipped card yields no cell at all.
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
    // A plain floor-plan card is the read-only floor — no edit affordance.
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
    // The cell still renders — visible, just unlocked.
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

  it("shows a big card with a visibleWhen gate the host cannot evaluate (fail open, follow-up d)", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", { tab: gatedBigCard, store });
    // expo renders `till-expo-screen` (Task 5); `#currentState("expo")` is undefined, so the gate
    // cannot be evaluated — fail open means the CELL is present (not filtered out).
    expect(el.shadowRoot!.querySelectorAll(".cell").length).toBe(1);
    expect(el.shadowRoot!.querySelector("till-expo-screen")).not.toBeNull();
  });

  it("ALWAYS renders tender-pay even without integrated-card-payment (cash path, sale-critical)", async () => {
    const store = new WorkingOrderStore();
    // tender-pay carries a required capability (integrated-card-payment) in CARD_REQUIRED_CAPABILITY,
    // but it takes cash and is sale-critical, so the grid renders it regardless of capabilities.
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

  // capability-skip visible test lands in B2.2 when kds-board renders. Until then kds-board renders
  // `nothing` in card-grid, so a capability-SKIP is not observable via till-station-screen here.
  it.skip("skips a capability-gated card when the capability is absent", async () => {
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

  // capability-skip visible test lands in B2.2 when kds-board renders.
  it.skip("renders a capability-gated card when the capability is present", async () => {
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

  it("passes a visibleWhen gate OPEN for a card type with no data-condition mapping (follow-up d)", async () => {
    const store = new WorkingOrderStore();
    // `basket` has no data-condition state (`#currentState → undefined`), so the host cannot evaluate
    // a visibleWhen gate on it. SP-B2.1 follow-up d fails such a card OPEN — it renders rather than
    // silently vanishing (B1 hid it, fail closed).
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
    // Regression that fail-open only opens the `#currentState → undefined` branch, never the
    // computed-but-mismatched one: held-orders' state IS computable — `heldOrders: []` yields "empty",
    // which is NOT in the gate, so the card stays HIDDEN exactly as under B1.
    const { el } = await mountWidget<TillCardGrid>("till-card-grid", {
      tab: heldTab,
      store,
      heldOrders: [],
    });
    expect(el.shadowRoot!.querySelector("till-held-orders")).toBeNull();
  });
});
