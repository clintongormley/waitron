import { preventTouchContextMenu } from "@waitron/ui";
import { type TemplateResult, css, html, nothing } from "lit";
import type { CurrentOrderRow } from "../api/kitchen-api.js";
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import type { SentRow, SentRowState, SentSectionTitle } from "../state/sent-sections.js";
import { rowTextStyles } from "./row-text.js";
import "@waitron/ui/src/components/wt-button.js";
import "./fired-ago.js";

export interface SentRowView {
  row: SentRow;
  /** The section heading's state: a row in the same state does not repeat it. */
  heading: SentSectionTitle["state"];
  now: number;
  quantity: (value: string) => string;
  price: string;
  /** Beside the name: nutrition icons, the set-menu tag and the guest allergy mark. */
  marks: TemplateResult;
  busy: boolean;
  press: (event: PointerEvent) => void;
  serve: (event: MouseEvent) => void;
  info: () => void;
}

const STATE_WORDS: Partial<Record<SentRowState, StringKey>> = {
  held: "table.group_held",
  at_the_pass: "table.at_the_pass",
  served: "table.row_served",
  cancelled_charged: "table.cancelled_charged",
};

function stateText(view: SentRowView): TemplateResult | string | undefined {
  const { row } = view;
  if (row.state === view.heading) return undefined;
  const words = STATE_WORDS[row.state];
  if (words !== undefined) return t(words);
  const dish = row.left[0]!.row;
  if (row.state === "ready") {
    const minutes = Math.max(0, Math.floor((view.now - Date.parse(dish.readyAt!)) / 60_000));
    return html`<span class="row-ready"
      >${t("table.row_ready_ago").replace("{n}", String(minutes))}</span
    >`;
  }
  return dish.firedAt === null
    ? t("table.group_fired")
    : html`<till-fired-ago .firedAt=${dish.firedAt} .now=${view.now}></till-fired-ago>`;
}

function dishWords(dish: CurrentOrderRow, quantity: (value: string) => string) {
  return [
    ...dish.extras.map((extra) => {
      const amount = quantity(extra.quantity);
      return amount === quantity("1") ? extra.name : `${extra.name} ×${amount}`;
    }),
    ...(dish.note === null ? [] : [`${t("line.note.label")}: ${dish.note}`]),
  ];
}

function secondLine(parts: readonly (TemplateResult | string)[]) {
  return parts.length === 0
    ? nothing
    : html`<span class="row-more"
        >${parts.map((part, i) => (i === 0 ? part : html` · ${part}`))}</span
      >`;
}

function name(dish: CurrentOrderRow, marks: TemplateResult) {
  return html`<span class="row-name"><span class="product-name">${dish.name}</span>${marks}</span>`;
}

/** One sent dish: its served and unserved portions together, or its cancelled-but-charged part. */
export function sentRow(view: SentRowView): TemplateResult {
  const { row } = view;
  const first = row.left[0] ?? row.slices[0]!;
  const dish = first.row;
  const fired = first.kind === "fired";
  const state = stateText(view);
  const served =
    row.left.length > 0 && row.served !== "0"
      ? t("table.row_served_of")
          .replace("{served}", view.quantity(row.served))
          .replace("{quantity}", view.quantity(row.quantity))
      : undefined;
  const contents = html`<span class="row-qty">${view.quantity(row.quantity)}</span
    ><span class="row-text"
      >${name(dish, view.marks)}${secondLine([
        ...dishWords(dish, view.quantity),
        ...(state === undefined ? [] : [state]),
        ...(served === undefined ? [] : [served]),
      ])}</span
    ><span class="row-price">${view.price}</span>`;
  return html`<li
    class="sent-row"
    data-fired-line=${fired ? dish.lineId : nothing}
    data-held-line=${first.kind === "held" ? dish.lineId : nothing}
    data-served-line=${row.left.length === 0 ? dish.lineId : nothing}
  >
    ${
      fired
        ? html`<button
            type="button"
            class="sent-row-open"
            data-serve-line=${dish.lineId}
            ?disabled=${view.busy || !dish.released}
            aria-description=${t("table.serve")}
            @pointerdown=${view.press}
            @contextmenu=${preventTouchContextMenu}
            @click=${view.serve}
          >
            ${contents}
          </button>`
        : html`<div
            class="sent-row-open"
            @pointerdown=${view.press}
            @contextmenu=${preventTouchContextMenu}
          >
            ${contents}
          </div>`
    }
    <wt-button
      class="sent-row-end"
      variant="ghost"
      data-sent-info=${dish.lineId}
      aria-label=${`${t("table.sent_info")} · ${dish.name}`}
      ?disabled=${view.busy}
      @click=${view.info}
      >ⓘ</wt-button
    >
  </li>`;
}

/** Another bill's held dish in a held group, which Fire sends too: no price and no action. */
export function sentCompanion(
  dish: CurrentOrderRow,
  bill: string,
  quantity: (value: string) => string,
  marks: TemplateResult,
): TemplateResult {
  return html`<li class="sent-row companion" data-companion=${dish.lineId}>
    <div class="sent-row-open">
      <span class="row-qty">${quantity(dish.quantity)}</span
      ><span class="row-text"
        >${name(dish, marks)}${secondLine([...dishWords(dish, quantity), bill])}</span
      >
    </div>
  </li>`;
}

export const sentRowStyles = [
  rowTextStyles,
  css`
    .sent-row {
      display: grid;
      grid-template-columns: var(--wt-tap-min) minmax(0, 1fr) minmax(var(--wt-tap-min), auto);
      align-items: center;
      min-height: calc(var(--wt-tap-min) + var(--wt-space-2));
      border-bottom: 1px solid var(--wt-color-border);
      color: var(--wt-color-text-muted);
    }
    .sent-row-open {
      grid-column: 2;
      display: grid;
      grid-template-columns:
        minmax(calc(var(--wt-space-5) + var(--wt-space-1)), max-content) minmax(0, 1fr)
        auto;
      align-items: center;
      min-height: var(--wt-tap-min);
      margin: 0;
      padding: var(--wt-space-1) 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: start;
      -webkit-user-select: none;
      user-select: none;
    }
    button.sent-row-open {
      cursor: pointer;
    }
    button.sent-row-open:disabled {
      cursor: default;
    }
    .sent-row-open:focus-visible {
      outline: var(--wt-focus-ring);
      outline-offset: calc(-1 * var(--wt-focus-offset));
    }
    .sent-row .row-qty,
    .sent-row .row-name {
      font-weight: var(--wt-font-weight-normal);
    }
    .sent-row .row-ready {
      color: var(--wt-color-warning);
      font-weight: var(--wt-font-weight-bold);
    }
    .sent-row-end {
      grid-column: 3;
      justify-self: center;
    }
    .companion {
      background: var(--wt-color-surface-sunken);
      color: var(--wt-color-text);
    }
  `,
];
