// A dashboard-local mirror of @waitron/layouts' card contract data: that barrel pulls @waitron/db into
// the browser bundle. card-contracts.parity.test.ts compares it with the source. The server's
// validateCanvas stays authoritative on every write.
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
  "print-receipt",
  "show-station",
  "show-expo",
  "show-schedule",
  "take-cash",
  "take-orders",
  "hand-keyed-card-payment",
  "prepare-orders",
  "hand-over-orders",
  "run-the-pass",
] as const;
export type CapabilityFlag = (typeof CAPABILITY_FLAGS)[number];

export const PROFILE_ACTIONS = [
  "take-orders",
  "take-cash",
  "integrated-card-payment",
  "hand-keyed-card-payment",
  "prepare-orders",
  "hand-over-orders",
  "print-receipt",
  "open-cash-drawer",
] as const satisfies readonly CapabilityFlag[];

export const PROFILE_SCREENS = [
  "act-as-kds",
  "show-station",
  "show-expo",
  "show-schedule",
  "run-the-pass",
] as const satisfies readonly CapabilityFlag[];

/** The screens a profile may start on. */
export const NAVIGATION_SCREENS = [
  "show-station",
  "show-expo",
  "show-schedule",
] as const satisfies readonly CapabilityFlag[];

export const FORM_FACTORS = ["till", "phone-portrait", "tablet-landscape", "kds"] as const;
export type FormFactor = (typeof FORM_FACTORS)[number];

/** A `kds` profile is a shared display: nobody signs in on it. */
export function isSharedDisplay(formFactor: FormFactor): boolean {
  return formFactor === "kds";
}

/** The actions a shared display can be given: every other one needs a named person signed in. */
const SHARED_DISPLAY_ACTIONS: readonly CapabilityFlag[] = [
  "prepare-orders",
  "take-orders",
  "hand-over-orders",
];

/** Whether a shared display may hold `flag`: any screen, and only its own actions. */
export function sharedDisplayMay(flag: CapabilityFlag): boolean {
  return (
    !(PROFILE_ACTIONS as readonly CapabilityFlag[]).includes(flag) ||
    SHARED_DISPLAY_ACTIONS.includes(flag)
  );
}

/** Form factors that must place every sale-critical card. */
export const SELLING_FORM_FACTORS: readonly FormFactor[] = ["till"];

export const GRID_MAX_COLUMNS = 24;
export const MAX_TAB_TITLE_LENGTH = 60;

/** The px meaning of a card's `rowSpan` in the INTERACTIVE editor grid. Dashboard-local, with no
 * `@waitron/layouts` counterpart, so no parity check. */
export const EDITOR_ROW_HEIGHT = 48;

/** Not a parity constant: the source inlines its `1..12`, so no parity check. */
export const PRODUCT_GRID_MAX_COLUMNS = 12;

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
    requiredPermission: "venue.configure",
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

export interface CardInstance {
  type: CardType;
  colSpan: number;
  rowSpan: number;
  config: Record<string, unknown>;
  visibleWhen?: string[];
}
export interface TabDef {
  key: string;
  title: string;
  columns: number;
  cards: CardInstance[];
}
export interface CanvasDef {
  formFactor: FormFactor;
  tabs: TabDef[];
  theme?: { tokens: Record<string, string> };
}

// The built-in default canvases a new canvas seeds from: a copy of
// `packages/layouts/src/default-canvases.ts`, compared by card-contracts.parity.test.ts.
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
