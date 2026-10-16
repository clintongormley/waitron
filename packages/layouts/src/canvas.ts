import type { FormFactor } from "./device-types.js";
import type { ThemeOverride } from "./theme.js";

export const CARD_TYPES = [
  "product-grid",
  "basket",
  "total",
  "tender-pay",
  "held-orders",
  "prep-queue",
  "notifications",
  "floor-plan",
  "kds-board",
  "expo",
  "table-order",
] as const;
export type CardType = (typeof CARD_TYPES)[number];

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

export interface CanvasDef {
  formFactor: FormFactor;
  tabs: TabDef[];
  theme?: ThemeOverride;
}
