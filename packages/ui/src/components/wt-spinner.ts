import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

export type WtSpinnerSize = "sm" | "md" | "lg";

/**
 * An indeterminate progress indicator: a ring drawn in `currentColor` whose one solid arc rotates.
 * It is a live `role="status"` region named by `label`, so assistive tech announces that something
 * is in progress; under `prefers-reduced-motion` the ring stays still (the arc is still visible, so
 * the state is conveyed without motion). Sizes follow the font-size tokens exactly as `wt-icon`
 * does, so a spinner sits beside text or inside a button at the text's own size.
 */
@customElement("wt-spinner")
export class WtSpinner extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-flex;
        width: var(--wt-font-size-md);
        height: var(--wt-font-size-md);
        vertical-align: middle;
      }

      :host([size="sm"]) {
        width: var(--wt-font-size-sm);
        height: var(--wt-font-size-sm);
      }

      :host([size="lg"]) {
        width: var(--wt-font-size-lg);
        height: var(--wt-font-size-lg);
      }

      .ring {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        border: calc(var(--wt-space-1) / 2) solid currentColor;
        border-right-color: transparent;
        border-radius: 50%;
        opacity: var(--wt-opacity-disabled);
        animation: wt-spin 0.8s linear infinite;
      }

      @keyframes wt-spin {
        to {
          transform: rotate(360deg);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .ring {
          animation: none;
        }
      }
    `,
  ];

  @property({ reflect: true }) size: WtSpinnerSize = "md";
  /** The accessible name of the status region — what a screen reader announces. */
  @property() label = "Loading";

  override render() {
    return html`<span class="ring" role="status" aria-label=${this.label}></span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-spinner": WtSpinner;
  }
}
