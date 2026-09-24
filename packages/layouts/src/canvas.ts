// `apps/till/src/layout.ts` and the dashboard keep their own copies of these shapes.

export const FORM_FACTORS = ["till", "phone-portrait", "tablet-landscape", "kds"] as const;
export type FormFactor = (typeof FORM_FACTORS)[number];

export type DeviceKind = "kds_station" | "handheld" | "till";

export function kindOfFormFactor(ff: FormFactor): DeviceKind {
  const kinds = {
    till: "till",
    "phone-portrait": "handheld",
    "tablet-landscape": "handheld",
    kds: "kds_station",
  } satisfies Record<FormFactor, DeviceKind>;
  return kinds[ff];
}

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

/** Carried by a device profile, not a canvas. Enforced by `assertDeviceCapability`, apps/server. */
export const CAPABILITY_FLAGS = [
  "integrated-card-payment",
  "open-cash-drawer",
  "act-as-kds",
  "print-receipt",
] as const;
export type CapabilityFlag = (typeof CAPABILITY_FLAGS)[number];

export interface CardInstance {
  type: CardType;
  colSpan: number;
  rowSpan: number;
  config: Record<string, unknown>;
  /** States that make this card render, a subset of its contract's `visibilityStates`. Absent or
   * empty means always render. */
  visibleWhen?: string[];
}

export interface TabDef {
  key: string;
  title: string;
  columns: number;
  cards: CardInstance[];
}

export interface ThemeOverride {
  tokens: Record<string, string>;
}

export interface CanvasDef {
  formFactor: FormFactor;
  tabs: TabDef[];
  theme?: ThemeOverride;
}
