import type { WidgetType } from "./types.js";

/**
 * A single config-value validator: returns true iff `value` is acceptable for its key. It receives
 * `unknown` and must narrow defensively — never assume a type — so a hostile config bag cannot slip a
 * wrong-typed value past it (fail-closed, design D8).
 */
export type ConfigValidator = (value: unknown) => boolean;

/** The allowed config keys for one widget, each mapped to its value validator. */
export type WidgetConfigSchema = Record<string, ConfigValidator>;

/** Accepts an integer in [min, max] inclusive; rejects non-numbers, non-integers and out-of-range. */
function intInRange(min: number, max: number): ConfigValidator {
  return (value) =>
    typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * The per-widget config registry — the ONE tested place that defines what a config bag may contain
 * (design §5, D8). Slice 1 wires exactly one key: `product-grid.columns`, an integer in 1..12 (a
 * fixed grid column count). Every other widget declares an EMPTY schema, so ANY key on it is rejected
 * by `validateLayout`. The `Record<WidgetType, …>` type makes forgetting a widget a compile error.
 */
export const WIDGET_CONFIG: Record<WidgetType, WidgetConfigSchema> = {
  "product-grid": { columns: intInRange(1, 12) },
  basket: {},
  total: {},
  "tender-pay": {},
  "held-orders": {},
  "prep-queue": {},
};
