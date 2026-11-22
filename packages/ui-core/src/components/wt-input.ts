import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, visuallyHiddenStyles } from "../base-styles.js";
import { fieldLabel, fieldLabelState, fieldStyles } from "../field-styles.js";
import { delegatesFocusShadowRootOptions, dispatchWtChange, uniqueId } from "../interactive.js";
import { formatDecimalInput, readDecimalInput } from "../decimal-input.js";

/** A password field that names no purpose holds a secret other than the person's sign-in, so the
 * browser is told not to fill the saved login into it. */
const DEFAULT_AUTOCOMPLETE: Readonly<Record<string, string>> = {
  password: "new-password",
  search: "off",
};

type PasswordVisibilityText = {
  show: string;
  hide: string;
  shown: string;
  hidden: string;
};

export type InputFieldDecoration = {
  fieldClass?: string;
  inputPart?: string;
  autocomplete?: string;
  placeholder?: string | typeof nothing;
  extraDescriptionIds?: string[];
  /** Give the end slot its own layout class so the shared overlay leaves it alone. */
  endClass?: string;
  end?: TemplateResult;
};

@customElement("wt-input")
export class WtInput extends LitElement {
  // Delegates .focus() on the host to the inner <input> — a POS constantly needs to
  // programmatically focus a specific field.
  static override shadowRootOptions = delegatesFocusShadowRootOptions;

  static override styles = [
    baseStyles,
    fieldStyles,
    css`
      :host {
        display: block;
        max-width: var(--wt-field-max-width);
      }

      .field.has-end .field-control {
        padding-inline-end: calc(var(--wt-tap-min) + var(--wt-space-3));
      }

      .field.has-end .field-label {
        inset-inline-end: calc(var(--wt-tap-min) + var(--wt-space-3));
      }

      .end {
        display: none;
        position: absolute;
        inset-block: 0;
        inset-inline-end: var(--wt-space-1);
        align-items: center;
      }

      .field.has-end .end {
        display: flex;
      }

      .end wt-button:not(:defined) {
        visibility: hidden;
      }

      .end svg {
        width: var(--wt-font-size-lg);
        height: var(--wt-font-size-lg);
        fill: none;
        stroke: currentColor;
      }

      .visibility-status {
        ${visuallyHiddenStyles}
      }
    `,
  ];

  @property() value = "";
  @property() label = "";
  @property() name = "";
  @property() type = "text";
  @property({ attribute: "decimal-locale" }) decimalLocale = "";
  @property() autocomplete = "";
  /** HTML reads `spellcheck="false"` as off; a plain Lit Boolean would read any present attribute as on. */
  @property({ converter: { fromAttribute: (value: string | null) => value !== "false" } })
  override spellcheck = true;
  /** HTML reads `autocorrect="off"` as off; a plain Lit Boolean would read any present attribute as on. */
  @property({ converter: { fromAttribute: (value: string | null) => value !== "off" } })
  override autocorrect = true;
  @property() override autocapitalize = "";
  @property() placeholder = "";
  @property({ type: Number }) maxlength?: number;
  @property({ type: Number }) step?: number;
  @property() error = "";
  /** Shown as the placeholder unless one is given, and kept as the input's description because a
   * placeholder disappears once the field holds a value. */
  @property() hint = "";
  @property({ type: Boolean, reflect: true }) required = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  /** Shows a value that cannot be typed over, drawn as an editable field rather than a disabled one. */
  @property({ type: Boolean, reflect: true }) readonly = false;
  @property({ type: Boolean, reflect: true }) invalid = false;
  /** Names the input by `label` without drawing it, and makes the field compact. */
  @property({ type: Boolean, attribute: "hide-label" }) hideLabel = false;
  /** Localized action and announcement text opts a password field into the fallback end action. */
  @property({ attribute: false }) passwordVisibility?: PasswordVisibilityText;
  @state() protected hasEnd = false;
  @state() private visibility?: "shown" | "hidden";
  #typedValue?: string;

  // Unnamed legacy fields retain a generated id. Named fields use the semantic name for both native
  // attributes, so consumers never have to infer "email" from "wt-input-2". Each input owns its own
  // shadow root, so repeated names do not collide with another field's label association.
  private readonly generatedInputId = uniqueId(this.localName);
  private readonly errorId = uniqueId(`${this.localName}-error`);
  private readonly hintId = uniqueId(`${this.localName}-hint`);

  protected get inputLocale(): string {
    return this.decimalLocale;
  }

  protected get fieldDecoration(): InputFieldDecoration | undefined {
    return undefined;
  }

  private onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const locale = this.inputLocale;
    this.value = locale ? readDecimalInput(input, locale) : input.value;
    this.#typedValue = this.value;
    if (!this.value) this.maskPassword();
    if (locale) this.requestUpdate();
    dispatchWtChange(this, event, { value: this.value });
  }

  private onEndSlotChange(event: Event): void {
    this.hasEnd = (event.target as HTMLSlotElement).assignedElements().length > 0;
    if (this.hasEnd) this.maskPassword();
  }

  private get visibilityText(): PasswordVisibilityText | undefined {
    return this.type === "password" && !this.inputLocale ? this.passwordVisibility : undefined;
  }

  private maskPassword(): void {
    if (this.visibility === "shown") this.visibility = "hidden";
  }

  override willUpdate(changed: PropertyValues<this>): void {
    const text = this.visibilityText;
    // Importing a plain wt-input must not register an unrelated element.
    if (text && !customElements.get("wt-button")) void import("./wt-button.js");
    // Replacing the value or taking away its hide action must leave it masked.
    if (this.disabled || !text || (changed.has("value") && this.value !== this.#typedValue))
      this.maskPassword();
    this.#typedValue = undefined;
  }

  private togglePassword(): void {
    this.visibility = this.visibility === "shown" ? "hidden" : "shown";
  }

  /** Selects the whole value, so typing replaces it. Does nothing before the first render. */
  select(): void {
    this.shadowRoot?.querySelector("input")?.select();
  }

  protected renderFieldContents(
    label: TemplateResult | typeof nothing,
    input: TemplateResult,
    end: TemplateResult,
  ): TemplateResult {
    return html`${label}${input}${end}`;
  }

  override render() {
    const decoration = this.fieldDecoration;
    const locale = this.inputLocale;
    const hasError = this.error !== "";
    const hasHint = this.hint !== "";
    const describedBy = [
      ...(hasHint ? [this.hintId] : []),
      ...(hasError ? [this.errorId] : []),
      ...(decoration?.extraDescriptionIds ?? []),
    ];
    const inputId = this.name || this.generatedInputId;
    const labelState = fieldLabelState({
      value: this.value,
      hint: this.hint,
      placeholder: this.placeholder,
      type: this.type,
    });
    const showLabel = this.label !== "" && !this.hideLabel;
    const passwordVisibility = this.visibilityText;
    const revealed = this.visibility === "shown";
    const hasEnd = !decoration?.endClass && (this.hasEnd || passwordVisibility || decoration?.end);
    const fieldClass = decoration?.fieldClass || (hasEnd ? "has-end" : undefined);
    const label = showLabel ? fieldLabel(inputId, this.label, this.required) : nothing;
    const input = html`
      <input
        class="field-control"
        id=${inputId}
        part=${decoration?.inputPart ?? nothing}
        name=${this.name || nothing}
        .value=${locale ? live(formatDecimalInput(this.value, locale)) : this.value}
        type=${locale || revealed ? "text" : this.type}
        inputmode=${locale ? "decimal" : nothing}
        autocomplete=${decoration?.autocomplete ?? (this.autocomplete || DEFAULT_AUTOCOMPLETE[this.type] || nothing)}
        autocapitalize=${this.autocapitalize || nothing}
        autocorrect=${this.autocorrect ? nothing : "off"}
        spellcheck=${this.spellcheck ? nothing : "false"}
        placeholder=${decoration?.placeholder ?? (this.placeholder || this.hint)}
        maxlength=${this.maxlength ?? nothing}
        step=${this.step ?? nothing}
        aria-label=${this.hideLabel && this.label ? this.label : nothing}
        ?required=${this.required}
        ?disabled=${this.disabled}
        ?readonly=${this.readonly}
        aria-invalid=${this.invalid || hasError}
        aria-describedby=${describedBy.length ? describedBy.join(" ") : nothing}
        @input=${this.onInput}
      />
    `;
    const end = html`
      <slot class=${decoration?.endClass ?? "end"} name="end" @slotchange=${this.onEndSlotChange}>
        ${
          passwordVisibility
            ? html`<wt-button
                variant="ghost"
                shape="round"
                aria-label=${revealed ? passwordVisibility.hide : passwordVisibility.show}
                ?disabled=${this.disabled}
                @click=${this.togglePassword}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M1 8s2.5-4 7-4 7 4 7 4-2.5 4-7 4-7-4-7-4Z"></path>
                  <circle cx="8" cy="8" r="2"></circle>
                  ${revealed ? html`<path d="m2 2 12 12"></path>` : nothing}
                </svg>
              </wt-button>`
            : (decoration?.end ?? nothing)
        }
      </slot>
    `;
    return html`
      <div class="row">
        <div
          class=${fieldClass ? `field ${fieldClass}` : "field"}
          part="field"
          data-label=${labelState}
          ?data-invalid=${this.invalid || hasError}
          ?data-disabled=${this.disabled}
          ?data-compact=${!showLabel}
        >
          ${this.renderFieldContents(label, input, end)}
        </div>
        <slot name="help"></slot>
      </div>
      ${
        passwordVisibility
          ? html`<span class="visibility-status" role="status"
              >${this.visibility ? passwordVisibility[this.visibility] : nothing}</span
            >`
          : nothing
      }
      ${hasHint ? html`<p id=${this.hintId} class="hint" data-hint>${this.hint}</p>` : nothing}
      ${hasError ? html`<p id=${this.errorId} class="error" data-error>${this.error}</p>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-input": WtInput;
  }
}
