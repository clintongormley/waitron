import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { currencySymbol } from "@waitron/shared";
import { baseStyles, disabledStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, dispatchWtChange, uniqueId } from "../interactive.js";

/**
 * The unit button's visible text is its accessible name, so an empty `unit` leaves it nameless.
 * `fixed-unit` shows the unit as text instead, for a field whose unit is not chosen here. The
 * amount box is the `amount` part and a fixed unit the `unit` part. A non-empty `locale` draws the
 * euro sign inside the amount box, on the side that locale writes it, as the `currency` part.
 */
@customElement("wt-price-input")
export class WtPriceInput extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        max-width: var(--wt-field-max-width, none);
      }

      .label-row {
        display: flex;
        align-items: center;
        margin-bottom: var(--wt-space-1);
      }

      label {
        display: block;
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }

      .control {
        display: flex;
      }

      input {
        flex: 1;
        width: var(--wt-price-field-width);
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        /* The field and the unit button read as one control: the field rounds only its leading
           corners and drops the seam border the button supplies. */
        border-inline-end: 0;
        border-start-start-radius: var(--wt-radius-md);
        border-end-start-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
      }

      /* --end-border mirrors the input's own trailing border, which a unit button supplies. */
      .amount-box {
        --end-border: 0px;
        position: relative;
        display: flex;
        flex: 1;
      }

      .amount-box:last-child,
      .fixed .amount-box {
        --end-border: 1px;
      }

      .fixed .amount-box {
        flex: none;
      }

      /* The sign is measured into --currency-width, so the typed amount is padded clear of it, and
         an unstretched box grows by that padding so the amount keeps the room it had without it. */
      .amount-box input {
        width: calc(var(--wt-price-field-width) + var(--currency-width, 0px) + var(--wt-space-1));
      }

      .amount-box.before input {
        padding-inline-start: calc(
          var(--wt-space-3) + var(--currency-width, 0px) + var(--wt-space-1)
        );
      }

      .amount-box.after input {
        padding-inline-end: calc(
          var(--wt-space-3) + var(--currency-width, 0px) + var(--wt-space-1)
        );
        text-align: end;
      }

      .currency {
        position: absolute;
        inset-block: 0;
        display: flex;
        align-items: center;
        color: var(--wt-color-text-muted);
        pointer-events: none;
      }

      .before .currency {
        inset-inline-start: calc(1px + var(--wt-space-3));
      }

      .after .currency {
        inset-inline-end: calc(var(--end-border) + var(--wt-space-3));
      }

      :host([disabled]) .currency {
        ${disabledStyles}
      }

      input::placeholder {
        color: var(--wt-color-text-muted);
      }

      input:disabled {
        ${disabledStyles}
      }

      input:last-child,
      .amount-box:last-child input {
        border-inline-end: 1px solid var(--wt-color-border);
        border-start-end-radius: var(--wt-radius-md);
        border-end-end-radius: var(--wt-radius-md);
      }

      /* The amount box draws the seam itself, so a host that moves the unit under it (flex-basis
         100% on the unit part) leaves the box's trailing border in place. */
      .fixed {
        flex-wrap: wrap;
      }

      .fixed input {
        flex: none;
        border-inline-end: 1px solid var(--wt-color-border);
      }

      input[aria-invalid="true"] {
        border-color: var(--wt-color-danger);
      }

      .unit {
        flex: none;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-start-end-radius: var(--wt-radius-md);
        border-end-end-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        cursor: pointer;
      }

      span.unit {
        display: inline-flex;
        align-items: center;
        padding-inline: var(--wt-space-2);
        border-inline-start: 0;
        cursor: default;
      }

      .unit:disabled {
        ${disabledStyles}
      }

      .required,
      .error {
        color: var(--wt-color-danger);
      }

      .required {
        margin-inline-start: var(--wt-space-1);
      }

      .error,
      .hint {
        margin: var(--wt-space-1) 0 0;
        font-size: var(--wt-font-size-sm);
      }

      .hint {
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property() value = "";
  @property() label = "";
  @property() name = "";
  @property() unit = "";
  @property() placeholder = "";
  @property() error = "";
  /** A line of help under the field, which the amount is described by. */
  @property() hint = "";
  @property({ type: Boolean, reflect: true }) required = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  /** Names the field for assistive technology without drawing the label above it. */
  @property({ type: Boolean, attribute: "hide-label" }) hideLabel = false;
  @property({ type: Boolean, attribute: "fixed-unit" }) fixedUnit = false;
  /** Draws the euro sign in the amount box as this locale writes it; empty draws none. */
  @property() locale = "";

  private readonly generatedInputId = uniqueId("wt-price-input");
  private readonly errorId = uniqueId("wt-price-input-error");
  private readonly hintId = uniqueId("wt-price-input-hint");
  private readonly unitId = uniqueId("wt-price-input-unit");
  private readonly currencyId = uniqueId("wt-price-input-currency");

  private readonly currencyObserver = new ResizeObserver((entries) => {
    for (const { target, contentRect } of entries)
      (target.parentElement as HTMLElement).style.setProperty(
        "--currency-width",
        `${contentRect.width}px`,
      );
  });
  private observedCurrency: Element | null = null;

  /** Watched rather than measured once, so a field first rendered hidden, or whose font changes
   * later, still pads its amount clear of the sign. */
  private observeCurrency(): void {
    const currency = this.renderRoot.querySelector(".currency");
    if (currency === this.observedCurrency) return;
    if (this.observedCurrency) this.currencyObserver.unobserve(this.observedCurrency);
    if (currency) this.currencyObserver.observe(currency);
    this.observedCurrency = currency;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated) this.observeCurrency();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.currencyObserver.disconnect();
    this.observedCurrency = null;
  }

  protected override updated(changed: PropertyValues<this>): void {
    super.updated(changed);
    this.observeCurrency();
  }

  private onInput(event: Event): void {
    this.value = (event.target as HTMLInputElement).value;
    dispatchWtChange(this, event, { value: this.value });
  }

  private onUnitClick(event: Event): void {
    // Stop the native click before re-emitting, or a consumer across the shadow boundary sees two.
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("wt-unit-click", { detail: {}, bubbles: true, composed: true }),
    );
  }

  private renderUnit() {
    if (!this.fixedUnit)
      return html`<button
        type="button"
        class="unit"
        ?disabled=${this.disabled}
        @click=${this.onUnitClick}
      >
        ${this.unit}
      </button>`;
    return this.unit
      ? html`<span id=${this.unitId} class="unit" part="unit">${this.unit}</span>`
      : nothing;
  }

  override render() {
    const hasError = this.error !== "";
    const inputId = this.name || this.generatedInputId;
    const currency = this.locale ? currencySymbol(this.locale) : null;
    const hasHint = this.hint !== "";
    const describedBy = [
      ...(hasHint ? [this.hintId] : []),
      ...(hasError ? [this.errorId] : []),
      ...(currency ? [this.currencyId] : []),
      ...(this.fixedUnit && this.unit ? [this.unitId] : []),
    ];
    const input = html`<input
      id=${inputId}
      part="amount"
      name=${this.name || nothing}
      .value=${this.value}
      inputmode="decimal"
      placeholder=${this.placeholder || nothing}
      ?required=${this.required}
      ?disabled=${this.disabled}
      aria-label=${this.hideLabel && this.label ? this.label : nothing}
      aria-invalid=${hasError}
      aria-describedby=${describedBy.length ? describedBy.join(" ") : nothing}
      @input=${this.onInput}
    />`;
    return html`
      ${
        this.label && !this.hideLabel
          ? html`<div class="label-row">
              <label for=${inputId}
                >${this.label}${
                  this.required
                    ? html`<span class="required" data-required aria-hidden="true">*</span>`
                    : nothing
                }</label
              >
            </div>`
          : nothing
      }
      <div class=${this.fixedUnit && this.unit ? "control fixed" : "control"}>
        ${
          currency
            ? html`<span class="amount-box ${currency.side}"
                >${input}<span id=${this.currencyId} class="currency" part="currency"
                  >${currency.symbol}</span
                ></span
              >`
            : input
        }${this.renderUnit()}
      </div>
      ${hasHint ? html`<p id=${this.hintId} class="hint" data-hint>${this.hint}</p>` : nothing}
      ${hasError ? html`<p id=${this.errorId} class="error" data-error>${this.error}</p>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-price-input": WtPriceInput;
  }
}
