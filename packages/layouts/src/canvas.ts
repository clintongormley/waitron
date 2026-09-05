// packages/layouts/src/canvas.ts
/**
 * Canonical types for the layout-CANVAS model (design §4): a canvas is a dashboard for one form
 * factor — 1+ tabs, each tab a grid, every screen a card. The dashboard + till keep bundle-decoupled
 * local copies of these shapes.
 */

/** The device form factors a canvas can target (design §4.1 — form factor is the sizing guardrail). */
export const FORM_FACTORS = ["till", "phone-portrait", "tablet-landscape", "kds"] as const;
export type FormFactor = (typeof FORM_FACTORS)[number];

/**
 * The card catalogue — the single source of truth for placeable card kinds. "Big" cards fill a tab
 * (floor-plan, kds-board, expo, table-order, table-layout-editor); "small" cards share a grid. Adding
 * a card is a one-line change here + a contract in card-contract.ts.
 */
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

/**
 * Server-enforced device-capability flags a device profile may carry (design §5, layer 2) —
 * generalising the hardcoded assertNotHandheld firewall. Capabilities live on the device profile
 * (`device-profile.ts`), not the canvas; enforcement is `assertDeviceCapability` (apps/server).
 */
export const CAPABILITY_FLAGS = [
  "integrated-card-payment",
  "open-cash-drawer",
  "act-as-kds",
] as const;
export type CapabilityFlag = (typeof CAPABILITY_FLAGS)[number];

/** One placed card in a tab's grid. `colSpan`/`rowSpan` size it (HA Sections model, design §4.1). */
export interface CardInstance {
  type: CardType;
  colSpan: number;
  rowSpan: number;
  config: Record<string, unknown>;
  /**
   * Runtime-visibility states (design §6 axis 3) that make this card render, a SUBSET of the card
   * type's declared `visibilityStates`. Absent or empty ⇒ always render.
   */
  visibleWhen?: string[];
}

/** A tab: a titled grid of a fixed `columns` count holding placed cards (design §4.1). */
export interface TabDef {
  key: string;
  title: string;
  columns: number;
  cards: CardInstance[];
}

/** A theme override: allowlisted `--wt-*` token → value (design §9). */
export interface ThemeOverride {
  tokens: Record<string, string>;
}

/**
 * A whole layout canvas (design §4.1): a form factor, its tabs, an optional theme. Capabilities NO
 * LONGER live here — they relocated onto the device profile (device-profile design 2026-09-05 §5.3,
 * Task 9): a canvas is the DISPLAY, capabilities are facts about the BOX, resolved through the profile.
 */
export interface CanvasDef {
  formFactor: FormFactor;
  tabs: TabDef[];
  theme?: ThemeOverride;
}
