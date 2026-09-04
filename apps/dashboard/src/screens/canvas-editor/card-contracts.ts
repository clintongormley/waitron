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
