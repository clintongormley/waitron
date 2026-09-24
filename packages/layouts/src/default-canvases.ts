import type { FormFactor, CanvasDef } from "./canvas.js";

/**
 * What `getCanvasForFormFactor` returns when no canvas of that form factor is stored. Spans are
 * sized to each tab's own grid, not copied from CARD_CONTRACTS' defaults.
 */
const TILL: CanvasDef = {
  formFactor: "till",
  tabs: [
    {
      key: "counter",
      title: "Counter",
      columns: 12,
      cards: [
        { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
        { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
        { type: "total", colSpan: 4, rowSpan: 1, config: {} },
        { type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} },
        { type: "held-orders", colSpan: 8, rowSpan: 2, config: {}, visibleWhen: ["has-parked"] },
      ],
    },
    {
      key: "floor",
      title: "Floor",
      columns: 24,
      cards: [{ type: "floor-plan", colSpan: 24, rowSpan: 12, config: {} }],
    },
  ],
};

const PHONE: CanvasDef = {
  formFactor: "phone-portrait",
  tabs: [
    {
      key: "floor",
      title: "Floor",
      columns: 4,
      cards: [{ type: "floor-plan", colSpan: 4, rowSpan: 12, config: {} }],
    },
    {
      key: "order",
      title: "Order",
      columns: 4,
      cards: [{ type: "table-order", colSpan: 4, rowSpan: 12, config: {} }],
    },
  ],
};

const TABLET: CanvasDef = {
  formFactor: "tablet-landscape",
  tabs: [
    {
      key: "floor",
      title: "Floor",
      columns: 12,
      cards: [{ type: "floor-plan", colSpan: 12, rowSpan: 12, config: {} }],
    },
    {
      key: "order",
      title: "Order",
      columns: 12,
      cards: [{ type: "table-order", colSpan: 12, rowSpan: 12, config: {} }],
    },
  ],
};

const KDS: CanvasDef = {
  formFactor: "kds",
  tabs: [
    {
      key: "kitchen",
      title: "Kitchen",
      columns: 24,
      cards: [{ type: "kds-board", colSpan: 24, rowSpan: 12, config: {} }],
    },
  ],
};

export const DEFAULT_CANVASES: Record<FormFactor, CanvasDef> = {
  till: TILL,
  "phone-portrait": PHONE,
  "tablet-landscape": TABLET,
  kds: KDS,
};
