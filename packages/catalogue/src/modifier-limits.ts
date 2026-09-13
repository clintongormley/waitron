// Imports nothing, so the dashboard can check a modifier against these limits in the browser.

/** The largest quantity a modifier may store: PostgreSQL's `integer` maximum. */
export const MAX_MODIFIER_INTEGER = 2147483647;

/** A modifier price as a plain decimal: up to ten whole digits and at most two decimal places. */
export const isModifierPrice = (text: string): boolean => /^\d{1,10}(?:\.\d{1,2})?$/.test(text);
