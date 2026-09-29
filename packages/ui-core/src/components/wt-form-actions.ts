import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
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
        align-items: flex-end;
        width: 100%;
        gap: var(--wt-space-2);
      }

      .primary {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        margin-inline-start: auto;
        gap: var(--wt-space-2);
      }

      .error {
        margin: 0;
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
        text-align: end;
      }
    `,
  ];

  /** The form's one message about a failed submission, shown beside the primary action. */
  @property() error = "";

  override render() {
    return html`
      <div class="actions" data-actions>
        <div class="cancel"><slot name="cancel"></slot></div>
        <div class="primary">
          ${
            this.error === ""
              ? nothing
              : html`<p class="error" role="alert" data-error>${this.error}</p>`
          }<slot name="secondary"></slot><slot></slot>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-form-actions": WtFormActions;
  }
}
