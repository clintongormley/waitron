import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  submitOnEnter,
  formatDecimalInput,
  formMessage,
  formMessageStyles,
  baseStyles,
  leaveCoordinatorFor,
  type DraftScope,
  type LeaveCoordinator,
} from "@waitron/ui";
import { live } from "lit/directives/live.js";
import {
  compareDecimal,
  decimal,
  formatMoney,
  subtractDecimal,
  type Decimal,
} from "@waitron/shared";
import { typedAmount } from "../state/bill-payment.js";
import { currentLocale, t } from "../i18n/t.js";
import "./numeric-pad.js";
import "./reader-picker.js";
import "./modifier-picker.js";
import type { ModifierConfirmDetail } from "./modifier-picker.js";
import { StoreChangeController } from "../state/store-controller.js";
import type { OrderFlow, PayOutcome, TillActiveReader, TillProduct } from "../api/client.js";
import type { WorkingOrderStore } from "../state/working-order.js";
import type { PropertyValues } from "lit";
import { productUnit, soldByTheUnit, unitName } from "./product-name.js";
import { needsModifierPicker, quantityPlaces } from "../state/order-line.js";

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
   * device's chosen reader, else its profile's default. */
  readerId?: string;
}

/** `"none"` keeps the Card button on the manual (datáfono) path; every other value emits
 * `collect-card`. */
export type CardProvider =
  "none" | "stripe_terminal" | "stripe_on_device" | "sumup_cloud" | "simulator";

export type CardOutcome = Exclude<PayOutcome, { outcome: "captured" }>["outcome"];

const ZERO = decimal("0");

type EntryDraft = { entry: string; label: string; ref: string };
type CardDraft = { tip: string; offline: boolean; simulation: "captured" | "declined" };

type View = "idle" | "paying" | "weighing" | "holding" | "card" | "collecting" | "card_outcome";

/**
 * The pay flow and unit-quantity entry. It coordinates only through the store and never
 * references a sibling widget.
 */
@customElement("till-tender-pay")
export class TillTenderPay extends LitElement {
  static override styles = [
    baseStyles,
    formMessageStyles,
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

      .idle-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .idle-actions .cash-at-till,
      .idle-actions .tenders,
      .idle-actions .place {
        grid-column: 1 / -1;
      }

      /* Two equal columns, falling to one where the widget is too narrow for both. */
      .tenders {
        display: grid;
        grid-template-columns: repeat(
          auto-fit,
          minmax(min(100%, calc(var(--wt-tap-min) * 3)), 1fr)
        );
        gap: var(--wt-space-2);
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

      .simulation-options p {
        margin: 0 0 var(--wt-space-2);
      }

      .reader-control {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2);
      }

      .reader-name,
      .cash-at-till {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  /** The order this widget settles. Set before the widget connects (its lifecycle subscribes). */
  @property({ attribute: false }) store!: WorkingOrderStore;
  /**
   * A sale or order is being sent (card-grid also ORs its held basket into it). Disabling the
   * controls is only the VISIBLE half of the guard against a second send; the real safety is the
   * app's own single-flight flags (`till-app`'s `submitting` and `placing`).
   */
  @property({ type: Boolean }) busy = false;
  /** The pay controls are held while nothing is being sent; read only to draw Cash and Card grey. */
  @property({ type: Boolean }) held = false;
  @property() mode: OrderFlow = "prepay";
  /** Only a weighed dish's weight entry, for a screen that takes payment elsewhere. */
  @property({ type: Boolean }) weighOnly = false;
  /** Ignored when {@link mode} is `"prepay"`, which has no separate collect stage. */
  @property() stage: "order" | "collect" = "order";
  @property() cardProvider: CardProvider = "none";
  @property({ type: Boolean }) tipsEnabled = false;
  /** False on a device whose profile does not take cash: no Cash button, and a line saying where to
   * take it. */
  @property({ type: Boolean }) takesCash = true;
  @property() cardOutcome?: CardOutcome;
  /** Bumped by the app when no card attempt is still running, after any retry and any
   * kitchen-station question an attempt asks, whether or not it produced a {@link cardOutcome}. */
  @property({ attribute: false }) cardAttemptsOver = 0;
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
  @state() private tipAttempted = false;
  @state() private allowOffline = false;
  @state() private simulationOutcome: "captured" | "declined" = "captured";
  /** Replayed by `#retryCard`: the idle screen's tip and offline fields are gone by the time
   * Retry is tapped. */
  #lastCollectDetail: CollectCardDetail = {};
  /** Stays chosen for later sales on this widget instance, until the operator picks again. */
  @state() private chosenReaderId?: string;
  @state() private pickingReader = false;
  #checkingTender = false;
  readonly #entryOwner = {};
  readonly #extrasOwner = {};
  #entryScope?: DraftScope<EntryDraft>;
  #extrasScope?: DraftScope<CardDraft>;
  #entryBaseline?: EntryDraft;
  #extrasBaseline?: CardDraft;
  #entryView?: View;
  #leave?: LeaveCoordinator;

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.#entryScope?.dispose();
    this.#extrasScope?.dispose();
    this.#entryScope = undefined;
    this.#extrasScope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  #entryDraft(): EntryDraft {
    return { entry: this.entry, label: this.labelEntry, ref: this.refEntry };
  }

  #cardDraft(): CardDraft {
    return { tip: this.tipEntry, offline: this.allowOffline, simulation: this.simulationOutcome };
  }

  #sameNumber(a: string, b: string): boolean {
    const amount = (value: string) => {
      const trimmed = value.trim().replace(/\.$/, "");
      return decimal(trimmed === "" ? "0" : trimmed);
    };
    try {
      return compareDecimal(amount(a), amount(b)) === 0;
    } catch {
      return a === b;
    }
  }

  #syncScopes(): void {
    if (!this.isConnected) return;
    this.#leave ??= leaveCoordinatorFor(this);
    const editable = ["paying", "weighing", "holding", "card"].includes(this.view);
    if (this.#entryView !== this.view || !editable) {
      this.#entryScope?.dispose();
      this.#entryScope = undefined;
      this.#entryBaseline = undefined;
      this.#entryView = this.view;
    }
    if (editable && !this.#entryScope) {
      const view = this.view;
      this.#entryBaseline ??= this.#entryDraft();
      this.#entryScope = this.#leave?.register<EntryDraft>({
        id: this.#entryOwner,
        parent: this,
        current: () => this.#entryDraft(),
        snapshot: (value) => ({ ...value }),
        equal: (a, b) =>
          view === "holding"
            ? a.label.trim() === b.label.trim()
            : view === "card"
              ? a.ref.trim() === b.ref.trim()
              : this.#sameNumber(a.entry, b.entry),
        restore: (value) => {
          this.entry = value.entry;
          this.labelEntry = value.label;
          this.refEntry = value.ref;
        },
      });
      this.#entryScope?.commit(this.#entryBaseline);
    }
    if (
      this.cardProvider !== "none" &&
      this.view !== "collecting" &&
      this.view !== "card_outcome"
    ) {
      if (!this.#extrasScope) {
        this.#extrasBaseline ??= this.#cardDraft();
        this.#extrasScope = this.#leave?.register<CardDraft>({
          id: this.#extrasOwner,
          parent: this,
          current: () => this.#cardDraft(),
          snapshot: (value) => ({ ...value }),
          equal: (a, b) =>
            (!this.tipsEnabled || this.#sameNumber(a.tip, b.tip)) &&
            (this.cardProvider !== "stripe_on_device" || a.offline === b.offline) &&
            (this.cardProvider !== "simulator" ||
              this.chosenReaderId !== undefined ||
              a.simulation === b.simulation),
          restore: (value) => {
            this.tipEntry = value.tip;
            this.allowOffline = value.offline;
            this.simulationOutcome = value.simulation;
          },
        });
        this.#extrasScope?.commit(this.#extrasBaseline);
      }
    } else {
      this.#extrasScope?.dispose();
      this.#extrasScope = undefined;
      this.#extrasBaseline = undefined;
    }
  }

  #finishEntry(): void {
    this.#entryScope?.dispose();
    this.#entryScope = undefined;
    this.#entryBaseline = undefined;
  }

  #requestCancel(): void {
    if (!this.isConnected) return;
    if (this.view === "collecting" || this.view === "card_outcome") {
      this.#cancel();
      return;
    }
    if (this.busy) return;
    if (this.#entryScope && this.#leave) {
      void this.#leave.request({
        scopes: [this.#entryOwner],
        reason: "cancel",
        proceed: () => {
          if (this.isConnected && !this.busy) this.#cancel();
        },
      });
    } else this.#cancel();
  }

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
    if (!this.isConnected || this.busy || soldByTheUnit(product)) return;
    const select = () => {
      if (!this.isConnected || this.busy) return;
      this.#finishEntry();
      this.selected = product;
      this.entry = "";
      this.view = "weighing";
    };
    if (this.#entryScope && this.#leave)
      void this.#leave.request({
        scopes: [this.#entryOwner],
        reason: "navigation",
        proceed: select,
      });
    else select();
  }

  /**
   * Lit's default `hasChanged` (`!==`) means re-committing the SAME outcome is not a change, which
   * is what lets Switch tender and Keep waiting leave {@link view} where the operator put it. A new
   * attempt produces a fresh value because `till-app`'s `#collectCard` clears `cardOutcome`
   * first.
   */
  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("cardOutcome") && this.cardOutcome !== undefined) {
      this.view = "card_outcome";
    }
    if (changed.has("cardAttemptsOver") && this.view === "collecting") {
      this.view = "idle";
    }
    this.#syncScopes();
  }

  /** A trailing dot (`"0."`, mid-entry) and an empty pad are the two shapes `decimal()` would
   * reject. */
  #enteredDecimal(): Decimal {
    const trimmed = this.entry.endsWith(".") ? this.entry.slice(0, -1) : this.entry;
    return decimal(trimmed === "" ? "0" : trimmed);
  }

  #onPadChange(event: Event): void {
    event.stopPropagation();
    if (!this.isConnected || !(event.currentTarget as HTMLElement).isConnected || this.busy) return;
    this.entry = (event as CustomEvent<{ value: string }>).detail.value;
    this.#entryScope?.changed();
  }

  #checkBeforeTender(onProceed: () => void): void {
    if (!this.isConnected || this.busy || this.#checkingTender) return;
    this.#checkingTender = true;
    const resolve = (proceed: boolean) => {
      this.#checkingTender = false;
      if (proceed && this.isConnected && !this.busy) onProceed();
    };
    const event = new CustomEvent("check-before-tender", {
      detail: { resolve },
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    this.dispatchEvent(event);
    if (!event.defaultPrevented) resolve(true);
  }

  #startPaying(): void {
    this.#checkBeforeTender(() => {
      this.entry = "";
      this.view = "paying";
    });
  }

  #startHolding(): void {
    this.labelEntry = "";
    this.view = "holding";
  }

  #startCard(): void {
    this.refEntry = "";
    this.view = "card";
  }

  #tipInvalid(): boolean {
    return (
      this.tipsEnabled &&
      this.cardProvider !== "none" &&
      this.tipEntry.trim() !== "" &&
      typedAmount(this.tipEntry) === null
    );
  }

  #onCardTap(): void {
    this.tipAttempted = true;
    if (this.#tipInvalid()) {
      this.shadowRoot!.querySelector<HTMLElement>(".tip-input")?.focus();
      return;
    }
    this.#checkBeforeTender(() => {
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
        ...(this.cardProvider === "simulator" && this.chosenReaderId === undefined
          ? { simulationOutcome: this.simulationOutcome }
          : {}),
        ...(this.chosenReaderId === undefined ? {} : { readerId: this.chosenReaderId }),
      });
    });
  }

  #collectCard(detail: CollectCardDetail): void {
    if (!this.isConnected) return;
    this.#extrasScope?.dispose();
    this.#extrasScope = undefined;
    this.#extrasBaseline = undefined;
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
    if (!this.isConnected || !(event.currentTarget as HTMLElement).isConnected || this.busy) return;
    this.tipEntry = (event as CustomEvent<{ value: string }>).detail.value;
    this.#extrasScope?.changed();
  }

  #onOfflineChange(event: Event): void {
    event.stopPropagation();
    if (!this.isConnected || !(event.currentTarget as HTMLElement).isConnected || this.busy) return;
    this.allowOffline = (event as CustomEvent<{ checked: boolean }>).detail.checked;
    this.#extrasScope?.changed();
  }

  /** The manual path has no connected reader to pick. */
  get #readerPickerAvailable(): boolean {
    return this.cardProvider !== "none" && this.#pickableReaders.length > 0;
  }

  get #pickableReaders(): TillActiveReader[] {
    return this.cardProvider === "simulator"
      ? this.activeReaders.filter((reader) => reader.provider === "simulator")
      : this.activeReaders;
  }

  get #displayedReader(): TillActiveReader | undefined {
    const id = this.chosenReaderId ?? this.defaultReaderId;
    return id === undefined ? undefined : this.activeReaders.find((reader) => reader.id === id);
  }

  #openReaderPicker(): void {
    this.pickingReader = true;
  }

  #onReaderChosen(event: Event): void {
    this.chosenReaderId =
      (event as CustomEvent<{ readerId: string | null }>).detail.readerId ?? undefined;
    this.pickingReader = false;
    this.#extrasScope?.changed();
  }

  #onReaderPickerCancel(): void {
    this.pickingReader = false;
  }

  #place(): void {
    this.dispatchEvent(new CustomEvent("place-order", { bubbles: true, composed: true }));
  }

  #onLabelChange(event: Event): void {
    event.stopPropagation();
    if (!this.isConnected || !(event.currentTarget as HTMLElement).isConnected || this.busy) return;
    this.labelEntry = (event as CustomEvent<{ value: string }>).detail.value;
    this.#entryScope?.changed();
  }

  #onRefChange(event: Event): void {
    event.stopPropagation();
    if (!this.isConnected || !(event.currentTarget as HTMLElement).isConnected || this.busy) return;
    this.refEntry = (event as CustomEvent<{ value: string }>).detail.value;
    this.#entryScope?.changed();
  }

  /** Reset BEFORE the dispatch, so even a synchronous listener that throws leaves the widget
   * idle. */
  #park(): void {
    if (!this.isConnected || this.busy || this.view !== "holding") return;
    this.#finishEntry();
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

  /** Real provider collects continue after leaving this spinner because PaymentProvider has no
   * cancel method. The pretend reader alone accepts a cancellation. */
  #cancel(): void {
    if (
      this.view === "collecting" &&
      this.activeReaders.some(
        (reader) => reader.id === this.chosenReaderId && reader.provider === "simulator",
      )
    ) {
      this.dispatchEvent(new CustomEvent("cancel-demo-reader", { bubbles: true, composed: true }));
    }
    this.#finishEntry();
    this.selected = undefined;
    this.entry = "";
    this.labelEntry = "";
    this.refEntry = "";
    this.view = "idle";
  }

  /** At the order stage the tender pays an open order; only a placed one is collected. */
  #tenderEventName(): "confirm-payment" | "collect-order" {
    return this.mode !== "prepay" && this.stage === "collect" ? "collect-order" : "confirm-payment";
  }

  /** Guarded so a short tender can never be emitted, even if Confirm is force-clicked past its
   * disabled state. */
  #confirm(): void {
    if (!this.isConnected || this.busy || this.view !== "paying") return;
    if (compareDecimal(this.#enteredDecimal(), this.store.total) < 0) return;
    this.#finishEntry();
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
    if (!this.isConnected || this.busy || this.view !== "card") return;
    this.#finishEntry();
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
    if (!this.isConnected || this.busy || this.view !== "weighing") return;
    const quantity = this.#enteredDecimal();
    if (compareDecimal(quantity, ZERO) <= 0 || !this.#quantityFitsUnit(product)) return;
    this.#finishEntry();
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
    return formatDecimalInput(this.entry === "" ? "0" : this.entry, currentLocale());
  }

  /** Ignore insignificant zeroes, matching the server's exact decimal-string check. */
  #quantityFitsUnit(product: TillProduct): boolean {
    return quantityPlaces(this.entry) <= productUnit(product).precision;
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
    if (this.view === "weighing") return this.#renderWeighing();
    if (this.weighOnly) return nothing;
    if (this.view === "paying") return this.#renderPaying();
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
      .readers=${this.#pickableReaders}
      .selectedReaderId=${this.chosenReaderId ?? this.defaultReaderId}
      .plainSimulator=${this.cardProvider === "simulator"}
      @reader-chosen=${(event: Event) => this.#onReaderChosen(event)}
      @reader-picker-cancel=${() => this.#onReaderPickerCancel()}
    ></till-reader-picker>`;
  }

  #renderIdle() {
    const disabled = this.store.lineCount === 0 || this.busy;
    if (this.mode !== "prepay" && this.stage === "collect")
      return this.#renderIdleCollect(disabled);
    return this.#renderIdlePay(disabled, this.mode !== "prepay");
  }

  #tenderVariant(): "primary" | "secondary" {
    return this.held || (!this.busy && this.store.lineCount === 0) ? "secondary" : "primary";
  }

  #renderCardButton(disabled: boolean) {
    return html`
      <wt-button
        class="pay-card"
        variant=${this.#tenderVariant()}
        size="md"
        ?disabled=${disabled || (this.tipAttempted && this.#tipInvalid())}
        @click=${() => this.#onCardTap()}
      >
        ${t("tender.card")}
      </wt-button>
    `;
  }

  #renderTenderButtons(disabled: boolean) {
    if (!this.takesCash)
      return html`
        <p class="cash-at-till">${t("tender.cash_at_till")}</p>
        <div class="tenders">${this.#renderCardButton(disabled)}</div>
      `;
    return html`
      <div class="tenders">
        <wt-button
          class="pay"
          variant=${this.#tenderVariant()}
          size="md"
          ?disabled=${disabled}
          @click=${() => this.#startPaying()}
        >
          ${t("tender.cash")}
        </wt-button>
        ${this.#renderCardButton(disabled)}
      </div>
    `;
  }

  #renderInvoiceButton(disabled: boolean) {
    return html`<wt-button
      data-full-invoice
      variant="secondary"
      ?disabled=${disabled}
      @click=${(event: Event) => {
        event.stopPropagation();
        this.dispatchEvent(new CustomEvent("choose-invoice", { bubbles: true, composed: true }));
      }}
      >${t("invoice.full")}</wt-button
    >`;
  }

  /** No Hold: a placed order is not parked again. */
  #renderIdleCollect(disabled: boolean) {
    return html`
      ${this.#renderCardExtras()}
      ${formMessage(this.tipAttempted && this.#tipInvalid() ? t("form.fix_fields") : "")}
      <div class="actions">${this.#renderTenderButtons(disabled)}</div>
    `;
  }

  /** `withPlace`: a zone that sends to the kitchen without payment can still send it unpaid. */
  #renderIdlePay(disabled: boolean, withPlace: boolean) {
    return html`
      ${this.#renderCardExtras()}
      ${formMessage(this.tipAttempted && this.#tipInvalid() ? t("form.fix_fields") : "")}
      <div class="actions idle-actions">
        ${this.#renderTenderButtons(disabled)}
        ${
          withPlace
            ? html`<wt-button
                class="place"
                variant="secondary"
                size="lg"
                ?disabled=${disabled}
                @click=${() => this.#place()}
              >
                ${t("action.place")}
              </wt-button>`
            : nothing
        }
        ${this.#renderInvoiceButton(disabled)}
        <wt-button
          class="hold"
          variant="secondary"
          size="md"
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
        ${
          reader === undefined && this.cardProvider !== "simulator"
            ? nothing
            : html`<p class="reader-name">
                ${
                  reader?.provider === "simulator"
                    ? t("card.demo_reader")
                    : (reader?.name ?? t("card.instant_simulator"))
                }
              </p>`
        }
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
          this.cardProvider === "simulator" && this.chosenReaderId === undefined
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
                  @click=${() => {
                    this.simulationOutcome = "captured";
                    this.#extrasScope?.changed();
                  }}
                  >${t("card.simulation_captured")}</wt-button
                >
                <wt-button
                  variant=${this.simulationOutcome === "declined" ? "primary" : "secondary"}
                  data-test="simulation-declined"
                  aria-pressed=${this.simulationOutcome === "declined"}
                  @click=${() => {
                    this.simulationOutcome = "declined";
                    this.#extrasScope?.changed();
                  }}
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
                  name="tip"
                  class="tip-input"
                  decimal-locale=${currentLocale()}
                  .error=${this.tipAttempted && this.#tipInvalid() ? t("bill_pay.tip_invalid") : ""}
                  .value=${live(this.tipEntry)}
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
        <wt-button class="cancel" variant="secondary" @click=${() => this.#requestCancel()}>
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
        <wt-button class="switch-tender" variant="secondary" @click=${() => this.#requestCancel()}>
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
        name="label"
        class="label-input"
        .value=${live(this.labelEntry)}
        .label=${t("held.label_prompt")}
        @wt-change=${(event: Event) => this.#onLabelChange(event)}
      ></wt-input>
      <div class="actions">
        <wt-button class="park" variant="primary" size="lg" @click=${() => this.#park()}>
          ${t("action.hold")}
        </wt-button>
        <wt-button class="cancel" variant="secondary" @click=${() => this.#requestCancel()}>
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
          <span class="amount total">${formatMoney(this.store.total, currentLocale())}</span>
        </div>
      </div>
      <wt-input
        @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(".confirm"))}
        name="externalRef"
        class="ref-input"
        .value=${live(this.refEntry)}
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
        <wt-button class="cancel" variant="secondary" @click=${() => this.#requestCancel()}>
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
          <span class="amount total">${formatMoney(total, currentLocale())}</span>
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
                  <span class="amount"
                    >${formatMoney(subtractDecimal(entered, total), currentLocale())}</span
                  >
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
        <wt-button class="cancel" variant="secondary" @click=${() => this.#requestCancel()}>
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
        <wt-button class="cancel" variant="secondary" @click=${() => this.#requestCancel()}>
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
