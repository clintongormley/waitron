import { LitElement, css } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("wt-placeholder")
export class WtPlaceholder extends LitElement {
  static override styles = css`
    :host {
      display: block;
      pointer-events: none;
      background: var(--wt-color-surface-sunken);
      border-radius: var(--wt-radius-md);
    }

    @media (forced-colors: active) {
      :host {
        background: transparent;
      }
    }
  `;

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute("aria-hidden", "true");
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-placeholder": WtPlaceholder;
  }
}
