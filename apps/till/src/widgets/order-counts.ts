import { css, html, type TemplateResult } from "lit";
import { floorChipStyles } from "@waitron/ui";
import type { OrderStateCounts } from "../api/client.js";
import type { StringKey } from "../i18n/strings.js";
import { countText } from "../i18n/t.js";

const FIELDS: readonly [keyof OrderStateCounts, StringKey, StringKey][] = [
  ["ordered", "order_counts.items", "order_counts.items_one"],
  ["unsent", "order_counts.unsent", "order_counts.unsent_one"],
  ["held", "order_counts.held", "order_counts.held_one"],
  ["waiting", "order_counts.waiting", "order_counts.waiting_one"],
  ["ready", "order_counts.ready", "order_counts.ready_one"],
];

/** How many items the order holds, then each state that has any. No `data-chip`, so a query for
 * the signal chips does not find these. */
export function orderCounts(counts: OrderStateCounts): TemplateResult {
  return html`<span class="counts"
    >${FIELDS.filter(([field]) => field === "ordered" || counts[field] > 0).map(
      ([field, many, one]) =>
        html`<span class="chip" data-count=${field}>${countText(counts[field], many, one)}</span>`,
    )}</span
  >`;
}

export const orderCountStyles = [
  floorChipStyles,
  css`
    .counts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--wt-space-1);
    }

    .counts .chip {
      font-weight: var(--wt-font-weight-normal);
    }

    .chip[data-count="unsent"] {
      border-style: dashed;
      border-color: var(--wt-color-warning);
    }

    .chip[data-count="held"] {
      border-color: var(--wt-color-text-muted);
    }

    .chip[data-count="waiting"] {
      border-color: var(--wt-color-warning);
    }

    .chip[data-count="ready"] {
      border-color: var(--wt-color-success);
    }
  `,
];
