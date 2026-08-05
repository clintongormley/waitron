import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { type Decimal, compareDecimal, decimal, subtractDecimal } from "@waitron/shared";
import { formatMoney } from "../i18n/format.js";
import { t } from "../i18n/t.js";
import "./numeric-pad.js";
import type { TillProduct } from "../api/client.js";
import type { WorkingOrderStore } from "../state/working-order.js";

/** The payload of the `confirm-payment` event: a cash tender for the amount the operator entered. */
export interface ConfirmPaymentDetail {
  method: "cash";
  /** The FULL operator-entered tendered amount (a Decimal string), never the total. */
  amount: string;
}

/** Zero, precomputed — the floor a kg entry must clear to be a real weight. */
const ZERO = decimal("0");

/** One widget, three views: the idle Pay button, the cash-tender screen, the kg-weight screen. */
type Mode = "idle" | "paying" | "weighing";

/**
 * The pay flow and the kg-weight entry — the two moments the walk-up sale needs a numeric keypad.
 * It owns a small mode state (idle → paying → weighing → idle) and renders exactly one view at a
 * time, sharing the `till-numeric-pad` between the cash and weight screens.
 *
 * It coordinates only through the store (spec §3): it subscribes to `"changed"` so the Pay button's
 * enabled state tracks the basket, and to `"product-selected"` so picking a weight tile opens the
 * weigh screen. It never references a sibling widget.
 *
 * MONEY DISCIPLINE. Every amount is an `@waitron/shared` Decimal, never a float. The change is
 * `tendered − total` by decimal subtraction; the total read for both the change and the Confirm gate
 * is the store's previewed total, so the number the operator settles against is the same one the
 * server re-prices and files. `confirm-payment` carries the amount the operator entered, not the
 * total — the server records the fiscal tender at the total and returns the change.
 */
@customElement("till-tender-pay")
export class TillTenderPay extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .summary {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        margin-bottom: var(--wt-space-3);
      }

      .tender-kind {
        margin: 0;
        color: var(--wt-color-text-muted);
        font-weight: var(--wt-font-weight-bold);
      }

      .prompt {
        margin: 0 0 var(--wt-space-3);
        font-weight: var(--wt-font-weight-bold);
      }

      .row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--wt-space-3);
      }

      .label {
        color: var(--wt-color-text-muted);
      }

      .amount {
        font-variant-numeric: tabular-nums;
        font-weight: var(--wt-font-weight-bold);
      }

      .change .amount {
        font-size: var(--wt-font-size-lg);
      }

      .actions {
        margin-top: var(--wt-space-3);
      }

      .pay,
      .confirm,
      .add {
        width: 100%;
      }
    `,
  ];

  /** The order this widget settles. Set before the widget connects (its lifecycle subscribes). */
  @property({ attribute: false }) store!: WorkingOrderStore;

  @state() private mode: Mode = "idle";
  /** The digits the keypad has entered — a partial number string shared by both keypad screens. */
  @state() private entry = "";
  /** The weight product awaiting a kg entry; set only while {@link mode} is `"weighing"`. */
  @state() private selected?: TillProduct;

  #unsubscribeChanged?: () => void;
  #unsubscribeSelected?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#unsubscribeChanged = this.store.subscribe(() => this.requestUpdate());
    this.#unsubscribeSelected = this.store.on("product-selected", (product) =>
      this.#onProductSelected(product as TillProduct),
    );
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#unsubscribeChanged?.();
    this.#unsubscribeSelected?.();
    this.#unsubscribeChanged = undefined;
    this.#unsubscribeSelected = undefined;
  }

  /** Open the weigh screen for a picked weight product; ignore a non-weight pick (never weighed). */
  #onProductSelected(product: TillProduct): void {
    if (product.pricingUnit !== "weight") return;
    this.selected = product;
    this.entry = "";
    this.mode = "weighing";
  }

  /**
   * The entered pad string as a valid Decimal. A trailing dot (`"0."`, mid-entry) is stripped and an
   * empty pad reads as `"0"` — the two shapes `decimal()` would reject — so this never throws on a
   * partial entry.
   */
  #enteredDecimal(): Decimal {
    const trimmed = this.entry.endsWith(".") ? this.entry.slice(0, -1) : this.entry;
    return decimal(trimmed === "" ? "0" : trimmed);
  }

  #onPadChange(event: Event): void {
    event.stopPropagation();
    this.entry = (event as CustomEvent<{ value: string }>).detail.value;
  }

  #startPaying(): void {
    this.entry = "";
    this.mode = "paying";
  }

  /** Emit the cash tender and return to idle. Guarded so a short tender can never be emitted, even
   * if Confirm is force-clicked past its disabled state. */
  #confirm(): void {
    if (compareDecimal(this.#enteredDecimal(), this.store.total) < 0) return;
    this.dispatchEvent(
      new CustomEvent<ConfirmPaymentDetail>("confirm-payment", {
        detail: { method: "cash", amount: this.#enteredDecimal() },
        bubbles: true,
        composed: true,
      }),
    );
    this.mode = "idle";
    this.entry = "";
  }

  /** Ring up the weighed line and return to idle. Guarded so a zero/empty weight is a no-op. */
  #addWeight(product: TillProduct): void {
    const kg = this.#enteredDecimal();
    if (compareDecimal(kg, ZERO) <= 0) return;
    this.store.addProduct(product, kg);
    this.selected = undefined;
    this.entry = "";
    this.mode = "idle";
  }

  /** What the keypad has entered so far, shown as `"0"` rather than blank when nothing is typed. */
  #entryDisplay(): string {
    return this.entry === "" ? "0" : this.entry;
  }

  override render() {
    if (this.mode === "paying") return this.#renderPaying();
    if (this.mode === "weighing") return this.#renderWeighing();
    return this.#renderIdle();
  }

  #renderIdle() {
    return html`
      <wt-button
        class="pay"
        variant="primary"
        size="lg"
        ?disabled=${this.store.lines.length === 0}
        @click=${() => this.#startPaying()}
      >
        ${t("action.pay")}
      </wt-button>
    `;
  }

  #renderPaying() {
    const total = this.store.total;
    const entered = this.#enteredDecimal();
    const short = compareDecimal(entered, total) < 0;
    return html`
      <div class="summary">
        <p class="tender-kind">${t("tender.cash")}</p>
        <div class="row">
          <span class="label">${t("label.total")}</span>
          <span class="amount total">${formatMoney(total)}</span>
        </div>
        <div class="row">
          <span class="label">${t("label.tendered")}</span>
          <span class="amount tendered">${this.#entryDisplay()}</span>
        </div>
        ${
          short
            ? nothing
            : html`
                <div class="row change">
                  <span class="label">${t("label.change")}</span>
                  <span class="amount">${formatMoney(subtractDecimal(entered, total))}</span>
                </div>
              `
        }
      </div>
      <till-numeric-pad
        .value=${this.entry}
        @wt-change=${(event: Event) => this.#onPadChange(event)}
      ></till-numeric-pad>
      <div class="actions">
        <wt-button
          class="confirm"
          variant="primary"
          size="lg"
          ?disabled=${short}
          @click=${() => this.#confirm()}
        >
          ${t("action.confirm_payment")}
        </wt-button>
      </div>
    `;
  }

  #renderWeighing() {
    // `mode === "weighing"` is only ever entered with a product set (see #onProductSelected), so
    // `selected` is defined here — asserting it keeps a dead, uncoverable runtime guard out.
    const product = this.selected as TillProduct;
    const invalid = compareDecimal(this.#enteredDecimal(), ZERO) <= 0;
    return html`
      <p class="prompt">${t("weigh.prompt")}</p>
      <div class="summary">
        <div class="row">
          <span class="label">kg</span>
          <span class="amount kg">${this.#entryDisplay()}</span>
        </div>
      </div>
      <till-numeric-pad
        .value=${this.entry}
        @wt-change=${(event: Event) => this.#onPadChange(event)}
      ></till-numeric-pad>
      <div class="actions">
        <wt-button
          class="add"
          variant="primary"
          size="lg"
          ?disabled=${invalid}
          @click=${() => this.#addWeight(product)}
        >
          ${t("action.add")}
        </wt-button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-tender-pay": TillTenderPay;
  }
}
