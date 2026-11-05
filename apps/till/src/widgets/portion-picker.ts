import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
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

/** The picker's ticks: the bill header beside a row of them draws the same box. */
export const tickStyles = css`
  input {
    flex: none;
    inline-size: var(--wt-space-5);
    block-size: var(--wt-space-5);
    margin: 0;
    accent-color: var(--wt-color-primary);
  }
  /* The browser's own disabled box is too faint to see on the light page. */
  input:disabled {
    appearance: none;
    border: 1px solid var(--wt-color-text-muted);
    border-radius: var(--wt-radius-sm);
    background: var(--wt-color-track);
  }
  input:disabled:checked {
    display: grid;
    place-content: center;
    background: var(--wt-color-text-muted);
  }
  input:disabled:checked::after {
    content: "✓";
    color: var(--wt-color-bg);
    font-size: var(--wt-font-size-sm);
    line-height: 1;
  }
`;

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
    tickStyles,
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
      /* A tick still works on this row, so its text keeps a readable contrast: at
         --wt-opacity-disabled it fails axe on the light page. The tick itself stays in full colour:
         at that opacity it measures 2.07:1 on the light page and 2.29:1 on the dark, under the 3:1
         the picker's accessibility suite holds, and axe cannot see it. */
      .quiet label {
        color: var(--wt-color-text-muted);
      }
      .pale .name,
      .pale .qty,
      .pale .amount {
        opacity: var(--wt-opacity-disabled);
      }
      .name {
        flex: 1;
        overflow-wrap: anywhere;
      }
      .mark {
        display: inline-block;
        margin-inline-start: var(--wt-space-2);
        padding-inline: var(--wt-space-2);
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-surface-lifted);
        color: var(--wt-color-primary-text);
        font-size: var(--wt-font-size-sm);
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
  /** The whole bill is chosen: every row draws ticked with no stepper, whatever `picks` holds, and
   * unticking a row emits the other rows' members. */
  @property({ type: Boolean }) whole = false;
  /** Names a dish or an extra. */
  @property({ attribute: false }) nameOf: (line: TabLine) => string = (line) => line.name ?? "";
  /** Words to mark a dish with, such as what it is waiting for; empty for none. */
  @property({ attribute: false }) markOf: (line: TabLine) => string = () => "";
  @property({ attribute: false }) money: (amount: string) => string = (amount) => amount;

  /** The other stepper button, once this press has moved the picks: the pressed one is disabled at
   * its limit, which would drop focus to the page. The row's tick, when that press made the bill
   * whole and the row has no stepper left. */
  #stepperFocus?: { button: string; tick: string };

  override updated(changed: PropertyValues<this>): void {
    if (!changed.has("picks") || this.#stepperFocus === undefined) return;
    const { button: other, tick } = this.#stepperFocus;
    this.#stepperFocus = undefined;
    const button = this.renderRoot.querySelector<HTMLElementTagNameMap["wt-button"]>(other);
    if (button === null) this.renderRoot.querySelector<HTMLElement>(tick)?.focus();
    else void button.updateComplete.then(() => button.focus());
  }

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

  #toggled(row: PickRow): Picks {
    if (!this.whole) return toggleRow(row, this.picks);
    return new Set(
      this.rows.filter((other) => other !== row).flatMap((other) => other.members.map((m) => m.id)),
    );
  }

  #reason(row: PickRow): string {
    if (row.blocked === null || row.blocked.reason === "presented") return "";
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
    const count = this.whole
      ? row.members.length
      : row.blocked?.reason === "paid"
        ? 0
        : pickedCount(row, this.picks);
    const stepped = row.counted && count > 0 && !this.whole;
    const off = row.blocked !== null && (count === 0 || this.whole);
    const look =
      row.blocked?.reason === "presented" || (this.whole && off)
        ? "pale"
        : this.whole
          ? "quiet"
          : "";
    const dish = this.#what(row.members[0]!);
    const extras = row.extras.map((extra) => this.#what(extra));
    const name = [dish, ...extras].join(", ");
    const reason = this.#reason(row);
    const reasonId = `pick-reason-${id}`;
    const mark = this.markOf(row.members[0]!);
    const amount = toScale(
      multiplyDecimal(decimal(row.each), decimal(String(count > 0 ? count : row.members.length))),
      MONEY_SCALE,
    );
    return html`<div class="row ${look}" data-pick-row=${id}>
      <label>
        <input
          type="checkbox"
          data-pick=${id}
          .checked=${live(count > 0)}
          ?disabled=${off}
          aria-describedby=${reason === "" ? nothing : reasonId}
          aria-description=${row.blocked?.reason === "presented" ? t("table.split_presented") : nothing}
          @change=${() => this.#emit(this.#toggled(row))}
        />
        <span class="name"
          >${dish}${mark === "" ? nothing : html`<span class="mark" data-pick-mark=${id}>${mark}</span>`}${extras.map((extra) => html`<span class="extra">${extra}</span>`)}</span
        >
        ${
          row.counted && !stepped
            ? html`<span class="qty" data-pick-qty=${id}>${row.members.length}</span>`
            : nothing
        }
        <span class="amount" data-pick-amount=${id}>${this.money(amount)}</span>
      </label>
      ${reason === "" ? nothing : html`<p class="reason" id=${reasonId}>${reason}</p>`}
      ${stepped ? this.#stepper(row, count, name, reason) : nothing}
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
        @click=${() => {
          if (count - 1 <= 1)
            this.#stepperFocus = {
              button: `[data-pick-inc="${CSS.escape(id)}"]`,
              tick: `[data-pick="${CSS.escape(id)}"]`,
            };
          this.#emit(setCount(row, count - 1, this.picks));
        }}
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
        @click=${() => {
          if (count + 1 >= row.limit)
            this.#stepperFocus = {
              button: `[data-pick-dec="${CSS.escape(id)}"]`,
              tick: `[data-pick="${CSS.escape(id)}"]`,
            };
          this.#emit(setCount(row, count + 1, this.picks));
        }}
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
