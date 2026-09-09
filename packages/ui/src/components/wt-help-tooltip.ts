import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { uniqueId } from "../interactive.js";

@customElement("wt-help-tooltip")
export class WtHelpTooltip extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        position: relative;
        display: inline-flex;
        vertical-align: middle;
      }

      button {
        display: inline-grid;
        width: var(--wt-tap-min);
        height: var(--wt-tap-min);
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--wt-color-text-muted);
        cursor: pointer;
        place-items: center;
      }

      button:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }

      .icon {
        display: inline-grid;
        width: calc(var(--wt-space-6) - var(--wt-space-2));
        height: calc(var(--wt-space-6) - var(--wt-space-2));
        border: 1px solid currentColor;
        border-radius: var(--wt-radius-full);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        place-items: center;
      }

      .tooltip {
        position: absolute;
        z-index: 1;
        top: calc(100% + var(--wt-space-1));
        inset-inline-start: 50%;
        width: max-content;
        max-width: var(--wt-dialog-max-width);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        box-shadow: var(--wt-shadow-2);
        transform: translateX(-50%);
      }
    `,
  ];

  @property({ attribute: "aria-label" }) override ariaLabel: string | null = null;
  @state() private open = false;

  private readonly tooltipId = uniqueId("wt-help-tooltip");

  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    if (this.open && !event.composedPath().includes(this)) this.open = false;
  };

  private readonly onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (!this.open || event.key !== "Escape") return;
    // Escape belongs to the open tooltip. Cancel its native default so an enclosing modal dialog does
    // not also close and discard the form the tooltip is explaining.
    event.preventDefault();
    event.stopPropagation();
    this.open = false;
    this.shadowRoot?.querySelector<HTMLButtonElement>("button")?.focus();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("pointerdown", this.onDocumentPointerDown);
    document.addEventListener("keydown", this.onDocumentKeyDown);
  }

  override disconnectedCallback(): void {
    document.removeEventListener("pointerdown", this.onDocumentPointerDown);
    document.removeEventListener("keydown", this.onDocumentKeyDown);
    super.disconnectedCallback();
  }

  override render() {
    return html`
      <button
        type="button"
        aria-label=${this.ariaLabel ?? nothing}
        aria-expanded=${this.open}
        aria-describedby=${this.open ? this.tooltipId : nothing}
        @click=${() => (this.open = !this.open)}
      >
        <span class="icon" aria-hidden="true">?</span>
      </button>
      ${
        this.open
          ? html`<div id=${this.tooltipId} class="tooltip" role="tooltip"><slot></slot></div>`
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-help-tooltip": WtHelpTooltip;
  }
}
