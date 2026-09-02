// packages/layouts/src/default-profiles.ts
import type { FormFactor, ProfileDef } from "./profile.js";

/**
 * Built-in default profiles (design §4.3) — the "return-a-default-when-unauthored" precedent from the
 * old getLayout, one per form factor. A venue starts from / copies one; the later store slice returns
 * these when a device's profile is unauthored. Spans are sized to each tab's own grid, not copied from
 * CARD_CONTRACTS' defaults: a tab holding one big card (floor-plan, table-order) gives it the tab's
 * full width, while the till's counter tab splits its columns among several cards sharing the row.
 */
const TILL: ProfileDef = {
  formFactor: "till",
  capabilities: ["integrated-card-payment", "open-cash-drawer"],
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

const PHONE: ProfileDef = {
  formFactor: "phone-portrait",
  capabilities: [],
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

const TABLET: ProfileDef = {
  formFactor: "tablet-landscape",
  capabilities: [],
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

const KDS: ProfileDef = {
  formFactor: "kds",
  capabilities: ["act-as-kds"],
  tabs: [
    {
      key: "kitchen",
      title: "Kitchen",
      columns: 24,
      cards: [{ type: "kds-board", colSpan: 24, rowSpan: 12, config: {} }],
    },
  ],
};

export const DEFAULT_PROFILES: Record<FormFactor, ProfileDef> = {
  till: TILL,
  "phone-portrait": PHONE,
  "tablet-landscape": TABLET,
  kds: KDS,
};
