// The price and quantity shapes a catalogue write refuses. Imports nothing, so the dashboard can
// apply exactly the same checks in the browser and report a bad value beside its own field rather
// than as a failed save.

/** The largest quantity a modifier may store: PostgreSQL's `integer` maximum. */
export const MAX_MODIFIER_INTEGER = 2147483647;

/**
 * A product or variant price as a plain decimal: up to ten whole digits and at most two decimals,
 * with no leading zero — `0` and `0.50` pass, `007` does not.
 */
export const isProductPrice = (text: string): boolean =>
  /^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(text);
