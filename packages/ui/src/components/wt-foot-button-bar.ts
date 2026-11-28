import { LitElement, css, html } from "lit";
import { customElement } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

@customElement("wt-foot-button-bar")
export class WtFootButtonBar extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        --wt-foot-link-height: var(--wt-tap-min);
        --wt-foot-action-height: calc(var(--wt-tap-min) + var(--wt-space-2));
      }

      footer {
        display: grid;
        gap: var(--wt-space-2);
        padding: calc(var(--wt-space-2) + var(--wt-space-1) / 2) var(--wt-space-4);
        padding-block-end: var(--wt-foot-padding-bottom, var(--wt-space-5));
        border-block-start: var(--wt-field-line-width) solid var(--wt-color-border);
        background: var(--wt-color-surface);
      }

      .actions {
        display: grid;
        gap: var(--wt-space-2);
      }

      :host([layout="row"]) .actions {
        display: flex;
        flex-wrap: wrap;
      }

      ::slotted(wt-button) {
        --wt-tap-min: var(--wt-foot-action-height);
        --wt-action-font-size: var(--wt-font-size-lg);
      }

      ::slotted([slot="link"]) {
        justify-self: center;
        --wt-tap-min: var(--wt-foot-link-height);
        --wt-action-font-size: var(--wt-font-size-md);
        --wt-action-text: var(--wt-color-primary-text);
      }
    `,
  ];

  override render() {
    return html`<footer>
      <div class="actions"><slot></slot></div>
      <slot name="link"></slot>
    </footer>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-foot-button-bar": WtFootButtonBar;
  }
}
