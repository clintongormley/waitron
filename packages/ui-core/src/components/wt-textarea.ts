import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import {
  fieldLabel,
  fieldLabelState,
  fieldStyles,
  inheritArrow,
  inheritedDescription,
  type InheritedFieldValue,
} from "../field-styles.js";
import { delegatesFocusShadowRootOptions, dispatchWtChange, uniqueId } from "../interactive.js";

@customElement("wt-textarea")
export class WtTextarea extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;

  static override styles = [
    baseStyles,
    fieldStyles,
    css`
      :host {
        display: block;
        max-width: var(--wt-field-max-width);
      }

      /* The label's room is the box's padding, not the textarea's, so text the textarea scrolls
         stays inside it and never runs under the floated label. */
      .field:not([data-compact]) {
        padding-top: calc(var(--wt-space-3) + var(--wt-font-size-sm));
      }

      .field:not([data-compact]) .field-control {
        padding-top: 0;
        min-height: max(
          var(--wt-tap-min),
          calc(var(--wt-field-height) - var(--wt-space-3) - var(--wt-font-size-sm))
        );
      }

      .field-control {
        resize: vertical;
      }

      .field .inherit-cue {
        inset-block-end: auto;
        margin-block-start: var(--wt-space-1);
      }

      /* A resting label sits where the first line of text will go, not in the middle of a tall box. */
      .field[data-label="rest"]:not(:focus-within):not(:has(:autofill)) .field-label {
        top: calc(var(--wt-field-height) / 2);
      }
    `,
  ];

  @property() value = "";
  @property() label = "";
  @property() name = "";
  @property({ type: Number }) rows = 3;
  @property({ type: Number }) maxlength?: number;
  @property() placeholder = "";
  @property({ attribute: false }) inherited?: InheritedFieldValue;
  @property() error = "";
  /** Shown as the placeholder unless one is given, and kept as the textarea's description because a
   * placeholder disappears once the field holds a value. */
  @property() hint = "";
  @property({ type: Boolean, reflect: true }) required = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, reflect: true }) invalid = false;
  /** Names the textarea by `label` without drawing it, and makes the field compact. */
  @property({ type: Boolean, attribute: "hide-label" }) hideLabel = false;
  /** HTML reads `spellcheck="false"` as off; a plain Lit Boolean would read any present attribute as on. */
  @property({ converter: { fromAttribute: (value: string | null) => value !== "false" } })
  override spellcheck = true;
  /** HTML reads `autocorrect="off"` as off; a plain Lit Boolean would read any present attribute as on. */
  @property({ converter: { fromAttribute: (value: string | null) => value !== "off" } })
  override autocorrect = true;
  @property() override autocapitalize = "";
  @property() autocomplete = "";

  private readonly generatedId = uniqueId("wt-textarea");
  private readonly errorId = uniqueId("wt-textarea-error");
  private readonly hintId = uniqueId("wt-textarea-hint");

  private readonly inheritedId = uniqueId("wt-textarea-inherited");

  private onInput(event: Event): void {
    this.value = (event.target as HTMLTextAreaElement).value;
    dispatchWtChange(this, event, { value: this.value });
  }

  override render() {
    const hasError = this.error !== "";
    const hasHint = this.hint !== "";
    const inherited = this.inherited;
    const inherits = inherited !== undefined && this.value === "";
    const describedBy = [
      ...(hasHint ? [this.hintId] : []),
      ...(inherits ? [this.inheritedId] : []),
      ...(hasError ? [this.errorId] : []),
    ];
    const id = this.name || this.generatedId;
    const labelState = fieldLabelState({
      value: this.value,
      hint: this.hint,
      placeholder: inherited?.value ?? this.placeholder,
    });
    const showLabel = this.label !== "" && !this.hideLabel;
    return html`
      <div class="row">
        <div
          class="field"
          part="field"
          data-label=${labelState}
          ?data-invalid=${this.invalid || hasError}
          ?data-disabled=${this.disabled}
          ?data-compact=${!showLabel}
        >
          ${showLabel ? fieldLabel(id, this.label, this.required) : nothing}
          <textarea
            class="field-control"
            part="control"
            id=${id}
            name=${this.name || nothing}
            rows=${this.rows}
            .value=${this.value}
            placeholder=${inherited?.value ?? (this.placeholder || this.hint)}
            maxlength=${this.maxlength ?? nothing}
            spellcheck=${this.spellcheck ? "true" : "false"}
            autocapitalize=${this.autocapitalize || nothing}
            autocorrect=${this.autocorrect ? nothing : "off"}
            autocomplete=${this.autocomplete || nothing}
            aria-label=${this.hideLabel && this.label ? this.label : nothing}
            ?required=${this.required}
            ?disabled=${this.disabled}
            aria-invalid=${this.invalid || hasError}
            aria-describedby=${describedBy.length ? describedBy.join(" ") : nothing}
            @input=${this.onInput}
          ></textarea>
          ${inherited && !inherited.inTable ? inheritArrow() : nothing}
        </div>
        <slot name="help"></slot>
      </div>
      ${hasHint ? html`<p id=${this.hintId} class="hint" data-hint>${this.hint}</p>` : nothing}
      ${inherits ? inheritedDescription(this.inheritedId, inherited.value, inherited.suffix) : nothing}
      ${hasError ? html`<p id=${this.errorId} class="error" data-error>${this.error}</p>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-textarea": WtTextarea;
  }
}
