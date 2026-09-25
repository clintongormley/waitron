import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles } from "@waitron/ui";
import { type Decimal, compareDecimal, decimal, subtractDecimal } from "@waitron/shared";
import { formatMoney } from "../i18n/format.js";
import { t } from "../i18n/t.js";
import "./numeric-pad.js";
import "./reader-picker.js";
import "./modifier-picker.js";
import type { ModifierConfirmDetail } from "./modifier-picker.js";
import { StoreChangeController } from "../state/store-controller.js";
import type { OrderFlow, PayOutcome, TillActiveReader, TillProduct } from "../api/client.js";
import type { WorkingOrderStore } from "../state/working-order.js";
import type { PropertyValues } from "lit";
import { productUnit, unitName } from "./product-name.js";
import { needsModifierPicker } from "../state/order-line.js";

/**
 * For `cash`, `amount` is the FULL operator-entered tendered amount, never the total — the
 * server records the fiscal tender at the total and returns the change. `card` is a manual
 * bank-terminal (datáfono) charge: `amount` is the sale total, and `externalRef` is the terminal's
 * optional operation number.
 */
export type ConfirmPaymentDetail =
  { method: "cash"; amount: string } | { method: "card"; amount: string; externalRef?: string };

export interface ParkOrderDetail {
  label?: string;
}

export interface CollectCardDetail {
  tip?: string;
  allowOffline?: boolean;
  simulationOutcome?: "captured" | "declined";
  /** Absent when the operator never picked one — the server then falls back to the paying
   * device's own default reader. */
  readerId?: string;
}

/** `"none"` keeps the Card button on the manual (datáfono) path; every other value emits
 * `collect-card`. */
export type CardProvider =
  "none" | "stripe_terminal" | "stripe_on_device" | "sumup_cloud" | "simulator";

export type CardOutcome = Exclude<PayOutcome, { outcome: "captured" }>["outcome"];

const ZERO = decimal("0");

type View = "idle" | "paying" | "weighing" | "holding" | "card" | "collecting" | "card_outcome";

/**
 * The pay flow and unit-quantity entry. It coordinates only through the store and never
 * references a sibling widget.
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
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        margin-top: var(--wt-space-3);
      }

      .pay,
      .pay-card,
      .hold,
      .park,
      .confirm,
      .add,
      .cancel,
      .retry,
      .switch-tender,
      .wait {
        width: 100%;
      }

      .label-input,
      .ref-input {
        margin-bottom: var(--wt-space-3);
      }

      .card-extras {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        margin-bottom: var(--wt-space-3);
      }

      .reader-control {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2);
      }

      .reader-name {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  /** The order this widget settles. Set before the widget connects (its lifecycle subscribes). */
  @property({ attribute: false }) store!: WorkingOrderStore;
  /**
   * A sale is in flight. Disabling the controls is only the VISIBLE half of the double-file guard;
   * the real safety is the app-level single-flight flag (`till-app`'s `submitting`).
   */
  @property({ type: Boolean }) busy = false;
  @property() mode: OrderFlow = "prepay";
  /** Ignored when {@link mode} is `"prepay"`, which has no separate collect stage. */
  @property() stage: "order" | "collect" = "order";
  @property() cardProvider: CardProvider = "none";
  @property({ type: Boolean }) tipsEnabled = false;
  @property() cardOutcome?: CardOutcome;
  @property({ attribute: false }) activeReaders: TillActiveReader[] = [];
  /** Only NAMES the default on screen — never sent; an unset {@link chosenReaderId} already means
   * "use the device default". */
  @property() defaultReaderId?: string;

  @state() private view: View = "idle";
  @state() private entry = "";
  @state() private labelEntry = "";
  @state() private refEntry = "";
  @state() private selected?: TillProduct;
  @state() private tipEntry = "";
  @state() private allowOffline = false;
  @state() private simulationOutcome: "captured" | "declined" = "captured";
  /** Replayed by `#retryCard`: the idle screen's tip and offline fields are gone by the time
   * Retry is tapped. */
  #lastCollectDetail: CollectCardDetail = {};
  /** Stays chosen for later sales on this widget instance, until the operator picks again. */
  @state() private chosenReaderId?: string;
  @state() private pickingReader = false;

  constructor() {
    super();
    new StoreChangeController(this, () => this.store);
    new StoreChangeController(
      this,
      () => this.store,
      "product-selected",
      (product) => this.#onProductSelected(product as TillProduct),
    );
  }

  #onProductSelected(product: TillProduct): void {
    const unit = productUnit(product);
    if (unit.hardwareUnit === null && unit.precision === 0) return;
    this.selected = product;
    this.entry = "";
    this.view = "weighing";
  }

  /**
   * Lit's default `hasChanged` (`!==`) means re-committing the SAME outcome is not a change, which
   * is what lets Switch tender and Keep waiting leave {@link view} where the operator put it. A new
   * attempt produces a fresh value because `till-app`'s `#onCollectCard` clears `cardOutcome`
   * first.
   */
  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("cardOutcome") && this.cardOutcome !== undefined) {
      this.view = "card_outcome";
    }
  }

  /** A trailing dot (`"0."`, mid-entry) and an empty pad are the two shapes `decimal()` would
   * reject. */
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
    this.view = "paying";
  }

  #startHolding(): void {
    this.labelEntry = "";
    this.view = "holding";
  }

  #startCard(): void {
    this.refEntry = "";
    this.view = "card";
  }

  #onCardTap(): void {
    if (this.cardProvider === "none") {
      this.#startCard();
      return;
    }
    const tip = this.tipEntry.trim();
    this.#collectCard({
      ...(this.tipsEnabled && tip !== "" ? { tip } : {}),
      ...(this.cardProvider === "stripe_on_device" && this.allowOffline
        ? { allowOffline: true }
        : {}),
      ...(this.cardProvider === "simulator" ? { simulationOutcome: this.simulationOutcome } : {}),
      ...(this.chosenReaderId === undefined ? {} : { readerId: this.chosenReaderId }),
    });
  }

  #collectCard(detail: CollectCardDetail): void {
    this.#lastCollectDetail = detail;
    this.view = "collecting";
    this.dispatchEvent(
      new CustomEvent<CollectCardDetail>("collect-card", { detail, bubbles: true, composed: true }),
    );
  }

  #retryCard(): void {
    this.#collectCard(this.#lastCollectDetail);
  }

  /** The `POST /api/pay` this outcome came from has already resolved, so nothing is running to wait
   * ON; this only puts the spinner back up. */
  #wait(): void {
    this.view = "collecting";
  }

  #onTipChange(event: Event): void {
    event.stopPropagation();
    this.tipEntry = (event as CustomEvent<{ value: string }>).detail.value;
  }

  #onOfflineChange(event: Event): void {
    event.stopPropagation();
    this.allowOffline = (event as CustomEvent<{ checked: boolean }>).detail.checked;
  }

  /** The manual path and the simulator have no real reader to pick an ALTERNATIVE to. */
  get #readerPickerAvailable(): boolean {
    return (
      this.cardProvider !== "none" &&
      this.cardProvider !== "simulator" &&
      this.activeReaders.length > 0
    );
  }

  get #displayedReader(): TillActiveReader | undefined {
    const id = this.chosenReaderId ?? this.defaultReaderId;
    return id === undefined ? undefined : this.activeReaders.find((reader) => reader.id === id);
  }

  #openReaderPicker(): void {
    this.pickingReader = true;
  }

  #onReaderChosen(event: Event): void {
    this.chosenReaderId = (event as CustomEvent<{ readerId: string }>).detail.readerId;
    this.pickingReader = false;
  }

  #onReaderPickerCancel(): void {
    this.pickingReader = false;
  }

  #place(): void {
    this.dispatchEvent(new CustomEvent("place-order", { bubbles: true, composed: true }));
  }

  #onLabelChange(event: Event): void {
    event.stopPropagation();
    this.labelEntry = (event as CustomEvent<{ value: string }>).detail.value;
  }

  #onRefChange(event: Event): void {
    event.stopPropagation();
    this.refEntry = (event as CustomEvent<{ value: string }>).detail.value;
  }

  /** Reset BEFORE the dispatch, so even a synchronous listener that throws leaves the widget
   * idle. */
  #park(): void {
    const label = this.labelEntry.trim();
    this.view = "idle";
    this.labelEntry = "";
    this.dispatchEvent(
      new CustomEvent<ParkOrderDetail>("park-order", {
        detail: { label: label === "" ? undefined : label },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Cancel from the `"collecting"` spinner is a CLIENT-SIDE ABORT ONLY: `PaymentProvider` has no
   * `cancel` method (`packages/payments/src/provider.ts`), so the in-flight `POST /api/pay` keeps
   * running to its own outcome. Switch tender leaves `cardOutcome` untouched; see `willUpdate`.
   */
  #cancel(): void {
    this.selected = undefined;
    this.entry = "";
    this.labelEntry = "";
    this.refEntry = "";
    this.view = "idle";
  }

  #tenderEventName(): "confirm-payment" | "collect-order" {
    return this.mode === "prepay" ? "confirm-payment" : "collect-order";
  }

  /** Guarded so a short tender can never be emitted, even if Confirm is force-clicked past its
   * disabled state. */
  #confirm(): void {
    if (compareDecimal(this.#enteredDecimal(), this.store.total) < 0) return;
    this.dispatchEvent(
      new CustomEvent<ConfirmPaymentDetail>(this.#tenderEventName(), {
        detail: { method: "cash", amount: this.#enteredDecimal() },
        bubbles: true,
        composed: true,
      }),
    );
    this.view = "idle";
    this.entry = "";
  }

  /** Reset BEFORE the dispatch, like `#park`. */
  #confirmCard(): void {
    const ref = this.refEntry.trim();
    const detail: ConfirmPaymentDetail = {
      method: "card",
      amount: this.store.total,
      ...(ref === "" ? {} : { externalRef: ref }),
    };
    this.view = "idle";
    this.refEntry = "";
    this.dispatchEvent(
      new CustomEvent<ConfirmPaymentDetail>(this.#tenderEventName(), {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  @state() private modifierDraft?: { product: TillProduct; quantity: string };

  /**
   * Single-flight, so two rapid clicks before Lit re-renders ring the line ONCE: the view is
   * flipped to `"idle"` first, so the second synchronous call sees `view !== "weighing"` and
   * returns.
   */
  #addWeight(product: TillProduct): void {
    if (this.view !== "weighing") return;
    const quantity = this.#enteredDecimal();
    if (compareDecimal(quantity, ZERO) <= 0 || !this.#quantityFitsUnit(product)) return;
    this.selected = undefined;
    this.entry = "";
    this.view = "idle";
    if (needsModifierPicker(product)) {
      this.modifierDraft = { product, quantity };
    } else {
      this.store.addProduct(product, quantity);
    }
  }

  #entryDisplay(): string {
    return this.entry === "" ? "0" : this.entry;
  }

  /** Ignore insignificant zeroes, matching the server's exact decimal-string check. */
  #quantityFitsUnit(product: TillProduct): boolean {
    const literal = this.entry.endsWith(".") ? this.entry.slice(0, -1) : this.entry;
    const significantFraction = (literal.split(".")[1] ?? "").replace(/0+$/, "");
    return significantFraction.length <= productUnit(product).precision;
  }

  override render() {
    return html`${this.#renderView()}${this.#renderReaderPicker()}${
      this.modifierDraft
        ? html`<till-modifier-picker
            .product=${this.modifierDraft.product}
            .quantity=${this.modifierDraft.quantity}
            @wt-modifier-confirm=${(event: CustomEvent<ModifierConfirmDetail>) => {
              event.stopPropagation();
              if (!this.modifierDraft) return;
              const quantity = this.modifierDraft.quantity;
              this.modifierDraft = undefined;
              // The detail IS the selection: it extends `LineSelection`, note included.
              this.store.addProduct(event.detail.product, quantity, event.detail);
            }}
            @wt-modifier-cancel=${(event: Event) => {
              event.stopPropagation();
              this.modifierDraft = undefined;
            }}
          ></till-modifier-picker>`
        : nothing
    }`;
  }

  #renderView() {
    if (this.view === "paying") return this.#renderPaying();
    if (this.view === "weighing") return this.#renderWeighing();
    if (this.view === "holding") return this.#renderHolding();
    if (this.view === "card") return this.#renderCard();
    if (this.view === "collecting") return this.#renderCollecting();
    if (this.view === "card_outcome") return this.#renderCardOutcome();
    return this.#renderIdle();
  }

  /** Rendered outside `#renderIdle` so a view switch cannot tear the open dialog down. */
  #renderReaderPicker() {
    if (!this.pickingReader) return nothing;
    return html`<till-reader-picker
      .readers=${this.activeReaders}
      .selectedReaderId=${this.chosenReaderId ?? this.defaultReaderId}
      @reader-chosen=${(event: Event) => this.#onReaderChosen(event)}
      @reader-picker-cancel=${() => this.#onReaderPickerCancel()}
    ></till-reader-picker>`;
  }

  #renderIdle() {
    const disabled = this.store.lineCount === 0 || this.busy;
    if (this.mode !== "prepay" && this.stage === "order") return this.#renderIdlePlace(disabled);
    if (this.mode !== "prepay" && this.stage === "collect")
      return this.#renderIdleCollect(disabled);
    return this.#renderIdlePay(disabled);
  }

  #renderIdlePlace(disabled: boolean) {
    return html`
      <div class="actions">
        <wt-button
          class="place"
          variant="primary"
          size="lg"
          ?disabled=${disabled}
          @click=${() => this.#place()}
        >
          ${t("action.place")}
        </wt-button>
        <wt-button
          class="hold"
          variant="secondary"
          size="lg"
          ?disabled=${disabled}
          @click=${() => this.#startHolding()}
        >
          ${t("action.hold")}
        </wt-button>
      </div>
    `;
  }

  /**
   * A handheld renders it too: a manual card tender goes to `POST /api/sales`, which the server
   * does not fence against a handheld — only the INTEGRATED reader (`/api/pay`) is fenced.
   */
  #renderCardButton(disabled: boolean) {
    return html`
      <wt-button
        class="pay-card"
        variant="primary"
        size="lg"
        ?disabled=${disabled}
        @click=${() => this.#onCardTap()}
      >
        ${t("tender.card")}
      </wt-button>
    `;
  }

  /** No Hold: a placed order is not parked again. */
  #renderIdleCollect(disabled: boolean) {
    return html`
      ${this.#renderCardExtras()}
      <div class="actions">
        <wt-button
          class="pay"
          variant="primary"
          size="lg"
          ?disabled=${disabled}
          @click=${() => this.#startPaying()}
        >
          ${t("action.collect")}
        </wt-button>
        ${this.#renderCardButton(disabled)}
      </div>
    `;
  }

  #renderIdlePay(disabled: boolean) {
    return html`
      ${this.#renderCardExtras()}
      <div class="actions">
        <wt-button
          class="pay"
          variant="primary"
          size="lg"
          ?disabled=${disabled}
          @click=${() => this.#startPaying()}
        >
          ${t("action.pay")}
        </wt-button>
        ${this.#renderCardButton(disabled)}
        <wt-button
          class="hold"
          variant="secondary"
          size="lg"
          ?disabled=${disabled}
          @click=${() => this.#startHolding()}
        >
          ${t("action.hold")}
        </wt-button>
      </div>
    `;
  }

  #renderReaderControl() {
    if (!this.#readerPickerAvailable) return nothing;
    const reader = this.#displayedReader;
    return html`
      <div class="reader-control">
        ${reader === undefined ? nothing : html`<p class="reader-name">${reader.name}</p>`}
        <wt-button
          class="change-reader"
          variant="secondary"
          size="sm"
          @click=${() => this.#openReaderPicker()}
        >
          ${t("action.use_different_reader")}
        </wt-button>
      </div>
    `;
  }

  /**
   * The offline-consent toggle shows only for `"stripe_on_device"`: a server-driven
   * `"stripe_terminal"` reader has no device-local offline queue to consent INTO
   * (`StripeTerminalProvider.forward`, `packages/payments-stripe/src/provider.ts`).
   */
  #renderCardExtras() {
    if (this.cardProvider === "none") return nothing;
    return html`
      <div class="card-extras">
        ${this.#renderReaderControl()}
        ${
          this.cardProvider === "simulator"
            ? html`<div
                class="simulation-options"
                role="group"
                aria-label=${t("card.simulation_result")}
              >
                <p>${t("card.simulation_help")}</p>
                <wt-button
                  variant=${this.simulationOutcome === "captured" ? "primary" : "secondary"}
                  data-test="simulation-captured"
                  aria-pressed=${this.simulationOutcome === "captured"}
                  @click=${() => (this.simulationOutcome = "captured")}
                  >${t("card.simulation_captured")}</wt-button
                >
                <wt-button
                  variant=${this.simulationOutcome === "declined" ? "primary" : "secondary"}
                  data-test="simulation-declined"
                  aria-pressed=${this.simulationOutcome === "declined"}
                  @click=${() => (this.simulationOutcome = "declined")}
                  >${t("card.simulation_declined")}</wt-button
                >
              </div>`
            : nothing
        }
        ${
          this.tipsEnabled
            ? html`
                <wt-input
                  @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(".pay-card"))}
                  class="tip-input"
                  type="number"
                  .value=${this.tipEntry}
                  .label=${t("card.tip")}
                  @wt-change=${(event: Event) => this.#onTipChange(event)}
                ></wt-input>
              `
            : nothing
        }
        ${
          this.cardProvider === "stripe_on_device"
            ? html`
                <wt-switch
                  class="offline-consent"
                  .checked=${this.allowOffline}
                  .label=${t("card.offline_consent")}
                  @wt-change=${(event: Event) => this.#onOfflineChange(event)}
                ></wt-switch>
              `
            : nothing
        }
      </div>
    `;
  }

  #renderCollecting() {
    return html`
      <div class="summary collecting">
        <p class="prompt">${t("card.collecting")}</p>
      </div>
      <div class="actions">
        <wt-button class="cancel" variant="secondary" @click=${() => this.#cancel()}>
          ${t("card.cancel")}
        </wt-button>
      </div>
    `;
  }

  /** One message whichever of decline, timeout or network-unavailable it was — a deliberate
   * single treatment. */
  #renderCardOutcome() {
    return html`
      <div class="summary card-outcome">
        <p class="prompt">${t("card.declined")}</p>
      </div>
      <div class="actions">
        <wt-button class="retry" variant="primary" size="lg" @click=${() => this.#retryCard()}>
          ${t("card.retry")}
        </wt-button>
        <wt-button class="switch-tender" variant="secondary" @click=${() => this.#cancel()}>
          ${t("card.switch_tender")}
        </wt-button>
        <wt-button class="wait" variant="secondary" @click=${() => this.#wait()}>
          ${t("card.wait")}
        </wt-button>
      </div>
    `;
  }

  #renderHolding() {
    return html`
      <wt-input
        @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(".park"))}
        class="label-input"
        .value=${this.labelEntry}
        .label=${t("held.label_prompt")}
        @wt-change=${(event: Event) => this.#onLabelChange(event)}
      ></wt-input>
      <div class="actions">
        <wt-button class="park" variant="primary" size="lg" @click=${() => this.#park()}>
          ${t("action.hold")}
        </wt-button>
        <wt-button class="cancel" variant="secondary" @click=${() => this.#cancel()}>
          ${t("action.cancel")}
        </wt-button>
      </div>
    `;
  }

  #renderCard() {
    return html`
      <div class="summary">
        <p class="tender-kind">${t("tender.card")}</p>
        <div class="row">
          <span class="label">${t("label.total")}</span>
          <span class="amount total">${formatMoney(this.store.total)}</span>
        </div>
      </div>
      <wt-input
        @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(".confirm"))}
        class="ref-input"
        .value=${this.refEntry}
        .label=${t("tender.card_ref")}
        @wt-change=${(event: Event) => this.#onRefChange(event)}
      ></wt-input>
      <div class="actions">
        <wt-button
          class="confirm"
          variant="primary"
          size="lg"
          ?disabled=${this.busy}
          @click=${() => this.#confirmCard()}
        >
          ${t("action.confirm_payment")}
        </wt-button>
        <wt-button class="cancel" variant="secondary" @click=${() => this.#cancel()}>
          ${t("action.cancel")}
        </wt-button>
      </div>
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
          ?disabled=${short || this.busy}
          @click=${() => this.#confirm()}
        >
          ${t("action.confirm_payment")}
        </wt-button>
        <wt-button class="cancel" variant="secondary" @click=${() => this.#cancel()}>
          ${t("action.cancel")}
        </wt-button>
      </div>
    `;
  }

  #renderWeighing() {
    // `view === "weighing"` is only ever entered with a product set (see #onProductSelected).
    const product = this.selected as TillProduct;
    const invalid =
      compareDecimal(this.#enteredDecimal(), ZERO) <= 0 || !this.#quantityFitsUnit(product);
    return html`
      <p class="prompt">${t("weigh.prompt")}</p>
      <div class="summary">
        <div class="row">
          <span class="label">${unitName(product)}</span>
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
        <wt-button class="cancel" variant="secondary" @click=${() => this.#cancel()}>
          ${t("action.cancel")}
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
