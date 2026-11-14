import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, disabledStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions } from "../interactive.js";
import "./wt-spinner.js";

export type WtButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type WtButtonSize = "sm" | "md" | "lg";
export type WtButtonAlign = "center" | "start";
export type WtButtonShape = "default" | "round";

@customElement("wt-button")
export class WtButton extends LitElement {
  // Delegates .focus() on the host to the inner <button> — a POS constantly needs to
  // programmatically focus a specific control (e.g. "focus the quantity field" after an action),
  // and without this the host absorbs the call while the inner control stays unfocused.
  static override shadowRootOptions = delegatesFocusShadowRootOptions;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-block;
      }

      button {
        display: inline-flex;
        align-items: center;
        justify-content: var(--wt-button-justify, center);
        gap: var(--wt-space-2);
        width: 100%;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-4);
        border: 1px solid transparent;
        border-radius: var(--wt-radius-md);
        font: inherit;
        font-weight: var(--wt-font-weight-bold);
        cursor: pointer;
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
      }

      button:disabled {
        ${disabledStyles}
      }

      :host([variant="secondary"]) button:hover:not(:disabled),
      :host([variant="ghost"]) button:hover:not(:disabled) {
        border-color: var(--wt-color-primary-text);
      }

      :host([size="sm"]) button {
        min-height: var(--wt-space-6);
        padding: var(--wt-space-1) var(--wt-space-3);
        font-size: var(--wt-font-size-sm);
      }

      :host([size="lg"]) button {
        min-height: calc(var(--wt-tap-min) * 1.4);
        padding: var(--wt-space-3) var(--wt-space-5);
        font-size: var(--wt-font-size-lg);
      }

      :host([variant="primary"]) button {
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
      }

      :host([variant="secondary"]) button {
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        border-color: var(--wt-color-border);
      }

      :host([variant="danger"]) button {
        background: var(--wt-color-danger);
        color: var(--wt-color-on-danger);
      }

      :host([variant="primary"]) button:hover:not(:disabled) {
        background: var(--wt-color-primary-hover);
        opacity: 1;
      }

      :host([variant="danger"]) button:hover:not(:disabled) {
        background: var(--wt-color-danger-hover);
        opacity: 1;
      }

      :host([variant="ghost"]) button {
        background: transparent;
        color: var(--wt-color-text);
      }

      /* Final colours, so no fade on top; a loading button keeps its own colour, faded. */
      :host([variant="primary"][disabled]:not([loading])) button {
        background: var(--wt-color-primary-disabled);
        color: var(--wt-color-on-primary-disabled);
        opacity: 1;
      }

      :host([variant="danger"][disabled]:not([loading])) button {
        background: var(--wt-color-danger-disabled);
        color: var(--wt-color-on-danger-disabled);
        opacity: 1;
      }

      :host([align="start"]) button {
        justify-content: var(--wt-button-justify, flex-start);
      }

      :host([shape="round"]) button {
        width: var(--wt-tap-min);
        min-width: var(--wt-tap-min);
        height: var(--wt-tap-min);
        padding: 0;
        border-radius: var(--wt-radius-full);
      }
    `,
  ];

  @property({ reflect: true }) variant: WtButtonVariant = "secondary";
  @property({ reflect: true }) size: WtButtonSize = "md";
  @property({ reflect: true }) align: WtButtonAlign = "center";
  @property({ reflect: true }) shape: WtButtonShape = "default";
  @property({ type: Boolean, reflect: true }) disabled = false;
  /** An in-progress action: the button is disabled, marked `aria-busy`, and a decorative spinner
   * leads the label. The label stays visible — and is the one thing announced — so the caller swaps
   * it for what is happening ("Scanning…" / "Buscando…") in the screen's own language. */
  @property({ type: Boolean, reflect: true }) loading = false;

  // Shadows the native ARIAMixin accessor so the value reaches the inner shadow <button> — the
  // element that is actually focusable and clickable. The host's own aria-label attribute (which
  // the native accessor would otherwise just read/write) never reaches an icon-only button's
  // accessible name on its own, since the host itself carries no interactive semantics.
  @property({ attribute: "aria-label" }) override ariaLabel: string | null = null;
  @property({ attribute: "aria-description" }) override ariaDescription: string | null = null;
  @property({ attribute: "aria-haspopup" }) override ariaHasPopup: string | null = null;
  @property({ attribute: "aria-expanded" }) override ariaExpanded: string | null = null;
  @property({ attribute: "aria-invalid" }) override ariaInvalid: string | null = null;

  // No `type` property: a shadow-DOM <button> is never form-associated (see
  // docs/developers/design-system.md, "Forms"), so a `type="submit"` here would be
  // documented but inert — it produces zero submit events and the enclosing form never lists this
  // control in `form.elements`. Forms are handled in JS via `wt-change`, not native submission.
  // Full form association via ElementInternals is out of scope for this component.

  // Menu items keep the shared row-actions appearance; other buttons may style this part.
  override render() {
    return html`
      <button
        type="button"
        part="button"
        ?disabled=${this.disabled || this.loading}
        aria-busy=${this.loading ? "true" : nothing}
        aria-label=${this.ariaLabel ?? nothing}
        aria-description=${this.ariaDescription ?? nothing}
        aria-haspopup=${this.ariaHasPopup ?? nothing}
        aria-expanded=${this.ariaExpanded ?? nothing}
        aria-invalid=${this.ariaInvalid ?? nothing}
      >
        ${this.loading ? html`<wt-spinner size="sm" decorative></wt-spinner>` : nothing}
        <slot></slot>
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-button": WtButton;
  }
}
