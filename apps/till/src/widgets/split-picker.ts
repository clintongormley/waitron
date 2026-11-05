import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { MONEY_SCALE, compareDecimal, decimal, toScale } from "@waitron/shared";
import type { TabLine } from "../api/client.js";
import { fill, named, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { billLabel } from "../state/bill-state.js";
import {
  billTick,
  billTotal,
  pickOnBill,
  rowsOf,
  toggleBill,
  type SplitPicks,
  type SplitSource,
} from "../state/split-selection.js";
import { tickStyles } from "./portion-picker.js";

/** `split-take-over`: a bill's holder as the panel's read showed them. */
export interface SplitTakeOverDetail {
  billId: string;
  draftId: string;
  revision: number;
  ownerName: string | null;
}

const NO_PICKS: ReadonlySet<string> = new Set();
const ZERO = decimal("0");

/**
 * A table's bills, each with a tick for the whole bill and its dishes to tick. It holds no picks of
 * its own: each change is a `split-picks` event with the next selection, and the screen hands it
 * back. A bill someone else's unsent order holds draws that person's row and no dishes.
 */
@customElement("till-split-picker")
export class TillSplitPicker extends LitElement {
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
      .bills {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
      }
      .bill {
        display: grid;
        gap: var(--wt-space-2);
      }
      .header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
        font-weight: var(--wt-font-weight-bold);
      }
      label {
        display: flex;
        flex: 1;
        min-inline-size: 0;
        align-items: center;
        gap: var(--wt-space-3);
        min-block-size: var(--wt-tap-min);
        cursor: pointer;
      }
      label:has(input:disabled) {
        cursor: default;
      }
      .name {
        min-inline-size: 0;
        overflow-wrap: anywhere;
      }
      .paid,
      .note {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-normal);
      }
      .total {
        font-variant-numeric: tabular-nums;
      }
      .note {
        margin: 0;
      }
      .held {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2);
        overflow-wrap: anywhere;
      }
    `,
  ];
  /** The bills to draw, in the order to draw them. */
  @property({ attribute: false }) sources: readonly SplitSource[] = [];
  @property({ attribute: false }) split: SplitPicks = { whole: new Set(), picks: new Map() };
  /** Names a dish or an extra. */
  @property({ attribute: false }) nameOf: (line: TabLine) => string = (line) => line.name ?? "";
  @property({ attribute: false }) money: (amount: string) => string = (amount) => amount;

  #emit(split: SplitPicks): void {
    this.dispatchEvent(
      new CustomEvent("split-picks", { detail: { split }, bubbles: true, composed: true }),
    );
    // Puts the tick back to what `split` says when the screen does not redraw after the event.
    this.requestUpdate();
  }

  #takeOver(source: SplitSource, held: NonNullable<SplitSource["held"]>): void {
    const detail: SplitTakeOverDetail = {
      billId: source.bill.workingOrderId,
      draftId: held.draftId,
      revision: held.revision,
      ownerName: held.ownerName,
    };
    this.dispatchEvent(
      new CustomEvent("split-take-over", { detail, bubbles: true, composed: true }),
    );
  }

  #holder(source: SplitSource, held: NonNullable<SplitSource["held"]>): TemplateResult {
    const name = held.ownerName ?? "";
    const words = held.takenFromYou
      ? named(name, t("table.draft_taken_by"), t("table.draft_taken_by_unnamed"))
      : named(name, t("table.others_draft"), t("table.others_draft_unnamed"));
    return html`<div class="held">
      <span>${words}</span>
      <wt-button
        variant="secondary"
        data-split-take-over=${source.bill.workingOrderId}
        aria-label=${`${t("table.take_over")} · ${billLabel(source.bill)}`}
        @click=${() => this.#takeOver(source, held)}
      >
        ${t("table.take_over")}
      </wt-button>
    </div>`;
  }

  #bill(source: SplitSource): TemplateResult {
    const id = source.bill.workingOrderId;
    const tick = billTick(source, this.split);
    const waitsForTakeOver = source.held !== null && tick === "none";
    const reasonId = `split-reason-${id}`;
    const received = source.groups.floor?.received ?? ZERO;
    return html`<section class="bill" data-split-bill=${id}>
      <div class="header" data-split-header>
        <label>
          <input
            type="checkbox"
            data-split-tick=${id}
            .checked=${live(tick === "all")}
            .indeterminate=${live(tick === "some")}
            ?disabled=${waitsForTakeOver}
            aria-describedby=${waitsForTakeOver ? reasonId : nothing}
            @change=${() => this.#emit(toggleBill(source, this.split))}
          />
          <span class="name" data-split-name>${billLabel(source.bill)}</span>
        </label>
        ${
          compareDecimal(received, ZERO) > 0
            ? html`<span class="paid" data-split-paid
                >${fill(t("table.split_bill_part_paid"), {
                  amount: this.money(toScale(received, MONEY_SCALE)),
                })}</span
              >`
            : nothing
        }
        <span class="total" data-split-total
          >${this.money(toScale(billTotal(source), MONEY_SCALE))}</span
        >
      </div>
      ${
        source.bill.status === "placed"
          ? html`<p class="note">${t("table.split_presented")}</p>`
          : nothing
      }
      ${source.ownUnsent ? html`<p class="note">${t("table.split_own_unsent")}</p>` : nothing}
      ${source.held === null ? this.#rows(source, tick) : this.#holder(source, source.held)}
      ${
        waitsForTakeOver
          ? html`<p class="note" id=${reasonId}>${t("table.split_take_over_first")}</p>`
          : nothing
      }
    </section>`;
  }

  #rows(source: SplitSource, tick: "none" | "some" | "all"): TemplateResult {
    return html`<till-portion-picker
      .rows=${rowsOf(source, this.split)}
      .picks=${this.split.picks.get(source.bill.workingOrderId) ?? NO_PICKS}
      .whole=${tick === "all"}
      .nameOf=${this.nameOf}
      .money=${this.money}
      @portion-picks=${(event: CustomEvent<{ picks: string[] }>) => {
        event.stopPropagation();
        this.#emit(pickOnBill(source, this.split, new Set(event.detail.picks)));
      }}
    ></till-portion-picker>`;
  }

  override render() {
    return html`<div class="bills">${this.sources.map((source) => this.#bill(source))}</div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-split-picker": TillSplitPicker;
  }
}
