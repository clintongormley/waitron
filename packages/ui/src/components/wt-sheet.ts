import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, uniqueId } from "../interactive.js";
import "./wt-icon.js";

/** Where the sheet docks is its parent's choice; it only draws the bar and the body. */
@customElement("wt-sheet")
export class WtSheet extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        border-top: 1px solid var(--wt-color-border);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
      }

      .toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        width: 100%;
        min-height: var(--wt-tap-min);
        margin: 0;
        padding: var(--wt-space-2) var(--wt-space-4);
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        font-weight: var(--wt-font-weight-bold);
        text-align: start;
        cursor: pointer;
      }

      .chevron {
        transform: rotate(180deg);
      }

      :host([expanded]) .chevron {
        transform: none;
      }

      .body {
        max-height: 60dvh;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: 0 var(--wt-space-4) var(--wt-space-4);
      }
    `,
  ];

  @property() heading = "";

  @property({ type: Boolean, reflect: true }) expanded = false;

  private readonly bodyId = uniqueId("wt-sheet-body");

  private onToggle(event: Event): void {
    event.stopPropagation();
    this.expanded = !this.expanded;
    this.dispatchEvent(
      new CustomEvent("wt-sheet-toggle", {
        detail: { expanded: this.expanded },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    return html`
      <button
        type="button"
        part="toggle"
        class="toggle"
        aria-expanded=${this.expanded ? "true" : "false"}
        aria-controls=${this.bodyId}
        @click=${this.onToggle}
      >
        <span>${this.heading}</span>
        <wt-icon class="chevron" name="chevron-down" aria-hidden="true"></wt-icon>
      </button>
      <div id=${this.bodyId} part="body" class="body" ?hidden=${!this.expanded}>
        <slot></slot>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-sheet": WtSheet;
  }
}
