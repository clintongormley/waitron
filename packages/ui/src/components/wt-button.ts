import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, disabledStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions } from "../interactive.js";
import "./wt-spinner.js";

export type WtButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type WtButtonSize = "sm" | "md" | "lg";

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
        justify-content: center;
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

      /* Every variant gets the same feedback: a plain opacity dip. Anything variant-specific (a
         background swap, a border-colour change) would need a distinct value per variant to stay
         visible in both themes — --wt-color-surface and --wt-color-surface-raised are identical in
         the light theme today, so a background-based hover treatment would be invisible there. */
      button:hover:not(:disabled) {
        opacity: var(--wt-opacity-hover);
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

      :host([variant="ghost"]) button {
        background: transparent;
        color: var(--wt-color-text);
      }
    `,
  ];

  @property({ reflect: true }) variant: WtButtonVariant = "secondary";
  @property({ reflect: true }) size: WtButtonSize = "md";
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

  // No `type` property: a shadow-DOM <button> is never form-associated (see
  // ../../../docs/developers/design-system.md, "Forms"), so a `type="submit"` here would be
  // documented but inert — it produces zero submit events and the enclosing form never lists this
  // control in `form.elements`. Forms are handled in JS via `wt-change`, not native submission.
  // Full form association via ElementInternals is out of scope for this component.

  override render() {
    return html`
      <button
        type="button"
        ?disabled=${this.disabled || this.loading}
        aria-busy=${this.loading ? "true" : nothing}
        aria-label=${this.ariaLabel ?? nothing}
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
