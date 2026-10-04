import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { currencySymbol } from "@waitron/shared";
import { fieldLabel, fieldLabelState, fieldStyles } from "@waitron/ui-core/field-styles";
import { baseStyles, disabledStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, dispatchWtChange, uniqueId } from "../interactive.js";

/**
 * The unit button's visible text is its accessible name, so an empty `unit` leaves it nameless.
 * `fixed-unit` shows the unit as text instead, for a field whose unit is not chosen here. The
 * amount input is the `amount` part and a fixed unit the `unit` part. A non-empty `locale` draws the
 * euro sign inside the amount box, on the side that locale writes it, as the `currency` part.
 */
@customElement("wt-price-input")
export class WtPriceInput extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;

  static override styles = [
    baseStyles,
    fieldStyles,
    css`
      :host {
        display: block;
        max-width: var(--wt-field-max-width);
      }

      /* Beside a unit button the label sits in the amount box, so a long one stops at the button
         rather than under it; beside a fixed unit it sits in the field box and spans past it. */
      .amount-box {
        position: relative;
        display: flex;
        flex: 1;
        align-self: stretch;
      }

      .field.fixed {
        flex-wrap: wrap;
      }

      .fixed .amount-box,
      .fixed .field-control {
        flex: none;
      }

      .field-control {
        flex: 1;
        width: var(--wt-price-field-width);
        min-width: var(--wt-tap-min);
      }

      /* The sign is measured into --currency-width, so the typed amount is padded clear of it, and
         an unstretched box grows by that padding so the amount keeps the room it had without it. */
      .before .field-control,
      .after .field-control {
        width: calc(var(--wt-price-field-width) + var(--currency-width, 0px) + var(--wt-space-1));
      }

      .before .field-control {
        padding-inline-start: calc(
          var(--wt-space-3) + var(--currency-width, 0px) + var(--wt-space-1)
        );
      }

      .after .field-control {
        padding-inline-end: calc(
          var(--wt-space-3) + var(--currency-width, 0px) + var(--wt-space-1)
        );
        text-align: end;
      }

      /* The sign and a fixed unit take the amount's block padding, so they sit on its text line. */
      .currency,
      span.unit {
        display: flex;
        align-items: center;
        padding-top: calc(var(--wt-space-3) + var(--wt-font-size-sm));
        padding-bottom: var(--wt-space-2);
      }

      .field[data-compact] .currency,
      .field[data-compact] span.unit {
        padding-block: var(--wt-space-2);
      }

      .currency {
        position: absolute;
        inset-block: 0;
        color: var(--wt-color-text-muted);
        pointer-events: none;
      }

      /* A resting label sits on the amount's line, where the sign and a fixed unit are drawn. */
      .field[data-label="rest"]:not([data-compact]):not(:focus-within):not(:has(:autofill))
        :is(.currency, span.unit) {
        visibility: hidden;
      }

      .before .currency {
        inset-inline-start: var(--wt-space-3);
      }

      .after .currency {
        inset-inline-end: var(--wt-space-3);
      }

      span.unit {
        flex: none;
        align-self: stretch;
        padding-inline: var(--wt-space-2);
        color: var(--wt-color-text);
      }

      .field[data-disabled] span.unit {
        color: var(--wt-color-text-muted);
      }

      button.unit {
        flex: none;
        align-self: center;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        margin-inline-end: var(--wt-space-1);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        cursor: pointer;
      }

      button.unit:disabled {
        ${disabledStyles}
      }
    `,
  ];

  @property() value = "";
  @property() label = "";
  @property() name = "";
  @property() unit = "";
  @property() placeholder = "";
  @property() error = "";
  @property() hint = "";
  @property({ type: Boolean, reflect: true }) required = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, reflect: true }) invalid = false;
  /** Names the field by `label` without drawing it, and makes the field compact. */
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

  /** A host `.focus()` lands on the amount, so a chooser the unit button opened returns focus here. */
  focusUnit(): void {
    this.renderRoot.querySelector<HTMLButtonElement>("button.unit")?.focus();
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
    const invalid = this.invalid || hasError;
    const inputId = this.name || this.generatedInputId;
    const currency = this.locale ? currencySymbol(this.locale) : null;
    const hasHint = this.hint !== "";
    const describedBy = [
      ...(hasHint ? [this.hintId] : []),
      ...(hasError ? [this.errorId] : []),
      ...(currency ? [this.currencyId] : []),
      ...(this.fixedUnit && this.unit ? [this.unitId] : []),
    ];
    const showLabel = this.label !== "" && !this.hideLabel;
    const fixed = this.fixedUnit && this.unit !== "";
    const label = showLabel ? fieldLabel(inputId, this.label, this.required) : nothing;
    return html`
      <div
        class=${fixed ? "field fixed" : "field"}
        part="field"
        data-label=${fieldLabelState({
          value: this.value,
          hint: this.hint,
          placeholder: this.placeholder,
        })}
        ?data-invalid=${invalid}
        ?data-disabled=${this.disabled}
        ?data-compact=${!showLabel}
      >
        ${fixed ? label : nothing}<span class="amount-box ${currency?.side ?? ""}"
          >${fixed ? nothing : label}<input
            class="field-control"
            id=${inputId}
            part="amount"
            name=${this.name || nothing}
            .value=${this.value}
            inputmode="decimal"
            placeholder=${this.placeholder || this.hint || nothing}
            ?required=${this.required}
            ?disabled=${this.disabled}
            aria-label=${this.hideLabel && this.label ? this.label : nothing}
            aria-invalid=${invalid}
            aria-describedby=${describedBy.length ? describedBy.join(" ") : nothing}
            @input=${this.onInput}
          />${
            currency
              ? html`<span id=${this.currencyId} class="currency" part="currency"
                  >${currency.symbol}</span
                >`
              : nothing
          }</span
        >${this.renderUnit()}
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
