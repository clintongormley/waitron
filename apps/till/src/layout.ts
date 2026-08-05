/**
 * The counter screen's LAYOUT DEFINITION — the configurable-dashboard seam (spec §3).
 *
 * A layout is plain DATA: an ordered list of widget instances, each naming its widget `type`, the
 * `region` it sits in (`"main"` or `"aside"`), and a per-widget `config` bag. `till-counter-screen`
 * renders a layout by ITERATING it and mapping each `type` to its element — so the arrangement is
 * data, not code. That is what lets a later slice's drag/drop editor and per-widget config plug in
 * HERE, by producing a different `LayoutDef`, without the screen changing. Slice 1 ships exactly one
 * fixed layout, {@link LAYOUT_A}; keep this module plain data (no Lit, no elements) so it stays the
 * seam and not a second place the widgets are wired.
 */

/** The widgets the counter can place. Each maps to one custom element in the screen's registry. */
export type WidgetType = "product-grid" | "basket" | "total" | "tender-pay";

/** One placed widget: which widget, which region it sits in, and its (slice-1-empty) config bag. */
export interface WidgetInstance {
  type: WidgetType;
  region: "main" | "aside";
  config: Record<string, unknown>;
}

/** A whole layout: the ordered widget instances the screen renders, in order, into their regions. */
export type LayoutDef = WidgetInstance[];

/**
 * Layout A — the walk-up-sale arrangement slice 1 ships: the product grid fills `main` (the left),
 * with the basket, total and pay flow stacked in `aside` (the right).
 */
export const LAYOUT_A: LayoutDef = [
  { type: "product-grid", region: "main", config: {} },
  { type: "basket", region: "aside", config: {} },
  { type: "total", region: "aside", config: {} },
  { type: "tender-pay", region: "aside", config: {} },
];
