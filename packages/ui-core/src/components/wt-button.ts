import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, disabledStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions } from "../interactive.js";
import "./wt-spinner.js";
import "./wt-icon.js";

export type WtButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "link";
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
        gap: var(--wt-action-gap, var(--wt-space-2));
        width: 100%;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: var(
          --wt-action-padding,
          var(--wt-space-2) var(--wt-button-padding-inline, var(--wt-space-4))
        );
        border: var(--wt-action-border, 1px solid transparent);
        border-radius: var(--wt-action-radius, var(--wt-radius-md));
        font: inherit;
        font-weight: var(--wt-action-weight, var(--wt-font-weight-bold));
        font-size: var(--wt-action-font-size, inherit);
        text-align: var(--wt-action-text-align, center);
        cursor: pointer;
        background: var(--wt-action-background, var(--wt-color-surface));
        color: var(--wt-action-text, var(--wt-color-text));
      }

      button:is(:hover, :active):enabled:not([aria-disabled="true"]) {
        --wt-action-background: var(--wt-action-hover);
      }

      wt-icon {
        flex: none;
        color: var(--wt-action-icon-color, currentColor);
      }

      :host([variant="danger"]) wt-icon {
        color: var(--wt-action-danger-text, currentColor);
      }

      button:disabled,
      button[aria-disabled="true"] {
        ${disabledStyles}
      }

      :host([variant="secondary"]) button:hover:enabled:not([aria-disabled="true"]),
      :host([variant="ghost"]) button:hover:enabled:not([aria-disabled="true"]) {
        border-color: var(--wt-action-border-color, var(--wt-color-primary-text));
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
        background: var(--wt-action-background, var(--wt-color-primary));
        color: var(--wt-action-text, var(--wt-color-on-primary));
      }

      :host([variant="secondary"]) button {
        background: var(--wt-action-background, var(--wt-color-surface));
        color: var(--wt-action-text, var(--wt-color-text));
        border-color: var(--wt-action-border-color, var(--wt-color-border));
      }

      :host([variant="danger"]) button {
        background: var(--wt-action-background, var(--wt-color-danger));
        color: var(--wt-action-danger-text, var(--wt-color-on-danger));
      }

      :host([variant="primary"]) button:hover:enabled:not([aria-disabled="true"]) {
        background: var(--wt-action-hover, var(--wt-color-primary-hover));
        opacity: 1;
      }

      :host([variant="danger"]) button:hover:enabled:not([aria-disabled="true"]) {
        background: var(--wt-action-hover, var(--wt-color-danger-hover));
        opacity: 1;
      }

      :host([variant="ghost"]) button {
        background: var(--wt-action-background, transparent);
        color: var(--wt-action-text, var(--wt-color-text));
      }

      :host([variant="link"]) button {
        padding-inline: 0;
        background: var(--wt-action-background, transparent);
        color: var(--wt-action-text, var(--wt-color-primary-text));
        font-weight: var(--wt-font-weight-normal);
        text-decoration: underline;
      }

      @media (forced-colors: active) {
        :host([variant="link"]) button {
          border-color: Canvas;
        }
        :host([variant="link"]) button:disabled,
        :host([variant="link"]) button[aria-disabled="true"] {
          color: GrayText;
        }
      }

      /* Final colours, so no fade on top; a loading button keeps its own colour, faded. */
      :host([variant="primary"][disabled]:not([loading])) button {
        background: var(--wt-action-background, var(--wt-color-primary-disabled));
        color: var(--wt-action-text, var(--wt-color-on-primary-disabled));
        opacity: var(--wt-action-disabled-opacity, 1);
      }

      :host([variant="danger"][disabled]:not([loading])) button {
        background: var(--wt-action-background, var(--wt-color-danger-disabled));
        color: var(--wt-action-danger-text, var(--wt-color-on-danger-disabled));
        opacity: var(--wt-action-disabled-opacity, 1);
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

  @property() icon = "";
  @property({ reflect: true }) variant: WtButtonVariant = "secondary";
  @property({ reflect: true }) size: WtButtonSize = "md";
  @property({ reflect: true }) align: WtButtonAlign = "center";
  @property({ reflect: true }) shape: WtButtonShape = "default";
  @property({ type: Boolean, reflect: true }) disabled = false;
  /** An in-progress action: the button ignores presses, is marked `aria-busy`, and a decorative
   * spinner leads the label. The label stays visible — and is the one thing announced — so the caller swaps
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

  // Loading keeps the button focusable, unlike native disabled, so focus is not dropped to the page
  // when a pressed Save starts working; the presses it would then pass on are stopped here.
  private ignoreWhileLoading(event: Event): void {
    if (!this.loading) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  override render() {
    return html`
      <button
        type="button"
        part="button"
        ?disabled=${this.disabled}
        aria-disabled=${this.loading && !this.disabled ? "true" : nothing}
        aria-busy=${this.loading ? "true" : nothing}
        aria-label=${this.ariaLabel ?? nothing}
        aria-description=${this.ariaDescription ?? nothing}
        aria-haspopup=${this.ariaHasPopup ?? nothing}
        aria-expanded=${this.ariaExpanded ?? nothing}
        aria-invalid=${this.ariaInvalid ?? nothing}
        @click=${this.ignoreWhileLoading}
      >
        ${
          this.loading
            ? html`<wt-spinner size="sm" decorative></wt-spinner>`
            : this.icon
              ? html`<wt-icon name=${this.icon} size="lg"></wt-icon>`
              : nothing
        }
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
