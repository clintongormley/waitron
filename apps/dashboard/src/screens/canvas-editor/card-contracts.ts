// card-contracts.ts — a dashboard-LOCAL mirror of @waitron/layouts' card contract data (the browser
// bundle rule forbids a runtime @waitron/layouts import — its barrel drags @waitron/db). Kept honest by
// card-contracts.parity.test.ts, which deep-imports the pure source and asserts equality. The server's
// validateCanvas stays authoritative on every write; this mirror only powers the editor's palette,
// property panel and the light client validator (validate-canvas.ts).
export const CARD_TYPES = [
  "product-grid",
  "basket",
  "total",
  "tender-pay",
  "held-orders",
  "prep-queue",
  "notifications",
  "floor-plan",
  "table-layout-editor",
  "kds-board",
  "expo",
  "table-order",
] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const CAPABILITY_FLAGS = [
  "integrated-card-payment",
  "open-cash-drawer",
  "act-as-kds",
] as const;
export type CapabilityFlag = (typeof CAPABILITY_FLAGS)[number];

export const FORM_FACTORS = ["till", "phone-portrait", "tablet-landscape", "kds"] as const;
export type FormFactor = (typeof FORM_FACTORS)[number];

export const GRID_MAX_COLUMNS = 24;
export const MAX_TAB_TITLE_LENGTH = 60;

/** The editor-facing slice of a card's contract (validators stay server-side; only field NAMES here). */
export interface CardContractMirror {
  defaultColSpan: number;
  defaultRowSpan: number;
  visibilityStates: readonly string[];
  requiredPermission?: string;
  requiredCapability?: CapabilityFlag;
  saleCritical: boolean;
  configFields: readonly string[];
}

export const CARD_CONTRACTS: Record<CardType, CardContractMirror> = {
  "product-grid": {
    defaultColSpan: 8,
    defaultRowSpan: 6,
    visibilityStates: [],
    saleCritical: true,
    configFields: ["columns"],
  },
  basket: {
    defaultColSpan: 4,
    defaultRowSpan: 4,
    visibilityStates: [],
    saleCritical: true,
    configFields: [],
  },
  total: {
    defaultColSpan: 4,
    defaultRowSpan: 1,
    visibilityStates: [],
    saleCritical: true,
    configFields: [],
  },
  "tender-pay": {
    defaultColSpan: 4,
    defaultRowSpan: 2,
    requiredCapability: "integrated-card-payment",
    visibilityStates: [],
    saleCritical: true,
    configFields: [],
  },
  "held-orders": {
    defaultColSpan: 4,
    defaultRowSpan: 2,
    visibilityStates: ["has-parked", "empty"],
    saleCritical: false,
    configFields: [],
  },
  "prep-queue": {
    defaultColSpan: 4,
    defaultRowSpan: 2,
    visibilityStates: ["has-items", "empty"],
    saleCritical: false,
    configFields: [],
  },
  notifications: {
    defaultColSpan: 4,
    defaultRowSpan: 1,
    visibilityStates: ["unread", "any", "empty"],
    saleCritical: false,
    configFields: [],
  },
  "floor-plan": {
    defaultColSpan: 24,
    defaultRowSpan: 12,
    visibilityStates: [],
    saleCritical: false,
    configFields: [],
  },
  "table-layout-editor": {
    defaultColSpan: 24,
    defaultRowSpan: 12,
    requiredPermission: "till.configure",
    visibilityStates: [],
    saleCritical: false,
    configFields: [],
  },
  "kds-board": {
    defaultColSpan: 24,
    defaultRowSpan: 12,
    requiredCapability: "act-as-kds",
    visibilityStates: ["has-tickets", "idle"],
    saleCritical: false,
    configFields: [],
  },
  expo: {
    defaultColSpan: 24,
    defaultRowSpan: 12,
    visibilityStates: ["has-tickets", "idle"],
    saleCritical: false,
    configFields: [],
  },
  "table-order": {
    defaultColSpan: 24,
    defaultRowSpan: 12,
    visibilityStates: [],
    saleCritical: false,
    configFields: [],
  },
};

export const SALE_CRITICAL_CARDS: readonly CardType[] = (
  Object.keys(CARD_CONTRACTS) as CardType[]
).filter((t) => CARD_CONTRACTS[t].saleCritical);

/** One placed card (dashboard-local mirror of @waitron/layouts' CardInstance). */
export interface CardInstance {
  type: CardType;
  colSpan: number;
  rowSpan: number;
  config: Record<string, unknown>;
  visibleWhen?: string[];
}
/** A tab: a titled grid of cards (mirror of TabDef). */
export interface TabDef {
  key: string;
  title: string;
  columns: number;
  cards: CardInstance[];
}
/** A whole canvas (mirror of CanvasDef). */
export interface CanvasDef {
  formFactor: FormFactor;
  tabs: TabDef[];
  capabilities: CapabilityFlag[];
  theme?: { tokens: Record<string, string> };
}

// The built-in default canvases (design §4.3) — a dashboard-LOCAL copy of
// `packages/layouts/src/default-canvases.ts`, one profile per form factor, that a NEW canvas seeds
// from (`structuredClone(DEFAULT_CANVASES[ff])`) when the operator picks a form factor in the Crear
// dialog. It lives here rather than being runtime-imported for the same reason the rest of this file
// does — `@waitron/layouts`' barrel drags `@waitron/db` into the browser bundle — and is kept honest
// by card-contracts.parity.test.ts, which deep-imports the pure source and asserts deep equality.
const TILL: CanvasDef = {
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

const PHONE: CanvasDef = {
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

const TABLET: CanvasDef = {
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

const KDS: CanvasDef = {
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

export const DEFAULT_CANVASES: Record<FormFactor, CanvasDef> = {
  till: TILL,
  "phone-portrait": PHONE,
  "tablet-landscape": TABLET,
  kds: KDS,
};
