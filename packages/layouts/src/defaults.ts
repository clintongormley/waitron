import type { LayoutDef, ReceiptConfig } from "./types.js";

/**
 * The built-in default layout — a verbatim copy of the till's current `LAYOUT_A`
 * (`apps/till/src/layout.ts:47-54`): the product grid fills `main`, with the basket, total, pay flow,
 * held-orders list and prep queue stacked in `aside`. `getLayout` (Task 5) returns this for a tenant
 * that has never authored one (design §5).
 */
export const DEFAULT_LAYOUT: LayoutDef = [
  { type: "product-grid", region: "main", config: {} },
  { type: "basket", region: "aside", config: {} },
  { type: "total", region: "aside", config: {} },
  { type: "tender-pay", region: "aside", config: {} },
  { type: "held-orders", region: "aside", config: {} },
  { type: "prep-queue", region: "aside", config: {} },
];

/** The default receipt trim — empty (no header subtitle, no footer message). */
export const DEFAULT_RECEIPT: ReceiptConfig = {};
