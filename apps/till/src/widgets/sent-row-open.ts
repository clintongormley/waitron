import { type TemplateResult, css, html, nothing } from "lit";
import { t } from "../i18n/t.js";
import type { SentSlice } from "../state/sent-panel.js";
import type { SentRow } from "../state/sent-sections.js";
import { quantityText } from "./dish-format.js";
import { openRowAction, openRowBox } from "./row-text.js";

export interface ServeItem {
  lineId: string;
  quantity: string;
}

/** One of an opened row's Serve buttons: Serve 1, Serve {N} (what is left), or a weighed dish's
 * Serve for the whole of it. */
export interface SentServe {
  kind: "one" | "rest" | "whole";
  count: string;
  items: ServeItem[];
}

const item = (slice: SentSlice, quantity = slice.quantity): ServeItem => ({
  lineId: slice.row.lineId,
  quantity,
});

/** What an opened row offers to serve: nothing unless all that is left of it is released. */
export function sentServes(row: SentRow): SentServe[] {
  const { left } = row;
  if (
    row.state === "cancelled_charged" ||
    left.length === 0 ||
    left.some((slice) => slice.kind !== "fired" || !slice.row.released)
  )
    return [];
  if (left.length > 1)
    return [
      { kind: "one", count: "1", items: [item(left[0]!)] },
      { kind: "rest", count: String(left.length), items: left.map((slice) => item(slice)) },
    ];
  const slice = left[0]!;
  const dish = slice.row;
  if (dish.unitPrecision !== 0 || dish.countsWholePortions === false)
    return [{ kind: "whole", count: slice.quantity, items: [item(slice)] }];
  const one: SentServe = { kind: "one", count: "1", items: [item(slice, "1")] };
  return slice.quantity === "1"
    ? [one]
    : [one, { kind: "rest", count: slice.quantity, items: [item(slice)] }];
}

/** What a press checks against the live list: every portion of the row as it was drawn. */
export function sentRowDrawn(row: SentRow): string {
  return JSON.stringify(
    row.slices.map((slice) => [slice.row.lineId, slice.kind, slice.quantity, slice.row.released]),
  );
}

/**
 * Which sent row is open in place, one at a time, by its id (its first portion's line, and
 * whether it is the cancelled-but-charged part). A serve does not change a row's id, so the row
 * stays open across it; the row closes when the bill or party changes or no row holds the id.
 */
export class OpenSentRow {
  #open?: { opening: string; id: string };

  toggle(opening: string, id: string): void {
    this.#open = this.is(opening, id) ? undefined : { opening, id };
  }

  is(opening: string, id: string): boolean {
    return this.#open?.opening === opening && this.#open.id === id;
  }

  /** Closes the row unless `rows`, drawn under `opening`, still hold it. */
  keep(opening: string, rows: readonly SentRow[]): void {
    const open = this.#open;
    if (open !== undefined && (open.opening !== opening || !rows.some((row) => row.id === open.id)))
      this.#open = undefined;
  }
}

export interface SentOpenView {
  row: SentRow;
  busy: boolean;
  serve: (serve: SentServe) => void;
  details: () => void;
}

const serveWords = (serve: SentServe) =>
  serve.kind === "whole"
    ? t("table.row_serve")
    : t("table.row_serve_n").replace("{n}", quantityText(serve.count));

/** The opened row's line under it: the count and its Serve buttons, then Dish details. */
export function sentOpenControls(view: SentOpenView): TemplateResult {
  const { row } = view;
  const count =
    row.state === "cancelled_charged"
      ? nothing
      : html`<span class="sent-open-count" data-sent-open-count
          >${t("table.row_served_of")
            .replace("{served}", quantityText(row.served))
            .replace("{quantity}", quantityText(row.quantity))}</span
        >`;
  return html`<div class="sent-open" data-sent-open>
    <div class="sent-open-serve">
      ${count}
      <span class="sent-open-acts"
        >${sentServes(row).map(
          (serve) =>
            html`<button
              type="button"
              class="sent-open-act"
              data-sent-serve=${serve.kind}
              ?disabled=${view.busy}
              @click=${() => view.serve(serve)}
            >
              ${serveWords(serve)}
            </button>`,
        )}</span
      >
    </div>
    <button
      type="button"
      class="sent-open-act"
      data-sent-details
      ?disabled=${view.busy}
      @click=${view.details}
    >
      ${t("table.sent_info")}
    </button>
  </div>`;
}

export const sentOpenStyles = css`
  .sent-row[data-open] {
    ${openRowBox}
    grid-template-columns: var(--wt-tap-min) minmax(0, 1fr) var(--wt-space-2);
    color: var(--wt-color-text);
  }
  .sent-row[data-open] .row-qty {
    font-weight: var(--wt-font-weight-bold);
  }
  .sent-row[data-open] .row-name {
    font-weight: var(--wt-font-weight-medium);
  }
  .sent-open {
    grid-column: 2 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wt-space-2);
    padding: var(--wt-space-1) 0 var(--wt-space-2);
  }
  .sent-open-serve {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--wt-space-2);
    width: 100%;
  }
  .sent-open-count {
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-md);
  }
  .sent-open-acts {
    display: flex;
    gap: var(--wt-space-2);
    margin-inline-start: auto;
  }
  .sent-open-act {
    ${openRowAction}
  }
  .sent-open-act:disabled {
    cursor: default;
  }
  .sent-open-act:focus-visible {
    outline: var(--wt-focus-ring);
    outline-offset: var(--wt-focus-offset);
  }
`;
