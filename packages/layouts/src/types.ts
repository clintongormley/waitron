/**
 * Canonical layout types for @waitron/layouts — the SERVER-SIDE source of truth for a till's widget
 * arrangement and its receipt trim. The till (`apps/till/src/layout.ts`) and the dashboard keep their
 * own LOCAL copies of these shapes, bundle-decoupled, exactly as `apps/till/src/api/client.ts`
 * explains for every server shape; this package is where validation and defaults live.
 *
 * These mirror the six widgets and the `WidgetInstance` shape the counter screen already renders from
 * data — `apps/till/src/layout.ts:14-25` (design §1).
 */

/**
 * The widgets the counter can place, one per custom element in the till screen's registry. This tuple
 * is the single source of truth: {@link WidgetType} is derived from it, so adding a widget is a
 * one-line change here. Matches `apps/till/src/layout.ts:14-15` verbatim.
 */
export const WIDGET_TYPES = [
  "product-grid",
  "basket",
  "total",
  "tender-pay",
  "held-orders",
  "prep-queue",
] as const;

/** One of the six widget kinds. */
export type WidgetType = (typeof WIDGET_TYPES)[number];

/** The two regions a widget may sit in on the counter screen. */
export type Region = "main" | "aside";

/** One placed widget: which widget, which region it sits in, and its per-widget `config` bag. */
export interface WidgetInstance {
  type: WidgetType;
  region: Region;
  config: Record<string, unknown>;
}

/** A whole layout: the ordered widget instances the screen renders, in order, into their regions. */
export type LayoutDef = WidgetInstance[];

/**
 * The authorable, NON-FISCAL receipt trim (design §7/§8). Both optional; each a short string rendered
 * AROUND the immutable art. 7.1 core, never able to touch it: `headerSubtitle` under the venue name,
 * `footerMessage` under the VERI*FACTU legend. No field here can suppress or reorder a mandated
 * element — that is the fiscal-safety constraint the receipt editor is built on.
 */
export interface ReceiptConfig {
  headerSubtitle?: string;
  footerMessage?: string;
}
