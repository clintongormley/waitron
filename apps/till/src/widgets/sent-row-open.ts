import { type TemplateResult, css, html, nothing } from "lit";
import { t } from "../i18n/t.js";
import type { TabLine } from "../api/kitchen-api.js";
import { portionLineFacts } from "../state/portion-groups.js";
import type { SentSlice } from "../state/sent-panel.js";
import { type SentRow, sentPortionId } from "../state/sent-sections.js";
import { quantityText, trimQuantity } from "./dish-format.js";
import { OPEN_BORDER, OPEN_LEAD, OPEN_MARGIN, openRowAction, openRowBox } from "./row-text.js";

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

/** What a press checks against the live list: every portion of the row as it was drawn, with the
 * bill line that says which dish it is. */
export function sentRowDrawn(row: SentRow, lines: readonly TabLine[]): string {
  return JSON.stringify(
    row.slices.map(({ row: dish, kind, quantity }) => {
      const line = lines.find((each) => each.id === dish.lineId && each.lineNo === dish.lineNo);
      return [
        dish.lineId,
        dish.workingOrderId,
        dish.lineNo,
        kind,
        quantity,
        trimQuantity(dish.quantity),
        trimQuantity(dish.servedQuantity),
        trimQuantity(dish.cancelledQuantity ?? "0"),
        dish.released,
        dish.unitPrecision,
        dish.countsWholePortions ?? null,
        dish.name,
        dish.note,
        dish.extras.map((extra) => [extra.lineId, extra.name, trimQuantity(extra.quantity)]),
        line === undefined ? null : portionLineFacts(line),
      ];
    }),
  );
}

interface Opened {
  opening: string;
  id: string;
  left: string[];
  portions: string[];
}

const opened = (opening: string, row: SentRow): Opened => ({
  opening,
  id: row.id,
  left: row.left.map(sentPortionId),
  portions: row.slices.map(sentPortionId),
});

/**
 * Which sent row is open in place, one at a time. A serve can join a portion to another row and
 * change which line a row starts with, so the open row is followed by its portions: to the row
 * holding the first of its unserved ones still unserved; once none is, to a row holding any of its
 * portions that has none left. It closes when the bill or party changes or no row qualifies, so
 * once nothing it held is left to serve, the box never moves onto a row with something left to
 * serve.
 */
export class OpenSentRow {
  #open?: Opened;

  toggle(opening: string, row: SentRow): void {
    this.#open = this.is(opening, row.id) ? undefined : opened(opening, row);
  }

  is(opening: string, id: string): boolean {
    return this.#open?.opening === opening && this.#open.id === id;
  }

  /** Follows the open row into `rows`, drawn under `opening`, or closes it. */
  keep(opening: string, rows: readonly SentRow[]): void {
    const open = this.#open;
    if (open === undefined) return;
    const holds = (slices: readonly SentSlice[], id: string) =>
      slices.some((slice) => sentPortionId(slice) === id);
    const row =
      open.opening !== opening
        ? undefined
        : (open.left
            .map((id) => rows.find((each) => holds(each.left, id)))
            .find((each) => each !== undefined) ??
          rows.find(
            (each) => each.left.length === 0 && open.portions.some((id) => holds(each.slices, id)),
          ));
    this.#open = row && opened(opening, row);
  }
}

export interface SentOpenView {
  row: SentRow;
  busy: boolean;
  serve: (serve: SentServe, event: Event) => void;
  details: (event: Event) => void;
}

const serveWords = (serve: SentServe) =>
  serve.kind === "whole"
    ? t("table.row_serve")
    : t("table.row_serve_n").replace("{n}", quantityText(serve.count));

/** The opened row's line under it: the count and its Serve buttons, then Dish details. */
export function sentOpenControls(view: SentOpenView): TemplateResult {
  const { row } = view;
  const count =
    row.state === "cancelled_charged" || row.left.length === 0
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
              @click=${(event: Event) => view.serve(serve, event)}
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
    /* The end column loses the box's margin and border, so the price keeps the closed rows' end. */
    grid-template-columns: ${OPEN_LEAD} minmax(0, 1fr) calc(
        var(--wt-tap-min) - ${OPEN_MARGIN} - ${OPEN_BORDER}
      );
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
    padding-block: var(--wt-space-1) var(--wt-space-2);
    padding-inline: 0 var(--wt-space-2);
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
    /* Under the name: the quantity column's least width, which .sent-row-open sets. */
    margin-inline-start: calc(var(--wt-space-5) + var(--wt-space-1));
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
