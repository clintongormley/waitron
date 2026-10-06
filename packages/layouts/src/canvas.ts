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

/** Carried by a device profile, not a canvas. Each flag is either a {@link ProfileAction}, which
 * the server checks on the operation itself, or a {@link ProfileScreen}, which only decides what the
 * till shows. Showing a screen never permits an action on it. */
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
] as const;
export type CapabilityFlag = (typeof CAPABILITY_FLAGS)[number];

/** What a profile lets its device do (`profileAllows`; the server's `assertProfileAction`). */
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
export type ProfileAction = (typeof PROFILE_ACTIONS)[number];

/** What a profile's till offers to look at. `act-as-kds` shows the kitchen board card. */
export const PROFILE_SCREENS = [
  "act-as-kds",
  "show-station",
  "show-expo",
  "show-schedule",
] as const satisfies readonly CapabilityFlag[];
export type ProfileScreen = (typeof PROFILE_SCREENS)[number];

/** The screens the till can open on its own, so the ones a profile may start on. */
export const NAVIGATION_SCREENS = [
  "show-station",
  "show-expo",
  "show-schedule",
] as const satisfies readonly ProfileScreen[];
export type NavigationScreen = (typeof NAVIGATION_SCREENS)[number];

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
