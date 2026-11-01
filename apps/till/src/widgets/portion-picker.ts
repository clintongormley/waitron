import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { baseStyles, formatDecimalInput } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { MONEY_SCALE, decimal, multiplyDecimal, toScale } from "@waitron/shared";
import type { TabLine } from "../api/client.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import {
  pickedCount,
  pickedLineIds,
  setCount,
  toggleRow,
  type PickRow,
  type Picks,
} from "../state/portion-selection.js";
import { trimQuantity } from "./dish-format.js";

/**
 * One bill's dishes as ticks, identical portions as one row with a count, and the reason a dish
 * cannot be picked beside it. It holds no picks of its own: each change is a `portion-picks` event
 * with every picked line id, in line order, and the screen hands the picks and redrawn rows back.
 */
@customElement("till-portion-picker")
export class TillPortionPicker extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .rows {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }
      .row {
        display: grid;
        gap: var(--wt-space-1);
      }
      label {
        display: flex;
        align-items: center;
        gap: var(--wt-space-3);
        min-height: var(--wt-tap-min);
        cursor: pointer;
      }
      label:has(input:disabled) {
        cursor: default;
      }
      input {
        flex: none;
        inline-size: var(--wt-space-5);
        block-size: var(--wt-space-5);
        margin: 0;
        accent-color: var(--wt-color-primary);
      }
      /* The browser's own disabled box is too faint to see on the light page. A disabled tick is
         never checked (a row holding picks keeps its tick so it can be cleared), so only the empty
         box is drawn. */
      input:disabled {
        appearance: none;
        border: 1px solid var(--wt-color-text-muted);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-track);
      }
      .name {
        flex: 1;
        overflow-wrap: anywhere;
      }
      .extra {
        display: block;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .qty,
      .amount {
        font-variant-numeric: tabular-nums;
      }
      .reason {
        margin: 0;
        margin-inline-start: calc(var(--wt-space-5) + var(--wt-space-3));
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .stepper {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--wt-space-2);
      }
      .count {
        min-width: 6ch;
        text-align: center;
        font-variant-numeric: tabular-nums;
      }
      .empty {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
    `,
  ];
  @property({ attribute: false }) rows: readonly PickRow[] = [];
  @property({ attribute: false }) picks: Picks = new Set();
  /** Names a dish or an extra. */
  @property({ attribute: false }) nameOf: (line: TabLine) => string = (line) => line.name ?? "";
  @property({ attribute: false }) money: (amount: string) => string = (amount) => amount;

  #emit(next: Picks): void {
    this.dispatchEvent(
      new CustomEvent("portion-picks", {
        detail: { picks: pickedLineIds(this.rows, next) },
        bubbles: true,
        composed: true,
      }),
    );
    // Puts the tick back to what `picks` says when the screen does not redraw after the event.
    this.requestUpdate();
  }

  #reason(row: PickRow): string {
    if (row.blocked === null) return "";
    if (row.blocked.reason === "paid") return t("bill_pay.paid");
    return fill(t("table.move_dishes_floor"), { amount: this.money(row.blocked.kept) });
  }

  /** A line's name, and its quantity unless it is one whole unit. */
  #what(line: TabLine): string {
    const quantity = trimQuantity(line.quantity);
    const name = this.nameOf(line);
    return line.unitPrecision === 0 && quantity === "1"
      ? name
      : `${name} ×${formatDecimalInput(quantity, currentLocale())}`;
  }

  #row(row: PickRow): TemplateResult {
    const id = row.members[0]!.id;
    const count = row.blocked?.reason === "paid" ? 0 : pickedCount(row, this.picks);
    const dish = this.#what(row.members[0]!);
    const extras = row.extras.map((extra) => this.#what(extra));
    const name = [dish, ...extras].join(", ");
    const reason = this.#reason(row);
    const reasonId = `pick-reason-${id}`;
    const amount = toScale(
      multiplyDecimal(decimal(row.each), decimal(String(count > 0 ? count : row.members.length))),
      MONEY_SCALE,
    );
    return html`<div class="row" data-pick-row=${id}>
      <label>
        <input
          type="checkbox"
          data-pick=${id}
          .checked=${live(count > 0)}
          ?disabled=${row.blocked !== null && count === 0}
          aria-describedby=${reason === "" ? nothing : reasonId}
          @change=${() => this.#emit(toggleRow(row, this.picks))}
        />
        <span class="name"
          >${dish}${extras.map((extra) => html`<span class="extra">${extra}</span>`)}</span
        >
        ${
          row.counted && count === 0
            ? html`<span class="qty" data-pick-qty=${id}>${row.members.length}</span>`
            : nothing
        }
        <span class="amount" data-pick-amount=${id}>${this.money(amount)}</span>
      </label>
      ${reason === "" ? nothing : html`<p class="reason" id=${reasonId}>${reason}</p>`}
      ${row.counted && count > 0 ? this.#stepper(row, count, name, reason) : nothing}
    </div>`;
  }

  #stepper(row: PickRow, count: number, name: string, reason: string): TemplateResult {
    const id = row.members[0]!.id;
    return html`<div class="stepper">
      <wt-button
        variant="ghost"
        data-pick-dec=${id}
        aria-label=${`${t("basket.decrease")} ${name}`}
        ?disabled=${count <= 1}
        @click=${() => this.#emit(setCount(row, count - 1, this.picks))}
      >
        <span aria-hidden="true">−</span>
      </wt-button>
      <span class="count" data-pick-count=${id}
        >${fill(t("table.pick_count"), {
          count: String(count),
          total: String(row.members.length),
        })}</span
      >
      <wt-button
        variant="ghost"
        data-pick-inc=${id}
        aria-label=${`${t("basket.increase")} ${name}`}
        aria-description=${count >= row.limit && reason !== "" ? reason : nothing}
        ?disabled=${count >= row.limit}
        @click=${() => this.#emit(setCount(row, count + 1, this.picks))}
      >
        <span aria-hidden="true">+</span>
      </wt-button>
    </div>`;
  }

  override render() {
    if (this.rows.length === 0) return html`<p class="empty">${t("table.move_dishes_none")}</p>`;
    return html`<div class="rows">${this.rows.map((row) => this.#row(row))}</div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-portion-picker": TillPortionPicker;
  }
}
