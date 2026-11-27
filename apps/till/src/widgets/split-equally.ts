import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  MAX_GUEST_COUNT,
  decimal,
  equalShares,
  formatMoney,
  multiplyDecimal,
  type Decimal,
} from "@waitron/shared";
import { baseStyles, type ShareListShare, type WtButton, type WtTopBar } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-foot-button-bar.js";
import "@waitron/ui/src/components/wt-full-screen-panel.js";
import "@waitron/ui/src/components/wt-share-list.js";
import "@waitron/ui/src/components/wt-stepper.js";
import "@waitron/ui/src/components/wt-top-bar.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import type { PaidShare } from "../state/share-run.js";

/** `guests` counts the paid guests too; `amount` is the first unpaid guest's share. */
export interface SplitEquallyStartDetail {
  guests: number;
  amount: string;
}

const money = (amount: string): string => formatMoney(decimal(amount), currentLocale());

/** `ShareRun.paid` is a new array on every read, so only a change in what it holds counts. */
const paidChanged = (next: readonly PaidShare[], previous?: readonly PaidShare[]): boolean =>
  previous === undefined ||
  next.length !== previous.length ||
  next.some(
    (share, i) => share.amount !== previous[i]!.amount || share.state !== previous[i]!.state,
  );

/** Split equally: the number of guests with − and +, and every guest's share of what is left. */
@customElement("till-split-equally")
export class TillSplitEqually extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .question {
        margin: 0;
        padding: calc(var(--wt-space-4) + var(--wt-space-1) / 2) var(--wt-space-4) 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-md);
        text-align: center;
      }

      .count {
        display: flex;
        justify-content: center;
        padding: var(--wt-space-2) var(--wt-space-4);
      }

      wt-share-list {
        margin-block: calc(var(--wt-space-2) + var(--wt-space-1) / 2);
      }

      .note {
        margin: 0;
        padding: calc(var(--wt-space-1) / 2) var(--wt-space-4);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        text-align: center;
      }
    `,
  ];

  @property() billName = "";
  /** What is left to divide: the bill less what is received and what a card in progress holds. */
  @property() left = "0.00";
  /** Whether the bill already holds money received or a card in progress. */
  @property({ type: Boolean }) taken = false;
  /** The table's guest count, or the record's count when there is a record. */
  @property({ attribute: false }) startCount: number | null = null;
  /** The count chosen before the share's Pay was opened; set, it is where the screen starts. */
  @property({ attribute: false }) keptCount: number | null = null;
  /** The guests the record counts as paid, in order. */
  @property({ attribute: false, hasChanged: paidChanged }) paid: readonly PaidShare[] = [];

  /** The count chosen; the count shown and started is this held inside the limits. */
  @state() private count = 2;

  /** Money is on the bill and no record says whose, so the count is of the guests still to pay. */
  get #asksLeft(): boolean {
    return this.taken && this.paid.length === 0;
  }

  get #shown(): number {
    return Math.max(this.#min, Math.min(this.#max, this.count));
  }

  get #min(): number {
    return Math.max(2, this.paid.length + 1);
  }

  get #max(): number {
    return Math.min(MAX_GUEST_COUNT, this.paid.length + this.#cents);
  }

  get #cents(): number {
    return Number(multiplyDecimal(decimal(this.left), decimal("100")));
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    super.willUpdate(changed);
    const paidBefore = changed.get("paid") as readonly PaidShare[] | undefined;
    // A card received changes no count, so the count being chosen stays.
    if (
      !this.hasUpdated ||
      changed.has("startCount") ||
      changed.has("keptCount") ||
      changed.has("taken") ||
      changed.has("left") ||
      (changed.has("paid") && paidBefore?.length !== this.paid.length)
    )
      this.count = this.keptCount ?? (this.#asksLeft ? 2 : (this.startCount ?? this.#min));
  }

  protected override firstUpdated(): void {
    void this.#focusBack();
  }

  async #focusBack(): Promise<void> {
    const bar = this.renderRoot.querySelector<WtTopBar>("wt-top-bar")!;
    await bar.updateComplete;
    const back = bar.shadowRoot!.querySelector<WtButton>("wt-button");
    await back?.updateComplete;
    back?.focus();
  }

  #onCount(event: CustomEvent<{ value: number }>): void {
    event.stopPropagation();
    this.count = event.detail.value;
  }

  #start(shares: readonly Decimal[]): void {
    this.dispatchEvent(
      new CustomEvent<SplitEquallyStartDetail>("split-equally-start", {
        detail: { guests: this.#shown, amount: shares[0]! },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #back(): void {
    this.dispatchEvent(new CustomEvent("split-equally-back", { bubbles: true, composed: true }));
  }

  override render() {
    const paid = this.paid.length;
    const count = this.#shown;
    const shares = count > this.#max ? [] : equalShares(decimal(this.left), count - paid);
    const guest = (index: number) => fill(t("split_equally.guest"), { n: String(index + 1) });
    const rows: ShareListShare[] = [
      ...this.paid.map((share, index) => ({
        name: guest(index),
        detail: t(share.state === "card" ? "split_equally.card" : "split_equally.paid"),
        amount: money(share.amount),
        state: share.state === "card" ? ("due" as const) : ("paid" as const),
      })),
      ...shares.map((share, index) => ({
        name: guest(paid + index),
        detail: t("split_equally.due"),
        amount: money(share),
        state: "due" as const,
      })),
    ];
    const title = t("bill_pay.way_share");
    return html`<wt-full-screen-panel .bodyLabel=${title}>
      <wt-top-bar
        slot="header"
        .heading=${title}
        .subtitle=${fill(t(this.taken ? "split_equally.subtitle_left" : "split_equally.subtitle"), {
          bill: this.billName,
          amount: money(this.left),
        })}
        .backLabel=${t("bill_pay.title")}
        @wt-back=${(event: Event) => {
          event.stopPropagation();
          this.#back();
        }}
      ></wt-top-bar>
      <p class="question" data-split-question>
        ${t(this.#asksLeft ? "split_equally.question_left" : "split_equally.question")}
      </p>
      <div class="count">
        <wt-stepper
          variant="round"
          .value=${count}
          .min=${this.#min}
          .max=${this.#max}
          .label=${t("seat.guest_count")}
          .decreaseLabel=${(label: string) => fill(t("action.decrease"), { label })}
          .increaseLabel=${(label: string) => fill(t("action.increase"), { label })}
          @wt-change=${(event: CustomEvent<{ value: number }>) => this.#onCount(event)}
        ></wt-stepper>
      </div>
      <wt-share-list .label=${t("split_equally.shares")} .shares=${rows}></wt-share-list>
      ${
        shares[0] === shares[shares.length - 1]
          ? nothing
          : html`<p class="note" data-split-note>${t("split_equally.note")}</p>`
      }
      <wt-foot-button-bar slot="footer">
        <wt-button
          data-split-start
          variant="primary"
          .disabled=${shares.length === 0}
          @click=${() => this.#start(shares)}
          >${fill(t("split_equally.start"), {
            guest: guest(paid),
            amount: money(shares[0] ?? "0.00"),
          })}</wt-button
        >
      </wt-foot-button-bar>
    </wt-full-screen-panel>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-split-equally": TillSplitEqually;
  }
}
