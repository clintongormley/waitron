import type { ChangeSource } from "@waitron/shared";

/** The tables this module's code owns. They live in core's set, which classifies them. */
export const ADJUSTMENTS_TABLES = [
  "adjustment_reasons",
  "adjustments",
  "adjustment_refunds",
  "adjustment_lines",
] as const;

export const ADJUSTMENTS_CHANGE_SOURCES: readonly ChangeSource[] = ADJUSTMENTS_TABLES.map(
  (table) => ({
    table,
    type: table,
  }),
);
