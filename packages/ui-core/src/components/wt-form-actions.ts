import { LitElement, css, html } from "lit";
import { customElement } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

@customElement("wt-form-actions")
export class WtFormActions extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        width: 100%;
      }

      .actions {
        display: flex;
        align-items: center;
        width: 100%;
        gap: var(--wt-space-2);
      }

      .primary {
        display: flex;
        margin-inline-start: auto;
        gap: var(--wt-space-2);
      }
    `,
  ];

  override render() {
    return html`
      <div class="actions" data-actions>
        <div class="cancel"><slot name="cancel"></slot></div>
        <div class="primary"><slot name="secondary"></slot><slot></slot></div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-form-actions": WtFormActions;
  }
}
